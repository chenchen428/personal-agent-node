#!/usr/bin/env node
import { parseOptions } from './skill-tree/common.mjs';
import { runCases } from './skill-tree/cases.mjs';
import { runCatalog } from './skill-tree/catalog.mjs';

const [group = 'help', action, ...rest] = process.argv.slice(2);
try {
  if (group === 'catalog') runCatalog(parseOptions([action, ...rest].filter(Boolean)).options);
  else if (group === 'cases') runCases(action, parseOptions(rest));
  else if (['help', '--help', '-h'].includes(group)) console.log('Cove skill catalog\n\n  skill-tree catalog [--json]\n  skill-tree cases verify');
  else throw new Error('Unknown skill-tree command: ' + group + '. Use personal-agent help --json or pa-cli --help for product capabilities.');
} catch (error) {
  console.error('[skill-tree] ' + error.message);
  process.exitCode = 1;
}
