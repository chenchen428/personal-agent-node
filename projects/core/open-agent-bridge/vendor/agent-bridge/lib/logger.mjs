export function logWithTimestamp(line, { stream = process.stderr } = {}) {
  const text = line instanceof Error ? (line.stack || line.message) : String(line ?? '');
  for (const part of text.split(/\r?\n/)) {
    if (!part) continue;
    stream.write(`${new Date().toISOString()} ${part}\n`);
  }
}

export function createTimestampedLogger(options = {}) {
  return (line) => logWithTimestamp(line, options);
}
