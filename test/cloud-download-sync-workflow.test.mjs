import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('Node release waits for the private Cloud download synchronization gate', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /sync-cloud-download:/);
  assert.match(workflow, /needs: publish/);
  assert.match(workflow, /timeout-minutes: 18/);
  assert.match(workflow, /actions\/create-github-app-token@v2/);
  assert.match(workflow, /CLOUD_SYNC_GITHUB_APP_ID/);
  assert.match(workflow, /repositories: personal-agent/);
  assert.match(workflow, /event_type: 'node-release-published'/);
  assert.match(workflow, /source_repository:/);
  assert.match(workflow, /listWorkflowRuns/);
  assert.match(workflow, /attempt <= 60/);
  assert.match(workflow, /targetRun\.conclusion !== 'success'/);
});
