import { loginCloudResources } from '../../../node/src/cloud-resources.mjs';

const START_PATTERN = /^(?:云账号绑定|绑定云账号)\s+([1-9][0-9]{0,19})$/;

export class CloudBindingCoordinator {
  constructor({ wechat, dataRoot, login = loginCloudResources, now = Date.now, ttlMs = 5 * 60_000 } = {}) {
    this.wechat = wechat;
    this.dataRoot = dataRoot;
    this.login = login;
    this.now = now;
    this.ttlMs = ttlMs;
    this.pending = new Map();
  }

  async consumeWechatMessage(message = {}) {
    const senderId = String(message.senderId || '').trim();
    const text = String(message.text || '').trim();
    if (!senderId || !text) return false;
    this.prune();
    const start = START_PATTERN.exec(text);
    if (start) {
      this.pending.set(senderId, { githubUserId: start[1], expiresAt: this.now() + this.ttlMs });
      await this.wechat.sendText(senderId, '已进入一次性云账号绑定流程。请在 5 分钟内单独发送 Cloud 密码；该条密码不会写入 Agent 会话、消息历史或本地配置。回复“取消绑定”可退出。');
      return true;
    }
    const pending = this.pending.get(senderId);
    if (!pending) return false;
    this.pending.delete(senderId);
    if (text === '取消绑定') {
      await this.wechat.sendText(senderId, '已取消云账号绑定。');
      return true;
    }
    if (Array.isArray(message.attachments) && message.attachments.length) {
      await this.wechat.sendText(senderId, '绑定失败：密码消息不能包含附件，请重新回复“云账号绑定 <GitHub数字用户ID>”。');
      return true;
    }
    try {
      const result = await this.login({ githubUserId: pending.githubUserId, password: text, dataRoot: this.dataRoot });
      const services = result.serviceReadiness;
      await this.wechat.sendText(senderId, [
        '云账号绑定完成，密码未保存。',
        `公网域名：${services.publicDomain.value}`,
        `Agent 邮箱：${services.agentMail.value}`,
        `邮件服务：${services.managedMail.enabled ? '已启用' : '默认关闭'}`,
        `配置服务：${services.managedConfiguration.enabled ? '已启用' : '默认关闭'}`,
      ].join('\n'));
    } catch {
      await this.wechat.sendText(senderId, '云账号绑定失败。请确认 GitHub 数字用户 ID、Cloud 密码和网络状态，然后重新开始绑定。');
    }
    return true;
  }

  prune() {
    const now = this.now();
    for (const [senderId, pending] of this.pending) if (pending.expiresAt <= now) this.pending.delete(senderId);
  }
}
