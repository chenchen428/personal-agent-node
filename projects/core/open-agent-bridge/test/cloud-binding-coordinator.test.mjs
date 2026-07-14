import assert from 'node:assert/strict';
import test from 'node:test';
import { CloudBindingCoordinator } from '../src/channels/cloud-binding-coordinator.js';

const pendingAuthorization = {
  baseUrl: 'https://chenjianhui.site',
  authorization: {
    deviceCode: 'private-device-code-that-must-not-be-sent',
    userCode: 'ABCD-EFGH',
    verificationUrl: 'https://chenjianhui.site/connect',
    verificationUrlComplete: 'https://chenjianhui.site/connect?code=ABCD-EFGH',
    expiresIn: 600,
    interval: 5,
  },
};

test('WeChat Cloud binding sends a browser link and proactively reports service readiness', async () => {
  const sent = [];
  const completions = [];
  const coordinator = new CloudBindingCoordinator({
    dataRoot: '/private/site/data',
    wechat: { sendText: async (recipientId, text) => sent.push({ recipientId, text }) },
    start: async () => pendingAuthorization,
    complete: async (input) => {
      completions.push(input);
      return { serviceReadiness: {
        publicDomain: { value: 'owner.chenjianhui.site' },
        agentMail: { value: 'agent@owner.chenjianhui.site' },
        managedMail: { enabled: true },
        managedConfiguration: { enabled: true },
      } };
    },
    now: () => 1000,
  });
  assert.equal(await coordinator.consumeWechatMessage({ senderId: 'wx-user', text: '云账号绑定' }), true);
  await coordinator.waitForIdle();
  assert.match(sent[0].text, /浏览器.*免密授权|无需提供 GitHub 用户 ID 或密码/);
  assert.match(sent[0].text, /connect\?code=ABCD-EFGH/);
  assert.doesNotMatch(sent[0].text, /private-device-code/);
  assert.equal(completions[0].dataRoot, '/private/site/data');
  assert.equal(completions[0].authorization.deviceCode, pendingAuthorization.authorization.deviceCode);
  assert.match(sent[1].text, /邮件服务：已启用/);
  assert.equal(await coordinator.consumeWechatMessage({ senderId: 'wx-user', text: 'ordinary conversation' }), false);
});

test('WeChat browser authorization is cancellable and never intercepts ordinary conversation', async () => {
  const sent = [];
  let resolveCompletion;
  const coordinator = new CloudBindingCoordinator({
    wechat: { sendText: async (_recipientId, text) => sent.push(text) },
    start: async () => pendingAuthorization,
    complete: async () => await new Promise((resolve) => { resolveCompletion = resolve; }),
    now: () => 1000,
  });
  await coordinator.consumeWechatMessage({ senderId: 'wx-user', text: '绑定云账号' });
  assert.equal(await coordinator.consumeWechatMessage({ senderId: 'wx-user', text: 'ordinary conversation' }), false);
  assert.equal(await coordinator.consumeWechatMessage({ senderId: 'wx-user', text: '取消绑定' }), true);
  resolveCompletion({ serviceReadiness: {
    publicDomain: { value: 'owner.chenjianhui.site' },
    agentMail: { value: 'agent@owner.chenjianhui.site' },
    managedMail: { enabled: true },
    managedConfiguration: { enabled: true },
  } });
  await coordinator.waitForIdle();
  assert.match(sent.join('\n'), /已取消云账号浏览器授权/);
  assert.doesNotMatch(sent.join('\n'), /浏览器授权完成/);
});

test('WeChat browser authorization failures do not expose sensitive backend details', async () => {
  const sent = [];
  const coordinator = new CloudBindingCoordinator({
    wechat: { sendText: async (_recipientId, text) => sent.push(text) },
    start: async () => pendingAuthorization,
    complete: async () => { throw new Error('backend leaked private-device-code-that-must-not-be-sent'); },
  });
  await coordinator.consumeWechatMessage({ senderId: 'wx-user', text: '云账号绑定' });
  await coordinator.waitForIdle();
  assert.match(sent.at(-1), /未完成或已过期/);
  assert.doesNotMatch(sent.join('\n'), /private-device-code/);
});
