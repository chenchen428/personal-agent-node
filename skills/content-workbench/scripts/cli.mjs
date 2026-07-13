#!/usr/bin/env node
import { runContent } from './content.mjs';
import { parseOptions } from './runtime.mjs';

const [action, ...args] = process.argv.slice(2);

try {
  runContent(action, parseOptions(args));
} catch (error) {
  console.error(`[content-workbench] ${error.message}`);
  process.exitCode = 1;
}
