import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runtimeExecutionConfig, runRuntimeCommand, probeRuntimeAccount, stopRuntimeCommand, steerRuntimeTurn } from '../src/agent/runtime-runner.ts';
import { resolveClaudeCommand } from '../src/agent/claude-code-runner.ts';

function fixture(t, name, source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-runtime-engine-'));
  const file = path.join(root, name);
  fs.writeFileSync(file, source);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file };
}
const claudeSource = `
const args = process.argv.slice(2);
let text = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => text += c);
const send = o => process.stdout.write(JSON.stringify(o) + '\\n');
process.stdin.on('end', () => {
  const session_id = args.includes('--resume') ? args[args.indexOf('--resume')+1] : 'claude-session';
  send({type:'system',subtype:'init',session_id});
  if (text.includes('WAIT_FOREVER')) {setInterval(()=>{}, 1000); return;}
  send({type:'assistant',message:{id:'a1',content:[{type:'tool_use',id:'tool1',name:'Read',input:{path:'hello.txt'}}]}});
  send({type:'user',message:{content:[{type:'tool_result',tool_use_id:'tool1',content:'file read'}]}});
  const answer = JSON.stringify({args, text, auth:process.env.ANTHROPIC_AUTH_TOKEN, apiKey:process.env.ANTHROPIC_API_KEY, base:process.env.ANTHROPIC_BASE_URL});
  send({type:'assistant',message:{id:'a2',content:[{type:'text',text:answer}]}});
  send({type:'result',subtype: text.includes('FAIL_RESULT') ? 'error_during_execution' : 'success',is_error:text.includes('FAIL_RESULT'),session_id,result:answer,usage:{input_tokens:20,cache_read_input_tokens:3,output_tokens:7}});
});`;
const codexSource = `
import readline from 'node:readline';
const send = x => process.stdout.write(JSON.stringify(x)+'\\n');
readline.createInterface({input:process.stdin}).on('line', line => {
 const q=JSON.parse(line); if(q.id===undefined) return;
 if(q.method==='initialize') send({id:q.id,result:{}});
 else if(q.method==='thread/start'||q.method==='thread/resume') {
   send({id:q.id,result:{thread:{id:q.params.threadId||'codex-session'}}});
 } else if(q.method==='turn/start') {
   send({id:q.id,result:{turn:{id:'turn-id'}}});
   send({method:'item/completed',params:{threadId:q.params.threadId,turnId:'turn-id',item:{type:'agentMessage',id:'a',text:JSON.stringify({params:q.params,args:process.argv.slice(2),secret:process.env.PERSONAL_AGENT_MODEL_API_KEY})}}});
   send({method:'turn/completed',params:{threadId:q.params.threadId,turn:{id:'turn-id',status:'completed'}}});
 } else send({id:q.id,result:{}});
});`;

test('Claude official npm shim resolves without cmd.exe and unknown wrappers fail closed', (t) => {
  const { root } = fixture(t, 'claude.cmd', '@echo never execute');
  const pkg = path.join(root, 'node_modules', '@anthropic-ai', 'claude-code');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'cli.js'), '');
  const resolved = resolveClaudeCommand({ command: path.join(root, 'claude.cmd'), platform: 'win32' });
  assert.equal(resolved.command, process.execPath);
  assert.deepEqual(resolved.args, [path.join(pkg, 'cli.js')]);
  fs.mkdirSync(path.join(pkg, 'bin'));
  fs.writeFileSync(path.join(pkg, 'bin', 'claude.exe'), '');
  assert.deepEqual(resolveClaudeCommand({ command: path.join(root, 'claude.cmd'), platform: 'win32' }), {
    command: path.join(pkg, 'bin', 'claude.exe'), args: [],
  });
  assert.throws(() => resolveClaudeCommand({ command: 'claude & echo bad', env: { PATH: root }, platform: 'win32' }), /未检测到/);
});

