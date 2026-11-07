import { WebviewPanel } from 'vscode';
import { MarketDataService, marketData } from '../../service/marketData';
import { assertBoard, assertStock, CHANGE_TYPES, StockScope } from '../../shared/market';
import { LeekFundConfig } from '../../shared/leekConfig';
import { events } from '../../shared/utils';

export class MarketPreferences {
  private pending: Promise<unknown> = Promise.resolve();
  read() {
    const raw = LeekFundConfig.getConfig('leek-fund.followedBoards', []);
    return Array.isArray(raw) ? Array.from(new Set<string>(raw.filter(code => typeof code === 'string' && /^BK\d{4}$/.test(code)))).slice(0, 100) : [];
  }
  change(action: 'follow' | 'addStock', params: any, signal: AbortSignal): Promise<void> {
    const code = action === 'follow' ? assertBoard(params?.code) : assertStock(params?.code);
    if (action === 'follow' && typeof params.follow !== 'boolean') return Promise.reject(new Error('关注状态不正确'));
    const task = this.pending.then(async () => {
      if (signal.aborted) throw new Error('操作已取消');
      if (action === 'follow') {
        const old = this.read();
        if (params.follow && !old.includes(code) && old.length >= 100) throw new Error('最多关注 100 个板块');
        await LeekFundConfig.setConfig('leek-fund.followedBoards', params.follow ? Array.from(new Set([...old, code])) : old.filter(value => value !== code));
      } else {
        const old: string[] = LeekFundConfig.getConfig('leek-fund.stocks', []);
        if (!old.includes(code)) await LeekFundConfig.setConfig('leek-fund.stocks', [...old, code]);
      }
    });
    this.pending = task.catch(() => {});
    return task;
  }
}
export const marketPreferences = new MarketPreferences();

/** Per-panel ownership; hidden/closed pages release every data request and timer owner. */
export class MarketBridge {
  private requests = new Map<string, { channel: string; controller: AbortController }>();
  private disposed = false;
  private signature = '';
  private disposables: { dispose(): unknown }[] = [];
  constructor(private panel: WebviewPanel, private data: MarketDataService = marketData) {
    this.disposables.push(panel.webview.onDidReceiveMessage(message => { void this.receive(message); }),
      panel.onDidChangeViewState(() => { if (!panel.visible) this.cancelAll(); this.state(); }), panel.onDidDispose(() => this.dispose()));
    events.on('onDidChangeConfiguration', this.state);
  }
  private state = () => {
    if (this.disposed) return;
    const data = { visible: this.panel.visible, followedBoards: marketPreferences.read(), watchedCodes: LeekFundConfig.getConfig('leek-fund.stocks', []), changeTypes: Object.entries(CHANGE_TYPES).map(([type, entry]) => ({ type: Number(type), label: entry.name, direction: entry.direction })) };
    const signature = JSON.stringify(data);
    if (signature !== this.signature) { this.signature = signature; this.panel.webview.postMessage({ command: 'marketState', data }); }
  };
  async receive(message: any) {
    if (this.disposed) return;
    if (message?.command === 'getMarketState' || message?.command === 'pageReady') { this.signature = ''; this.state(); return; }
    if (message?.command === 'cancelMarket') { this.requests.get(message.data)?.controller.abort(); this.requests.delete(message.data); return; }
    if (message?.command !== 'marketRequest') return;
    const { id, channel, action, params = {}, force = false } = message.data || {};
    if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id) || typeof channel !== 'string' || !/^[\w-]{1,80}$/.test(channel)) return;
    const post = (success: boolean, value?: unknown, error?: string) => { if (!this.disposed) this.panel.webview.postMessage({ command: 'marketReply', data: { id, success, value, error } }); };
    if (!this.panel.visible) { post(false, undefined, '页面已隐藏'); return; }
    if (this.requests.has(id)) { post(false, undefined, '请求编号重复'); return; }
    for (const [oldId, item] of this.requests) if (item.channel === channel) { item.controller.abort(); this.requests.delete(oldId); }
    if (this.requests.size >= 8) { post(false, undefined, '同时请求过多，请稍后重试'); return; }
    const entry = { channel, controller: new AbortController() }; this.requests.set(id, entry);
    const signal = entry.controller.signal;
    try {
      const page = params.page === undefined ? 1 : params.page;
      let value: unknown;
      switch (action) {
        case 'overview': value = await this.data.overview(signal, force === true); break;
        case 'boardQuote': value = await this.data.boardQuote(params.code, signal, force === true); break;
        case 'members': value = await this.data.members(params.code, page, signal, force === true); break;
        case 'leaders': value = await this.data.leaders(page, signal, force === true); break;
        case 'universe': value = await this.data.universe(params.scope as StockScope, page, signal, force === true); break;
        case 'changes': value = await this.data.changes(params.direction || 'all', params.type, page, signal, force === true); break;
        case 'profile': value = await this.data.profile(params.code, signal, force === true); break;
        case 'follow': case 'addStock': await marketPreferences.change(action, params, signal); this.state(); value = true; break;
        default: throw new Error('不支持的市场数据操作');
      }
      if (!signal.aborted) post(true, value);
    } catch (error) { if (!signal.aborted) post(false, undefined, error instanceof Error ? error.message : '市场数据暂不可用'); }
    finally { if (this.requests.get(id) === entry) this.requests.delete(id); }
  }
  private cancelAll() { this.requests.forEach(entry => entry.controller.abort()); this.requests.clear(); }
  dispose() { if (this.disposed) return; this.disposed = true; this.cancelAll(); events.off('onDidChangeConfiguration', this.state); this.disposables.splice(0).forEach(item => item.dispose()); }
}
