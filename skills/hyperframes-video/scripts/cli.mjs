#!/usr/bin/env node
import { HYPERFRAMES_PACKAGE, parseArguments, runHyperframes } from './hyperframes.mjs';

const help = `Personal Agent HyperFrames video CLI

Uses ${HYPERFRAMES_PACKAGE}; telemetry is disabled and outputs stay inside the project.

Usage:
  hyperframes-video doctor [--json]
  hyperframes-video check --project <dir> [--strict] [--json] [--samples <n>] [--at <seconds>] [--at-transitions] [--snapshots]
  hyperframes-video snapshot --project <dir> [--output <dir>] [--frames <n>] [--at <seconds>] [--no-end] [--force]
  hyperframes-video render --project <dir> [--output <file.mp4>] [--quality <draft|standard|high>] [--fps <n>] [--workers <n|auto>] [--composition <file>] [--resolution <preset>] [--strict] [--no-best-effort] [--force]

This wrapper intentionally does not expose account, publish, cloud, feedback, or remote generation commands.
`;

const [action, ...args] = process.argv.slice(2);

try {
  if (!action || action === 'help' || action === '--help' || action === '-h') {
    console.log(help);
  } else {
    runHyperframes(action, parseArguments(args));
  }
} catch (error) {
  console.error(`[hyperframes-video] ${error.message}`);
  process.exitCode = 1;
}
