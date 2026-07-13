#!/usr/bin/env node
import { runMedia } from './media.mjs';
import { parseOptions } from './runtime.mjs';

const [action, ...args] = process.argv.slice(2);

try {
  runMedia(action, parseOptions(args));
} catch (error) {
  console.error(`[media-toolkit] ${error.message}`);
  process.exitCode = 1;
}
