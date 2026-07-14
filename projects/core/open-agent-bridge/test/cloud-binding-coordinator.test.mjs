import assert from 'node:assert/strict';
import test from 'node:test';
import { CloudBindingCoordinator } from '../src/channels/cloud-binding-coordinator.js';

test('WeChat Cloud binding intercepts the password before Agent persistence and reports service readiness', async () => {
  const sent = [];
  const logins = [];
  const coordinator = new CloudBindingCoordinator({
    dataRoot: '/private/site/data',
    wechat: { sendText: async (recipientId, text) => sent.push({ recipientId, text }) },
    login: async (input) => {
      logins.push(input);
      return { serviceReadiness: {
        publicDomain: { value: 'owner.chenjianhui.site' },
        agentMail: { value: 'agent@owner.chenjianhui.site' },
        managedMail: { enabled: true },
        managedConfiguration: { enabled: true },
      } };
    },
    now: () => 1000,
  });
  assert.equal(await coordinator.consumeWechatMessage({ senderId: 'wx-user', text: '云账号绑定 12345678' }), true);
  assert.match(sent[0].text, /不会写入 Agent 会话/);
  assert.equal(await coordinator.consumeWechatMessage({ senderId: 'wx-user', text: 'correct horse battery staple' }), true);
  assert.deepEqual(logins, [{ githubUserId: '12345678', password: 'correct horse battery staple', dataRoot: '/private/site/data' }]);
  assert.match(sent[1].text, /邮件服务：已启用/);
  assert.equal(await coordinator.consumeWechatMessage({ senderId: 'wx-user', text: 'ordinary conversation' }), false);
});

test('WeChat Cloud binding is one-time, cancellable, bounded, and never echoes a failed password', async () => {
  let now = 1000;
  const sent = [];
  const coordinator = new CloudBindingCoordinator({
    wechat: { sendText: async (_recipientId, text) => sent.push(text) },
    login: async () => { throw new Error('failure includes DO_NOT_ECHO_PASSWORD'); },
    now: () => now,
    ttlMs: 100,
  });
  await coordinator.consumeWechatMessage({ senderId: 'wx-user', text: '绑定云账号 12345678' });
  assert.equal(await coordinator.consumeWechatMessage({ senderId: 'wx-user', text: '取消绑定' }), true);
  await coordinator.consumeWechatMessage({ senderId: 'wx-user', text: '绑定云账号 12345678' });
  assert.equal(await coordinator.consumeWechatMessage({ senderId: 'wx-user', text: 'DO_NOT_ECHO_PASSWORD' }), true);
  assert.doesNotMatch(sent.join('\n'), /DO_NOT_ECHO_PASSWORD/);
  await coordinator.consumeWechatMessage({ senderId: 'wx-user', text: '绑定云账号 12345678' });
  now = 1200;
  assert.equal(await coordinator.consumeWechatMessage({ senderId: 'wx-user', text: 'ordinary conversation' }), false);
});
