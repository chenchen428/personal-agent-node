import fs from 'node:fs';
import path from 'node:path';
import {
  emit,
  escapeHtml,
  firstHeading,
  parseFrontmatter,
  relativeToRoot,
  requireOption,
  resolveFromCwd,
  writeText,
} from './runtime.mjs';

function spaceCjkAndLatin(value) {
  return value
    .replace(/([\p{Script=Han}])([A-Za-z0-9])/gu, '$1 $2')
    .replace(/([A-Za-z0-9])([\p{Script=Han}])/gu, '$1 $2');
}

function formatLine(line, inFence) {
  if (inFence || !line.trim()) return line.trimEnd();
  const parts = line.split(/(`[^`]*`)/g);
  return parts.map((part, index) => (index % 2 === 1 ? part : spaceCjkAndLatin(part))).join('').trimEnd();
}

export function formatMarkdown(markdown) {
  const normalized = String(markdown).replaceAll('\r\n', '\n').replaceAll('\u00a0', ' ');
  const { attributes, body } = parseFrontmatter(normalized);
  const hadFrontmatter = Object.keys(attributes).length > 0;
  const sourceBody = hadFrontmatter ? body : normalized;
  let inFence = false;
  const lines = sourceBody.split('\n').map((line) => {
    if (/^\s*```/.test(line)) {
      const output = line.trimEnd();
      inFence = !inFence;
      return output;
    }
    return formatLine(line, inFence);
  });
  const cleaned = lines.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!hadFrontmatter) return `${cleaned}\n`;
  const frontmatterEnd = normalized.indexOf('\n---\n', 4);
  const frontmatter = normalized.slice(0, frontmatterEnd + 5).trimEnd();
  return `${frontmatter}\n\n${cleaned}\n`;
}

function safeHref(value) {
  const decoded = value.replaceAll('&amp;', '&');
  if (/^(javascript|data):/i.test(decoded.trim())) return '#';
  return value;
}

function renderInline(value) {
  const tokens = [];
  let text = String(value).replace(/`([^`]+)`/g, (_, code) => {
    const token = `INLINE_TOKEN_${tokens.length}`;
    tokens.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });
  text = escapeHtml(text)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g, (_, alt, src) => `<img src="${safeHref(src)}" alt="${alt}" loading="lazy">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g, (_, label, href) => `<a href="${safeHref(href)}">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  tokens.forEach((token, index) => {
    text = text.replace(`INLINE_TOKEN_${index}`, token);
  });
  return text;
}

function isTableSeparator(line) {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}

function tableCells(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function isBlockStart(lines, index) {
  const line = lines[index] || '';
  return /^\s*```/.test(line)
    || /^#{1,6}\s+/.test(line)
    || /^\s*>\s?/.test(line)
    || /^\s*[-*+]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || /^\s*(?:---+|\*\*\*+)\s*$/.test(line)
    || (line.includes('|') && isTableSeparator(lines[index + 1] || ''));
}

export function renderMarkdownBody(markdown) {
  const lines = parseFrontmatter(markdown).body.split('\n');
  const output = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = line.match(/^\s*```([^\s]*)\s*$/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      output.push(`<pre><code data-language="${escapeHtml(fence[1] || 'text')}">${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (line.includes('|') && isTableSeparator(lines[index + 1] || '')) {
      const headers = tableCells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      output.push(`<div class="table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${renderInline(row[cellIndex] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quotes = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quotes.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      output.push(`<blockquote>${quotes.map(renderInline).join('<br>')}</blockquote>`);
      continue;
    }
    const unordered = /^\s*[-*+]\s+/.test(line);
    const ordered = /^\s*\d+[.)]\s+/.test(line);
    if (unordered || ordered) {
      const tag = ordered ? 'ol' : 'ul';
      const pattern = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
      const items = [];
      while (index < lines.length && pattern.test(lines[index])) {
        items.push(lines[index].replace(pattern, ''));
        index += 1;
      }
      output.push(`<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
      output.push('<hr>');
      index += 1;
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
  }
  return output.join('\n');
}

export function renderMarkdownDocument(markdown, titleOverride = '') {
  const parsed = parseFrontmatter(markdown);
  const title = titleOverride || parsed.attributes.title || firstHeading(parsed.body) || 'Untitled';
  const body = renderMarkdownBody(markdown);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --ink: #17211b; --muted: #607067; --line: #d8dfda; --paper: #f7f8f5; --accent: #146c5a; --warm: #d45b3f; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.78 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }
    main { width: min(760px, calc(100% - 32px)); margin: 0 auto; padding: 64px 0 96px; }
    h1, h2, h3, h4 { line-height: 1.25; letter-spacing: 0; text-wrap: balance; }
    h1 { margin: 0 0 32px; font-size: 42px; border-top: 6px solid var(--accent); padding-top: 22px; }
    h2 { margin: 56px 0 18px; font-size: 28px; }
    h3 { margin: 36px 0 12px; font-size: 21px; color: var(--accent); }
    p, ul, ol, blockquote, pre, .table-wrap { margin: 0 0 22px; }
    a { color: var(--accent); text-underline-offset: 3px; }
    strong { color: #0b493e; }
    blockquote { border-left: 4px solid var(--warm); margin-left: 0; padding: 4px 0 4px 20px; color: var(--muted); }
    code { background: #e8ece8; border-radius: 4px; padding: 2px 5px; font: .9em ui-monospace, SFMono-Regular, Menlo, monospace; }
    pre { overflow: auto; background: #18231d; color: #f1f5f2; border-radius: 8px; padding: 20px; }
    pre code { background: transparent; padding: 0; color: inherit; }
    img { display: block; max-width: 100%; height: auto; margin: 28px auto; }
    .table-wrap { overflow-x: auto; border-top: 1px solid var(--line); }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 12px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { color: var(--muted); font-weight: 650; }
    hr { border: 0; border-top: 1px solid var(--line); margin: 42px 0; }
    @media (max-width: 640px) { main { padding-top: 36px; } h1 { font-size: 32px; } h2 { font-size: 24px; } }
  </style>
</head>
<body><main>${body}</main></body>
</html>
`;
}

function runFormat(options) {
  const input = resolveFromCwd(requireOption(options, 'input'));
  const output = resolveFromCwd(requireOption(options, 'output'));
  const formatted = formatMarkdown(fs.readFileSync(input, 'utf8'));
  writeText(output, formatted, { force: Boolean(options.force) });
  return { input: relativeToRoot(input), output: relativeToRoot(output), bytes: fs.statSync(output).size };
}

function runHtml(options) {
  const input = resolveFromCwd(requireOption(options, 'input'));
  const output = resolveFromCwd(requireOption(options, 'output'));
  const html = renderMarkdownDocument(fs.readFileSync(input, 'utf8'), options.title ? String(options.title) : '');
  writeText(output, html, { force: Boolean(options.force) });
  return { input: relativeToRoot(input), output: relativeToRoot(output), bytes: fs.statSync(output).size };
}

export function runContent(action, argv) {
  let result;
  if (action === 'format') result = runFormat(argv.options);
  else if (action === 'html') result = runHtml(argv.options);
  else throw new Error('Usage: skill-tree content <format|html> [options]');
  emit(result, argv.options);
}
