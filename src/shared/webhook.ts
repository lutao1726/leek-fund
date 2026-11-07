import { createHmac } from 'crypto';
export type WebhookProvider = 'wecom' | 'dingtalk' | 'feishu';
export interface WebhookTarget { provider: WebhookProvider; url: string; secret?: string }

export function validateWebhook(target: WebhookTarget): WebhookTarget {
  if (!target || !['wecom', 'dingtalk', 'feishu'].includes(target.provider)) throw new Error('请选择机器人平台');
  let url: URL;
  try { url = new URL(target.url); } catch { throw new Error('Webhook 地址不正确'); }
  const valid = url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && (
    target.provider === 'wecom' ? url.hostname === 'qyapi.weixin.qq.com' && url.pathname === '/cgi-bin/webhook/send' && !!url.searchParams.get('key') :
    target.provider === 'dingtalk' ? url.hostname === 'oapi.dingtalk.com' && url.pathname === '/robot/send' && !!url.searchParams.get('access_token') :
    ['open.feishu.cn', 'open.larksuite.com'].includes(url.hostname) && /^\/open-apis\/bot\/v2\/hook\/[\w-]+$/.test(url.pathname));
  if (!valid) throw new Error('请填写对应平台的 HTTPS 机器人 Webhook 地址');
  if (target.secret !== undefined && (typeof target.secret !== 'string' || target.secret.length > 500)) throw new Error('签名密钥格式不正确');
  return { provider: target.provider, url: url.toString(), secret: target.secret || undefined };
}

export function buildWebhook(target: WebhookTarget, text: string, now = Date.now()) {
  const valid = validateWebhook(target);
  const url = new URL(valid.url);
  if (valid.provider === 'feishu') {
    const timestamp = String(Math.floor(now / 1000));
    const signed = valid.secret ? { timestamp, sign: createHmac('sha256', `${timestamp}\n${valid.secret}`).update('').digest('base64') } : {};
    return { url: url.toString(), body: { msg_type: 'text', content: { text }, ...signed } };
  }
  if (valid.provider === 'dingtalk' && valid.secret) {
    const timestamp = String(now);
    url.searchParams.set('timestamp', timestamp);
    url.searchParams.set('sign', createHmac('sha256', valid.secret).update(`${timestamp}\n${valid.secret}`).digest('base64'));
  }
  return { url: url.toString(), body: { msgtype: 'text', text: { content: text } } };
}

export function webhookSucceeded(provider: WebhookProvider, response: any): boolean {
  if (!response || typeof response !== 'object') return false;
  return provider === 'feishu' ? (response.code !== undefined ? response.code === 0 : response.StatusCode === 0) : response.errcode === 0;
}
