#!/usr/bin/env node
import { runCapture } from './capture.mjs';
import { parseOptions } from './runtime.mjs';

const [action, ...args] = process.argv.slice(2);

try {
  await runCapture(action, parseOptions(args));
} catch (error) {
  console.error(`[knowledge-capture] ${error.message}`);
  process.exitCode = 1;
}
