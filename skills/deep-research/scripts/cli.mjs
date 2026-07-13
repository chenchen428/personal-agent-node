#!/usr/bin/env node
import { runResearch } from './research.mjs';
import { parseOptions } from './runtime.mjs';

const [action, ...args] = process.argv.slice(2);

try {
  runResearch(action, parseOptions(args));
} catch (error) {
  console.error(`[deep-research] ${error.message}`);
  process.exitCode = 1;
}
