#!/usr/bin/env node
// Real-machine end-to-end test for the app-server transport (client + runner + mapper) against a
// LIVE `codex app-server`. Exercises the full session.delta contract plus codex's native CLI features
// (interactive approval, hot resume, interrupt, and slash commands / skills).
//
// Requires: codex installed & authenticated (uses the default model). Run:
//   node libs/cli/agent-bridge/test/app-server-e2e.mjs
import fs from 'node:fs';
import { runAppServerCommand, steerActiveTurn, stopAppServerCommand, decideAppServerApproval, parseInput } from '../lib/app-server-runner.mjs';
import { shutdownAppServerClient } from '../lib/app-server-client.mjs';

const WORKDIR = new URL('./e2e-workdir/', import.meta.url).pathname;
fs.mkdirSync(WORKDIR, { recursive: true });
const results = [];
const ok = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); console.log(`  ${cond ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${name}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Poll a predicate until true or the ceiling elapses (resolves as soon as it's true).
const waitUntil = async (pred, ceilingMs = 45000, stepMs = 300) => { const end = Date.now() + ceilingMs; while (Date.now() < end) { if (pred()) return true; await sleep(stepMs); } return pred(); };

// Collector: captures every session.delta event; optionally auto-decides approvals (mimics the web).
function collector({ decide } = {}) {
  const events = [];
  const onSessionEvent = (event) => {
    events.push(event);
    if (decide && event.kind === 'authorization.request') {
      const requestId = String(event.payload.requestId); // web stringifies the id
      setImmediate(() => decideAppServerApproval(event.sessionId, { allow: decide === 'accept', scope: 'once', requestId, toolName: event.payload.toolName }));
    }
  };
  const kinds = () => events.map((e) => e.kind);
  const text = (kind) => events.filter((e) => e.kind === kind).map((e) => e.payload.content).join('\n');
  return { events, onSessionEvent, kinds, text };
}
const base = { workspace: WORKDIR, appServerApprovalPolicy: 'on-request', appServerSandbox: 'workspace-write' };

async function main() {
  console.log('=== app-server E2E (live codex) ===');

  // ---- 1. basic turn: full session.delta contract ----
  console.log('\n[1] basic turn');
  {
    const c = collector();
    await runAppServerCommand({ ...base, sessionId: 'e2e-basic', stdin: 'Reply with exactly one word: PONG', onSessionEvent: c.onSessionEvent });
    ok('emits session.started', c.kinds().includes('session.started'));
    ok('emits session.user_message exactly once (no duplicate echo)', c.kinds().filter((k) => k === 'session.user_message').length === 1, `count=${c.kinds().filter((k) => k === 'session.user_message').length}`);
    ok('emits an assistant_message', c.kinds().includes('session.assistant_message'));
    ok('assistant said PONG', /PONG/i.test(c.text('session.assistant_message')));
    ok('emits session.complete', c.kinds().includes('session.complete'));
    ok('cliSessionId (thread id) captured', c.events.some((e) => typeof e.payload.cliSessionId === 'string'));
    ok('every frame matches contract {content,source,metadata}', c.events.every((e) => typeof e.payload.content === 'string' && e.payload.source && e.payload.metadata !== undefined || e.kind === 'session.started'));
  }

  // ---- 2. interactive approval: ACCEPT executes the escalated command ----
  console.log('\n[2] approval ACCEPT (read-only sandbox + write => escalation)');
  {
    const probe = `${WORKDIR}approve.txt`; try { fs.rmSync(probe, { force: true }); } catch {}
    const c = collector({ decide: 'accept' });
    await runAppServerCommand({ ...base, appServerSandbox: 'read-only', sessionId: 'e2e-approve',
      stdin: `Create the file ${probe} containing OK by RUNNING A SHELL COMMAND: printf 'OK' > '${probe}'. Execute it now.`,
      onSessionEvent: c.onSessionEvent });
    const req = c.events.find((e) => e.kind === 'authorization.request');
    ok('emits authorization.request', !!req);
    ok('authorization.request carries top-level requestId (web-routable)', !!req && req.payload.requestId != null);
    ok('emits authorization.decision after accept', c.kinds().includes('authorization.decision'));
    ok('probe file written to disk (accept actually executed)', fs.existsSync(probe));
    ok('emits session.complete', c.kinds().includes('session.complete'));
  }

  // ---- 3. interactive approval: DECLINE blocks the command ----
  console.log('\n[3] approval DECLINE');
  {
    const probe = `${WORKDIR}decline.txt`; try { fs.rmSync(probe, { force: true }); } catch {}
    const c = collector({ decide: 'decline' });
    await runAppServerCommand({ ...base, appServerSandbox: 'read-only', sessionId: 'e2e-decline',
      stdin: `Create the file ${probe} containing OK by RUNNING A SHELL COMMAND: printf 'OK' > '${probe}'. Execute it now.`,
      onSessionEvent: c.onSessionEvent });
    ok('emits authorization.request', c.kinds().includes('authorization.request'));
    ok('probe file NOT written (decline blocked execution)', !fs.existsSync(probe));
  }

  // ---- 4. hot resume: second turn on the same session recalls the first ----
  console.log('\n[4] hot resume (same session, in-memory thread reused)');
  {
    const c1 = collector();
    await runAppServerCommand({ ...base, sessionId: 'e2e-resume', stdin: 'Remember this secret word: BANANA. Reply with just: OK', onSessionEvent: c1.onSessionEvent });
    const cli1 = c1.events.find((e) => e.payload.cliSessionId)?.payload.cliSessionId;
    const c2 = collector();
    await runAppServerCommand({ ...base, sessionId: 'e2e-resume', stdin: 'What was the secret word I told you? Reply with just the word.', onSessionEvent: c2.onSessionEvent });
    const cli2 = c2.events.find((e) => e.payload.cliSessionId)?.payload.cliSessionId;
    ok('turn 2 recalls BANANA from turn 1 (warm context)', /BANANA/i.test(c2.text('session.assistant_message')), c2.text('session.assistant_message').slice(0, 80));
    ok('same thread id across both turns (no cold restart)', cli1 && cli1 === cli2, `${cli1} == ${cli2}`);
  }

  // ---- 5. slash commands: /model, /skills, !shell, /goal, /compact ----
  console.log('\n[5] slash commands (native codex CLI features)');
  {
    // establish a thread first
    await runAppServerCommand({ ...base, sessionId: 'e2e-slash', stdin: 'Reply with: ready', onSessionEvent: () => {} });

    const cModel = collector();
    await runAppServerCommand({ ...base, sessionId: 'e2e-slash', stdin: '/model', onSessionEvent: cModel.onSessionEvent });
    ok('/model -> session.status listing models', /available models/i.test(cModel.text('session.status')), cModel.text('session.status').split('\n')[0]);

    const cSkills = collector();
    await runAppServerCommand({ ...base, sessionId: 'e2e-slash', stdin: '/skills', onSessionEvent: cSkills.onSessionEvent });
    ok('/skills -> session.status listing skills', /available skills/i.test(cSkills.text('session.status')));

    const cShell = collector();
    await runAppServerCommand({ ...base, sessionId: 'e2e-slash', stdin: '!echo hello-from-shell', onSessionEvent: cShell.onSessionEvent });
    ok('!shell -> tool_use emitted', cShell.kinds().includes('session.tool_use'));
    ok('!shell -> tool_result emitted', cShell.kinds().includes('session.tool_result'), cShell.text('session.tool_result').slice(0, 60));

    const cGoal = collector();
    await runAppServerCommand({ ...base, sessionId: 'e2e-slash', stdin: '/goal ship the app-server transport', onSessionEvent: cGoal.onSessionEvent });
    ok('/goal set -> session.status confirming', /goal set/i.test(cGoal.text('session.status')));

    const cCompact = collector();
    await runAppServerCommand({ ...base, sessionId: 'e2e-slash', stdin: '/compact', onSessionEvent: cCompact.onSessionEvent });
    ok('/compact -> completes without error', cCompact.kinds().includes('session.complete') && !cCompact.kinds().includes('session.error'));
  }

  // ---- 6. skill invocation via /<name> ----
  console.log('\n[6] skill invocation (/<name> runs a skill, or falls back to text)');
  {
    const c = collector();
    // parse-level guarantee: unknown /<name> is classified as a skill invocation
    ok('parseInput classifies /deploy as skill', parseInput('/deploy prod').kind === 'skill');
    // runtime: /nonexistent-skill falls back to a text turn (no crash), completes cleanly
    await runAppServerCommand({ ...base, sessionId: 'e2e-skill', stdin: '/definitely-not-a-real-skill just reply OK', onSessionEvent: c.onSessionEvent });
    ok('unknown skill falls back to a turn and completes', c.kinds().includes('session.complete') && !c.kinds().includes('session.error'));
  }

  // ---- 7. interrupt a running turn ----
  console.log('\n[7] interrupt (turn/interrupt via stopAppServerCommand)');
  {
    const c = collector();
    const p = runAppServerCommand({ ...base, sessionId: 'e2e-interrupt',
      stdin: 'Run a shell command that sleeps: sleep 30. Then reply DONE.', onSessionEvent: c.onSessionEvent });
    // interrupt a genuinely-running turn: wait until the command is actually executing (tool_use seen)
    await waitUntil(() => c.kinds().includes('session.tool_use'), 30000);
    const stopped = stopAppServerCommand('e2e-interrupt');
    ok('stopAppServerCommand found an active turn to interrupt', stopped);
    const done = await waitUntil(() => c.kinds().includes('session.complete'), 45000);
    await Promise.race([p, sleep(1000)]);
    ok('interrupted session resolves to complete', done);
  }

  // ---- 8. steer an active turn (inject input mid-turn) ----
  console.log('\n[8] steer active turn');
  {
    const c = collector();
    const p = runAppServerCommand({ ...base, sessionId: 'e2e-steer',
      stdin: 'Run a shell command that sleeps: sleep 20. Then reply with the word I steer to you.', onSessionEvent: c.onSessionEvent });
    // steer once a turn is genuinely active (command running)
    await waitUntil(() => c.kinds().includes('session.tool_use'), 30000);
    const steered = await steerActiveTurn('e2e-steer', 'The word is: KIWI', c.onSessionEvent);
    ok('steerActiveTurn injected into the running turn', steered);
    stopAppServerCommand('e2e-steer'); // end the sleep so the test doesn't wait for the full turn
    const done = await waitUntil(() => c.kinds().includes('session.complete'), 45000);
    await Promise.race([p, sleep(1000)]);
    ok('steered session resolves to complete', done);
  }

  // ---- summary ----
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n=== E2E SUMMARY: ${pass}/${results.length} passed ===`);
  shutdownAppServerClient();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); shutdownAppServerClient(); process.exit(2); });
