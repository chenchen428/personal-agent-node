import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  emit,
  relativeToRoot,
  requireOption,
  resolveFromCwd,
  sha256,
  writeJson,
} from './runtime.mjs';

function hasCommand(command) {
  if (path.isAbsolute(command)) return fs.existsSync(command);
  const locator = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(locator, [command], { stdio: 'ignore' }).status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`);
  }
  return result.stdout;
}

function chromeBinary() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome',
    'chromium',
    'chromium-browser',
  ];
  return candidates.find((candidate) => candidate.startsWith('/') ? fs.existsSync(candidate) : hasCommand(candidate));
}

function rasterizeSvg(input, output) {
  const chrome = chromeBinary();
  if (!chrome) throw new Error('SVG rasterization needs Google Chrome or Chromium');
  const details = inspectSvg(input);
  if (!details.width || !details.height) throw new Error('SVG needs width/height or a viewBox before rasterization');
  run(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${details.width},${details.height}`,
    `--screenshot=${output}`,
    new URL(`file://${path.resolve(input)}`).href,
  ]);
}

function inspectSvg(input) {
  const text = fs.readFileSync(input, 'utf8').slice(0, 20000);
  const svg = text.match(/<svg\b([^>]*)>/i)?.[1] || '';
  const width = svg.match(/\bwidth=["']([\d.]+)(?:px)?["']/i)?.[1];
  const height = svg.match(/\bheight=["']([\d.]+)(?:px)?["']/i)?.[1];
  const viewBox = svg.match(/\bviewBox=["']([^"']+)["']/i)?.[1];
  const values = viewBox?.trim().split(/\s+/).map(Number);
  return {
    format: 'SVG',
    width: width ? Number(width) : values?.[2] || null,
    height: height ? Number(height) : values?.[3] || null,
    viewBox: viewBox || null,
  };
}

export function inspectMedia(inputValue) {
  const input = resolveFromCwd(inputValue);
  if (!fs.existsSync(input)) throw new Error(`Media file not found: ${relativeToRoot(input)}`);
  let details;
  if (path.extname(input).toLowerCase() === '.svg') {
    details = inspectSvg(input);
  } else if (hasCommand('magick')) {
    const output = run('magick', ['identify', '-format', '%m\t%w\t%h\t%[colorspace]', input]);
    const [format, width, height, colorspace] = output.trim().split('\t');
    details = { format, width: Number(width), height: Number(height), colorspace };
  } else {
    throw new Error('Media inspection needs ImageMagick (`magick`) for raster files');
  }
  return {
    input: relativeToRoot(input),
    bytes: fs.statSync(input).size,
    sha256: sha256(input),
    ...details,
    aspectRatio: details.width && details.height ? Number((details.width / details.height).toFixed(4)) : null,
  };
}

function compressMedia(options) {
  const input = resolveFromCwd(requireOption(options, 'input'));
  if (!fs.existsSync(input)) throw new Error(`Input file not found: ${relativeToRoot(input)}`);
  const format = String(options.format || path.extname(options.output || '').slice(1) || 'webp').toLowerCase().replace('jpg', 'jpeg');
  if (!['webp', 'png', 'jpeg'].includes(format)) throw new Error('--format must be webp, png, or jpeg');
  const output = resolveFromCwd(options.output || `${input.slice(0, -path.extname(input).length)}.${format === 'jpeg' ? 'jpg' : format}`);
  if (path.resolve(input) === path.resolve(output)) throw new Error('Input and output must differ');
  if (fs.existsSync(output) && !options.force) throw new Error(`Refusing to overwrite ${relativeToRoot(output)} without --force`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const quality = Math.max(1, Math.min(100, Number(options.quality || 80)));
  let tool;
  const svgInput = path.extname(input).toLowerCase() === '.svg';
  if (svgInput) {
    const rasterOutput = format === 'png' ? output : `${output}.raster-source.png`;
    rasterizeSvg(input, rasterOutput);
    if (format === 'webp' && hasCommand('cwebp')) {
      run('cwebp', ['-quiet', '-q', String(quality), rasterOutput, '-o', output]);
      fs.rmSync(rasterOutput);
    } else if (format === 'jpeg' && hasCommand('magick')) {
      run('magick', [rasterOutput, '-strip', '-quality', String(quality), output]);
      fs.rmSync(rasterOutput);
    } else if (format !== 'png') {
      fs.rmSync(rasterOutput, { force: true });
      throw new Error(`SVG conversion to ${format} needs cwebp or ImageMagick`);
    }
    tool = format === 'png' ? 'chrome' : `chrome+${format === 'webp' ? 'cwebp' : 'magick'}`;
  } else if (format === 'webp' && hasCommand('cwebp')) {
    run('cwebp', ['-quiet', '-q', String(quality), input, '-o', output]);
    tool = 'cwebp';
  } else if (hasCommand('magick')) {
    const args = [input, '-auto-orient', '-strip'];
    if (format === 'png') args.push('-define', `png:compression-level=${Math.max(0, Math.min(9, Math.round((100 - quality) / 11)))}`);
    else args.push('-quality', String(quality));
    args.push(output);
    run('magick', args);
    tool = 'magick';
  } else {
    throw new Error('Compression needs `cwebp` for WebP or ImageMagick (`magick`)');
  }
  const before = fs.statSync(input).size;
  const after = fs.statSync(output).size;
  return {
    input: relativeToRoot(input),
    output: relativeToRoot(output),
    format,
    quality,
    tool,
    beforeBytes: before,
    afterBytes: after,
    reductionPercent: Number((((before - after) / before) * 100).toFixed(2)),
    sha256: sha256(output),
  };
}

export function runMedia(action, argv) {
  let result;
  if (action === 'inspect') result = inspectMedia(requireOption(argv.options, 'input'));
  else if (action === 'compress') result = compressMedia(argv.options);
  else throw new Error('Usage: skill-tree media <inspect|compress> [options]');
  if (argv.options.report) {
    const reportFile = resolveFromCwd(String(argv.options.report));
    writeJson(reportFile, result, { force: Boolean(argv.options.force) });
    result.report = relativeToRoot(reportFile);
  }
  emit(result, argv.options);
}
