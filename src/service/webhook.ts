import axios from 'axios';
import { ExtensionContext, window } from 'vscode';
import { LeekFundConfig } from '../shared/leekConfig';
import { buildWebhook, validateWebhook, WebhookProvider, WebhookTarget, webhookSucceeded } from '../shared/webhook';

export class WebhookService {
  private context?: ExtensionContext;
  private pending: Promise<unknown> = Promise.resolve();
  private active = true;
  private recent = new Map<string, number>();
  private generation = 0;
  private failures = 0;
  private queued = 0;
  private lastSent = new Map<WebhookProvider, number>();
  private delay?: { timer: NodeJS.Timeout; resolve: () => void };
  private cancel?: () => void;
  constructor(private intervalMs = 3100) {}

  initialize(context: ExtensionContext) { this.context = context; this.active = true; }
  private key(provider: WebhookProvider) { return 'leek-fund.webhook.' + provider; }
  async status() {
    const targets = await Promise.all((['wecom', 'dingtalk', 'feishu'] as WebhookProvider[]).map(async provider => ({ provider, configured: !!await this.context?.secrets.get(this.key(provider)) })));
    return { enabled: !!LeekFundConfig.getConfig('leek-fund.webhookEnabled', false), targets };
  }
  async save(target: WebhookTarget) {
    if (!this.context) throw new Error('Webhook 服务尚未初始化');
    const valid = validateWebhook(target);
    await this.context.secrets.store(this.key(valid.provider), JSON.stringify(valid));
    this.generation++;
  }
  async remove(provider: WebhookProvider) {
    if (!['wecom', 'dingtalk', 'feishu'].includes(provider)) throw new Error('不支持的平台');
    await this.context?.secrets.delete(this.key(provider)); this.generation++;
  }
  notify(key: string, text: string): Promise<void> {
    if (!this.active || !LeekFundConfig.getConfig('leek-fund.webhookEnabled', false)) return Promise.resolve();
    if (this.queued >= 30) { window.showWarningMessage('LeekFund：预警推送队列已满，本次仅保留编辑器内提醒。'); return Promise.resolve(); }
    const now = Date.now();
    if (now - (this.recent.get(key) || 0) < 180000) return Promise.resolve();
    this.recent.set(key, now);
    for (const [id, at] of this.recent) if (now - at > 180000) this.recent.delete(id);
    const generation = this.generation;
    this.queued++;
    const task = this.pending.then(async () => {
      if (!this.active || generation !== this.generation || !LeekFundConfig.getConfig('leek-fund.webhookEnabled', false)) return;
      for (const provider of ['wecom', 'dingtalk', 'feishu'] as WebhookProvider[]) {
        const raw = await this.context?.secrets.get(this.key(provider));
        if (!raw || !this.active || generation !== this.generation || !LeekFundConfig.getConfig('leek-fund.webhookEnabled', false)) continue;
        try {
          const wait = this.intervalMs - (Date.now() - (this.lastSent.get(provider) || 0));
          if (wait > 0) await new Promise<void>(resolve => { this.delay = { resolve, timer: setTimeout(() => { this.delay = undefined; resolve(); }, wait) }; });
          if (!this.active || generation !== this.generation || !LeekFundConfig.getConfig('leek-fund.webhookEnabled', false)) return;
          const request = buildWebhook(JSON.parse(raw), `LeekFund 价格预警\n${text}`);
          const cancellation = axios.CancelToken.source();
          this.cancel = () => cancellation.cancel();
          this.lastSent.set(provider, Date.now());
          const result = await axios.post(request.url, request.body, { timeout: 8000, maxRedirects: 0, cancelToken: cancellation.token });
          if (!webhookSucceeded(provider, result.data)) throw new Error('机器人未确认接收');
        } catch {
          // Never include Axios errors here: they contain the URL token and request payload.
          if (this.active && Date.now() - this.failures > 180000) {
            this.failures = Date.now();
            window.showWarningMessage(`LeekFund：${provider} 预警推送失败，请检查机器人配置和网络。`);
          }
        } finally { this.cancel = undefined; }
      }
    }).finally(() => { this.queued--; });
    this.pending = task.catch(() => {});
    return task;
  }
  dispose() { this.active = false; this.generation++; this.recent.clear(); this.cancel?.(); if (this.delay) { clearTimeout(this.delay.timer); this.delay.resolve(); this.delay = undefined; } }
}
export const webhook = new WebhookService();