test('custom provider configuration stays process local and excludes secrets from argv', () => {
  const base = { appServerArgs: ['app-server'], agentEnv: { CLAUDE_CODE_OAUTH_TOKEN: 'old-account', ANTHROPIC_API_KEY: 'old-key' } };
  const custom = { engine: 'codex', credential: 'test-secret', profile: { mode: 'custom', model: 'private-model', baseUrl: 'https://models.example.test/v1/responses', authType: 'bearer' } };
  const codex = runtimeExecutionConfig(base, custom);
  assert.equal(codex.agentEnv.PERSONAL_AGENT_MODEL_API_KEY, 'test-secret');
  assert.equal(codex.appServerConfig['model_providers.personal_agent_runtime.wire_api'], 'responses');
  assert.equal(codex.appServerConfig['model_providers.personal_agent_runtime.base_url'], 'https://models.example.test/v1');
  assert.doesNotMatch(JSON.stringify(codex.appServerArgs), /test-secret/);
  const claude = runtimeExecutionConfig(base, { ...custom, engine: 'claude-code', profile: { ...custom.profile, baseUrl: 'https://models.example.test/v1/messages' } });
  assert.equal(claude.agentEnv.ANTHROPIC_AUTH_TOKEN, 'test-secret');
  assert.equal(claude.agentEnv.ANTHROPIC_API_KEY, undefined);
  assert.equal(claude.agentEnv.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(claude.agentEnv.ANTHROPIC_BASE_URL, 'https://models.example.test');
  assert.equal(base.agentEnv.CLAUDE_CODE_OAUTH_TOKEN, 'old-account');
});

test('Claude executes stdin literally, applies Harness, maps tools and usage, redacts provider secrets', async (t) => {
  const { root, file } = fixture(t, 'claude.mjs', claudeSource);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Product Harness rules');
  const events = [];
  const result = await runRuntimeCommand({ sessionId: 'claude-protocol', workspace: root, claudeCommand: file,
    harnessRoot: root, runtimeStateRoot: root, appServerApprovalPolicy: 'never', cliSessionId: 'previous-claude',
    appServerDeveloperInstructions: 'private turn context', stdin: '!echo do-not-execute $(touch unsafe)',
    runtimeExecution: { engine: 'claude-code', credential: 'super-secret', profile: { mode: 'custom', model: 'claude-test', reasoningEffort: 'high', baseUrl: 'https://models.example.test', authType: 'bearer' } },
    onSessionEvent: event => events.push(event) });
  assert.equal(result.success, true);
  const reply = events.find(e => e.kind === 'session.assistant_message');
  const output = JSON.parse(reply.payload.content);
  assert.match(output.text, /!echo do-not-execute/);
  assert.match(output.text, /private turn context/);
  assert.equal(output.args[output.args.indexOf('--resume')+1], 'previous-claude');
  assert.equal(output.args[output.args.indexOf('--permission-mode')+1], 'dontAsk');
  assert.equal(output.args.includes('--dangerously-skip-permissions'), false);
  assert.equal(output.auth, '[REDACTED]');
  assert.equal(events.some(e => e.kind === 'session.tool_use'), true);
  assert.equal(events.some(e => e.kind === 'session.tool_result'), true);
  assert.equal(events.filter(e => e.kind === 'session.assistant_message').length, 1);
  assert.equal(events.find(e => e.kind === 'session.token_usage').payload.tokenUsage.last.totalTokens, 30);
  assert.equal(events.at(-1).payload.cliSessionId, 'previous-claude');
  assert.deepEqual(fs.readdirSync(path.join(root, 'runtime', 'claude-turns')), []);
  assert.doesNotMatch(JSON.stringify(events), /super-secret/);
});

test('Claude failures and cancellation cannot report success; active input queues', async (t) => {
  const { root, file } = fixture(t, 'claude.mjs', claudeSource);
  const base = { sessionId: 'claude-cancel', workspace: root, claudeCommand: file,
    runtimeExecution: { engine: 'claude-code', profile: { mode: 'account' } }, onSessionEvent: () => {} };
  assert.equal((await runRuntimeCommand({ ...base, stdin: 'FAIL_RESULT' })).success, false);
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const run = runRuntimeCommand({ ...base, stdin: 'WAIT_FOREVER', onSessionEvent: event => { if (event.payload?.metadata?.eventType === 'claude/init') started(); } });
  await ready;
  assert.equal(await steerRuntimeTurn(base.sessionId, 'queued input'), false);
  assert.equal(stopRuntimeCommand(base.sessionId), true);
  const result = await run;
  assert.equal(result.status, 'interrupted');
  assert.equal(result.success, false);
  assert.equal(stopRuntimeCommand(base.sessionId), false);
});

test('isolated Codex transports execute custom providers and redact all credential echoes', async (t) => {
  const { root, file } = fixture(t, 'codex.mjs', codexSource);
  const run = async (sessionId, credential, model) => {
    const events = [];
    const result = await runRuntimeCommand({ sessionId, workspace: root, appServerCommand: process.execPath, appServerArgs: [file],
      stdin: '!literal external command', runtimeExecution: { engine: 'codex', credential,
        profile: { mode: 'custom', model, baseUrl: 'https://model.example.test/v1', authType: 'api-key' } }, onSessionEvent: e => events.push(e) });
    return { result, events };
  };
  // Different mock thread IDs would match production UUIDs; run serially to exercise cleanup/resume.
  for (const [sessionId, credential, model] of [['codex-one','secret-one','model-one'],['codex-two','secret-two','model-two']]) {
    const { result, events } = await run(sessionId, credential, model);
    assert.equal(result.success, true);
    const output = JSON.parse(events.find(e => e.kind === 'session.assistant_message').payload.content);
    assert.equal(output.params.model, model);
    assert.equal(output.params.input[0].text, '!literal external command');
    assert.equal(output.secret, '[REDACTED]');
    assert.doesNotMatch(JSON.stringify(events), new RegExp(credential));
  }
});

test('account probe abort signal kills its actual Claude process and returns false', async (t) => {
  const { root, file } = fixture(t, 'claude.mjs', claudeSource.replace("text.includes('WAIT_FOREVER')", 'true'));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150);
  const started = Date.now();
  const result = await probeRuntimeAccount({ engine: 'claude-code', profile: { mode: 'account' } },
    { workspace: root, claudeCommand: file }, controller.signal);
  clearTimeout(timer);
  assert.equal(result, false);
  assert.ok(Date.now() - started < 3000);
});
