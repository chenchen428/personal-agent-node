import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { attachSkillCatalog, disableNativeCodexSkills, assertNativeSkillsDisabled } from '../src/skills/runtime-policy.ts';
import { readWorkspaceSkillCatalog } from '../src/skills/catalog.js';
import { runRuntimeCommand } from '../src/agent/runtime-runner.ts';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cove-skill-runner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const release = path.join(root, 'release'), workspace = path.join(root, 'workspace');
  fs.mkdirSync(path.join(release, 'registry'), { recursive: true }); fs.mkdirSync(workspace);
  const put = (base, folder, name = folder) => { const dir = path.join(base, 'skills', folder); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} fixture metadata\n---\nPRIVATE_BODY_NOT_INDEXED`); };
  put(release, 'cove-runtime'); put(workspace, 'my-summary');
  fs.writeFileSync(path.join(release, 'registry/skills.json'), JSON.stringify({ skills: [{ name: 'cove-runtime', directory: 'skills/cove-runtime' }] }));
  return { root, release, workspace, put, config: { workspace, skillReleaseRoot: release, stdin: 'work', appServerDeveloperInstructions: 'original runtime contract' } };
}

test('UI and both engines receive the same ids and metadata, with bodies loaded only on demand', t => {
  const f = fixture(t), runtime = attachSkillCatalog(f.config), ui = readWorkspaceSkillCatalog(f.workspace, { releaseRoot: f.release });
  assert.deepEqual(runtime.coveSkills.map(s => s.id), ui.skills.map(s => s.id));
  assert.match(runtime.appServerDeveloperInstructions, /original runtime contract/);
  assert.match(runtime.coveSkillInstructions, /my-summary/);
  assert.doesNotMatch(runtime.coveSkillInstructions, /PRIVATE_BODY_NOT_INDEXED/);
  f.put(f.workspace, 'new-summary');
  assert.equal(attachSkillCatalog(f.config).coveSkills.length, 3);
});

test('explicit skills resolve by source id; ambiguous or retired names cannot use native slash input', t => {
  const f = fixture(t); f.put(f.workspace, 'cove-runtime');
  assert.throws(() => attachSkillCatalog({ ...f.config, stdin: '/cove-runtime do work' }), /同名/);
  assert.throws(() => attachSkillCatalog({ ...f.config, stdin: '/frontend-design do work' }), /未启用/);
  const selected = attachSkillCatalog({ ...f.config, stdin: '/builtin:skills/cove-runtime do work' });
  assert.match(selected.stdin, /先读取该 SKILL.md/); assert.equal(selected.coveOriginalInput, '/builtin:skills/cove-runtime do work');
});

test('native isolation is process and thread scoped, and unsupported enablement fails closed', async t => {
  const f = fixture(t), native = [{ path: path.join(f.workspace, 'skills/my-summary/SKILL.md'), enabled: true }];
  const config = disableNativeCodexSkills(f.config, native);
  assert.equal(config.appServerConfig['skills.config'][0].enabled, false);
  assert.ok(config.appServerArgs.some(value => value.startsWith('skills.config=')));
  await assert.rejects(assertNativeSkillsDisabled({ call: async () => ({ data: [{ skills: native }] }) }, f.workspace), /未执行/);
  await assert.rejects(assertNativeSkillsDisabled({ call: async () => ({}) }, f.workspace), /不支持/);
  assert.equal(fs.existsSync(path.join(f.workspace, '.codex/config.toml')), false);
});

const codexFixture = `import readline from 'node:readline';
const args=process.argv.slice(2), disabled=args.some(a=>a.startsWith('skills.config=')&&a.includes('enabled=false'));
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');let thread;
readline.createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(q.id===undefined)return;
if(q.method==='skills/list')send({id:q.id,result:{data:[{skills:[{path:process.env.FIXTURE_SKILL_PATH,enabled:!disabled,name:'native-only'}],errors:[]}]}});
else if(q.method==='thread/start'||q.method==='thread/resume'){thread={method:q.method,params:q.params};send({id:q.id,result:{thread:{id:'cove-thread'},model:'fixture-model'}});}
else if(q.method==='turn/start'){send({id:q.id,result:{turn:{id:'turn'}}});send({method:'item/completed',params:{threadId:'cove-thread',turnId:'turn',item:{type:'agentMessage',id:'message',text:JSON.stringify({disabled,thread,input:q.params.input,mode:q.params.collaborationMode})}}});send({method:'turn/completed',params:{threadId:'cove-thread',turn:{id:'turn',status:'completed'}}});}
else send({id:q.id,result:{}});});`;

test('Codex runner verifies disabled native discovery before start and resume and refreshes the source catalog', async t => {
  const f = fixture(t), binary = path.join(f.root, 'codex.mjs'); fs.writeFileSync(binary, codexFixture);
  const run = async (cliSessionId) => {
    const events = []; const result = await runRuntimeCommand({ ...f.config, sessionId: 'cove-codex', cliSessionId,
      appServerCommand: process.execPath, appServerArgs: [binary], agentEnv: { ...process.env, FIXTURE_SKILL_PATH: path.join(f.workspace, 'skills/my-summary/SKILL.md') },
      runtimeExecution: { engine: 'codex', profile: { mode: 'account' } }, onSessionEvent: e => events.push(e) });
    assert.equal(result.success, true);
    return JSON.parse(events.find(e => e.kind === 'session.assistant_message').payload.content);
  };
  const started = await run(undefined); assert.equal(started.disabled, true); assert.equal(started.thread.method, 'thread/start');
  assert.match(started.thread.params.developerInstructions, /my-summary/); assert.equal(started.thread.params.config['skills.config'][0].enabled, false);
  f.put(f.workspace, 'next-turn-skill');
  const resumed = await run('cove-thread'); assert.equal(resumed.thread.method, 'thread/resume'); assert.match(resumed.thread.params.developerInstructions, /next-turn-skill/); assert.match(resumed.mode.settings.developer_instructions, /next-turn-skill/); assert.equal(resumed.mode.settings.model, 'fixture-model');
});

const claudeFixture = `import fs from 'node:fs';const args=process.argv.slice(2);let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>{
const file=args[args.indexOf('--append-system-prompt-file')+1];const answer=JSON.stringify({args,text,system:fs.readFileSync(file,'utf8')});process.stdout.write(JSON.stringify({type:'result',subtype:'success',session_id:'cove-claude',result:answer})+'\\n');});`;

test('Claude disables native skills and receives the same source index in a scoped system prompt', async t => {
  const f = fixture(t), binary = path.join(f.root, 'claude.mjs'); fs.writeFileSync(binary, claudeFixture);
  const events = []; const result = await runRuntimeCommand({ ...f.config, stdin: '/my-summary work', sessionId: 'cove-claude',
    claudeCommand: binary, runtimeExecution: { engine: 'claude-code', profile: { mode: 'account' } }, onSessionEvent: e => events.push(e) });
  assert.equal(result.success, true); const answer = JSON.parse(events.find(e => e.kind === 'session.assistant_message').payload.content);
  assert.ok(answer.args.includes('--disable-slash-commands')); assert.match(answer.system, /builtin:skills\/cove-runtime/); assert.match(answer.system, /user:skills\/my-summary/);
  assert.doesNotMatch(answer.system, /PRIVATE_BODY_NOT_INDEXED/); assert.match(answer.text, /先读取该 SKILL.md/);
  assert.equal(events.find(e => e.kind === 'session.user_message').payload.content, '/my-summary work');
  assert.deepEqual(fs.readdirSync(path.join(f.workspace, 'runtime/claude-turns')), []);
});
