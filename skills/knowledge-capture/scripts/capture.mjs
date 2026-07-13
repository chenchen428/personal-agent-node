import fs from 'node:fs';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import {
  emit,
  relativeToRoot,
  requireOption,
  resolveFromCwd,
  sha256,
  slugify,
  timestamp,
  writeText,
} from './runtime.mjs';

function decodeEntities(value) {
  const entities = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '--', ndash: '-', hellip: '...',
  };
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match);
}

function absoluteUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return value;
  }
}

function githubRawUrl(input) {
  const url = new URL(input);
  if (url.hostname !== 'github.com') return input;
  const parts = url.pathname.split('/').filter(Boolean);
  const blobIndex = parts.indexOf('blob');
  if (blobIndex !== 2 || parts.length < 5) return input;
  return `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts[3]}/${parts.slice(4).join('/')}`;
}

export function isPrivateOrReservedAddress(value) {
  const address = String(value).toLowerCase().replace(/^\[|\]$/g, '');
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0)
      || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 168)
      || (a === 198 && [18, 19].includes(b))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a >= 224;
  }
  if (family === 6) {
    if (address === '::' || address === '::1') return true;
    if (/^(?:fc|fd|fe[89ab]|ff)/.test(address)) return true;
    if (address.startsWith('2001:db8:') || address.startsWith('2001:0:')) return true;
    if (address.startsWith('::ffff:')) {
      const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
      return mapped ? isPrivateOrReservedAddress(mapped) : true;
    }
    return false;
  }
  return true;
}

async function assertPublicHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Capture URL is invalid: ${value}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Capture URL must use HTTP or HTTPS');
  if (url.username || url.password) throw new Error('Capture URL must not contain credentials');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Capture URL must not target a local or internal hostname');
  }
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedAddress(hostname)) throw new Error('Capture URL must not target a private or reserved address');
    return url;
  }
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`Capture hostname could not be resolved: ${error.message}`);
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateOrReservedAddress(address))) {
    throw new Error('Capture hostname resolves to a private or reserved address');
  }
  return url;
}

async function fetchPublicUrl(initialUrl, { signal, maxRedirects = 5 } = {}) {
  let currentUrl = String(initialUrl);
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    await assertPublicHttpUrl(currentUrl);
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      signal,
      headers: { 'user-agent': 'personal-agent-node skill-tree capture/1.0' },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error(`Capture redirect is missing Location: ${currentUrl}`);
    if (redirectCount === maxRedirects) throw new Error(`Capture exceeded ${maxRedirects} redirects`);
    currentUrl = new URL(location, currentUrl).href;
  }
  throw new Error('Capture redirect handling failed');
}

function cleanInline(html, baseUrl) {
  return decodeEntities(html
    .replace(/<img\b[^>]*?alt=["']([^"']*)["'][^>]*?src=["']([^"']+)["'][^>]*>/gi, (_, alt, src) => `![${alt}](${absoluteUrl(src, baseUrl)})`)
    .replace(/<img\b[^>]*?src=["']([^"']+)["'][^>]*?alt=["']([^"']*)["'][^>]*>/gi, (_, src, alt) => `![${alt}](${absoluteUrl(src, baseUrl)})`)
    .replace(/<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => `[${text.replace(/<[^>]+>/g, '')}](${absoluteUrl(href, baseUrl)})`)
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<[^>]+>/g, ''));
}

function htmlToMarkdown(html, sourceUrl) {
  const title = decodeEntities(html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1]
    || html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    || new URL(sourceUrl).hostname).replace(/\s+/g, ' ').trim();
  let content = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, '');
  content = content.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2]
    || content.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    || content;

  const codeBlocks = [];
  content = content.replace(/<pre\b[^>]*>(?:\s*<code\b[^>]*>)?([\s\S]*?)(?:<\/code>\s*)?<\/pre>/gi, (_, code) => {
    const token = `CAPTURE_CODE_BLOCK_${codeBlocks.length}`;
    codeBlocks.push(`\n\n\`\`\`\n${decodeEntities(code.replace(/<[^>]+>/g, '')).trim()}\n\`\`\`\n\n`);
    return token;
  });

  content = content
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => `\n\n${'#'.repeat(Number(level))} ${cleanInline(text, sourceUrl)}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => `\n- ${cleanInline(text, sourceUrl)}`)
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, text) => `\n\n> ${cleanInline(text, sourceUrl).replace(/\n+/g, '\n> ')}\n\n`)
    .replace(/<(br|hr)\b[^>]*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|section|ul|ol|table|tr)>/gi, '\n\n')
    .replace(/<(p|div|section|ul|ol|table|tr)\b[^>]*>/gi, '')
    .replace(/<td\b[^>]*>([\s\S]*?)<\/td>/gi, (_, text) => ` | ${cleanInline(text, sourceUrl)}`)
    .replace(/<th\b[^>]*>([\s\S]*?)<\/th>/gi, (_, text) => ` | **${cleanInline(text, sourceUrl)}**`);
  content = cleanInline(content, sourceUrl);
  codeBlocks.forEach((block, index) => {
    content = content.replace(`CAPTURE_CODE_BLOCK_${index}`, block);
  });
  content = content.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, body: content };
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

async function captureUrl(options) {
  const requestedUrl = requireOption(options, 'url');
  const fetchUrl = githubRawUrl(requestedUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeout || 30000));
  let response;
  try {
    response = await fetchPublicUrl(fetchUrl, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`Capture failed with HTTP ${response.status}: ${requestedUrl}`);
  const raw = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const isText = /text\/(plain|markdown)|application\/(markdown|json)/i.test(contentType) || /\.(md|mdx|txt)(?:$|\?)/i.test(fetchUrl);
  const converted = isText
    ? { title: path.basename(new URL(requestedUrl).pathname) || new URL(requestedUrl).hostname, body: raw.trim() }
    : htmlToMarkdown(raw, response.url || requestedUrl);
  const outputFile = resolveFromCwd(options.out || `${slugify(converted.title)}.md`);
  const markdown = [
    '---',
    `title: ${yamlString(converted.title)}`,
    `source_url: ${yamlString(requestedUrl)}`,
    `resolved_url: ${yamlString(response.url || fetchUrl)}`,
    `captured_at: ${yamlString(timestamp())}`,
    '---',
    '',
    converted.body,
    '',
  ].join('\n');
  writeText(outputFile, markdown, { force: Boolean(options.force) });
  return {
    output: relativeToRoot(outputFile),
    sourceUrl: requestedUrl,
    resolvedUrl: response.url || fetchUrl,
    bytes: fs.statSync(outputFile).size,
    sha256: sha256(outputFile),
  };
}

export async function runCapture(action, argv) {
  if (action !== 'url') throw new Error('Usage: skill-tree capture url --url <url> --out <file>');
  const result = await captureUrl(argv.options);
  emit(result, argv.options);
}
