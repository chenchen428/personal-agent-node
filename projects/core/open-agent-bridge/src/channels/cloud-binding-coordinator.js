import { completeCloudResourceAuthorization, startCloudResourceAuthorization } from '../../../node/src/cloud-resources.mjs';

const START_PATTERN = /^(?:云账号绑定|绑定云账号)$/;
const CANCEL_PATTERN = /^(?:取消绑定|取消云账号绑定)$/;

export class CloudBindingCoordinator {
  constructor({
    wechat,
    dataRoot,
    start = startCloudResourceAuthorization,
    complete = completeCloudResourceAuthorization,
    now = Date.now,
    ttlMs = 10 * 60_000,
  } = {}) {
    this.wechat = wechat;
    this.dataRoot = dataRoot;
    this.start = start;
    this.complete = complete;
    this.now = now;
    this.ttlMs = ttlMs;
    this.pending = new Map();
    this.activeCompletions = new Set();
  }

  async consumeWechatMessage(message = {}) {
    const senderId = String(message.senderId || '').trim();
    const text = String(message.text || '').trim();
    if (!senderId || !text) return false;
    this.prune();

    if (CANCEL_PATTERN.test(text) && this.pending.has(senderId)) {
      const pending = this.pending.get(senderId);
      pending.cancelled = true;
      this.pending.delete(senderId);
      await this.wechat.sendText(senderId, '已取消云账号浏览器授权。本地不会保存未完成授权的 token。');
      return true;
    }
    if (!START_PATTERN.test(text)) return false;

    const previous = this.pending.get(senderId);
    if (previous) previous.cancelled = true;
    try {
      const authorization = await this.start({ dataRoot: this.dataRoot });
      const pending = { ...authorization, cancelled: false, expiresAt: this.now() + this.ttlMs };
      this.pending.set(senderId, pending);
      const publicAuthorization = authorization.authorization;
      await this.wechat.sendText(senderId, [
        '请在浏览器中完成 Personal Agent Cloud 免密授权：',
        publicAuthorization.verificationUrlComplete || publicAuthorization.verificationUrl,
        `授权码：${publicAuthorization.userCode}`,
        '授权成功后，我会主动发送域名、邮箱和服务检测结果。无需提供 GitHub 用户 ID 或密码。回复“取消绑定”可取消本次提示。',
      ].join('\n'));
      const completion = this.finish(senderId, pending);
      this.activeCompletions.add(completion);
      completion.finally(() => this.activeCompletions.delete(completion));
    } catch {
      await this.wechat.sendText(senderId, '暂时无法发起云账号浏览器授权，请检查 Cloud 地址和网络状态后重试“云账号绑定”。');
    }
    return true;
  }

  async finish(senderId, pending) {
    try {
      const result = await this.complete({ ...pending, dataRoot: this.dataRoot });
      if (pending.cancelled || this.pending.get(senderId) !== pending) return;
      this.pending.delete(senderId);
      const services = result.serviceReadiness;
      await this.wechat.sendText(senderId, [
        '云账号浏览器授权完成。资源 token 已安全保存到本机。',
        `公网域名：${services.publicDomain.value || '未检测到'}`,
        `Agent 邮箱：${services.agentMail.value || '未检测到'}`,
        `邮件服务：${services.managedMail.enabled ? '已启用' : '默认关闭'}`,
        `配置服务：${services.managedConfiguration.enabled ? '已启用' : '默认关闭'}`,
      ].join('\n'));
    } catch {
      if (pending.cancelled || this.pending.get(senderId) !== pending) return;
      this.pending.delete(senderId);
      await this.wechat.sendText(senderId, '云账号浏览器授权未完成或已过期。请重新发送“云账号绑定”获取新的授权链接。');
    }
  }

  async waitForIdle() {
    await Promise.allSettled([...this.activeCompletions]);
  }

  prune() {
    const now = this.now();
    for (const [senderId, pending] of this.pending) {
      if (pending.expiresAt <= now) {
        pending.cancelled = true;
        this.pending.delete(senderId);
      }
    }
  }
}
