import { commands, WebviewPanel } from 'vscode';
import StockService from '../../explorer/stockService';
import FlashNewsDaemon from '../../output/flash-news/FlashNewsDaemon';
import { buildDailySummary, DailySummarySnapshot } from '../../shared/dailySummary';
import { LeekFundConfig } from '../../shared/leekConfig';
import { events } from '../../shared/utils';
import { portfolio } from '../../service/portfolio';
import { research } from '../../service/research';

/** One visible summary page consumes shared quotes/news; it owns no network poller. */
export class DailySummaryBridge {
  private active = false;
  private disposed = false;
  private timer?: NodeJS.Timeout;
  private clockTimer?: NodeJS.Timeout;
  private signature = '';
  private refreshing = false;
  private latest?: DailySummarySnapshot;
  private disposables: { dispose(): unknown }[] = [];
  private stopResearch: () => void;
  private stopNews: () => void;

  constructor(private panel: WebviewPanel, private stocks: StockService) {
    this.stopResearch = research.subscribe(this.schedule);
    this.stopNews = FlashNewsDaemon.onNews(this.schedule);
    ['stockListUpdate', 'portfolioChanged', 'onDidChangeConfiguration'].forEach(event => events.on(event, this.schedule));
    this.disposables.push(panel.webview.onDidReceiveMessage(message => { void this.receive(message); }),
      panel.onDidChangeViewState(() => this.visibility()), panel.onDidDispose(() => this.dispose()));
  }

  private visible() { return this.active && this.panel.visible && !this.disposed; }
  private schedule = () => {
    if (!this.visible() || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.post(); }, 300);
  };
  private visibility() {
    if (this.timer) clearTimeout(this.timer);
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.timer = undefined; this.clockTimer = undefined;
    if (!this.visible()) return;
    this.post(true);
    this.clockTimer = setInterval(() => this.post(), 60000);
  }
  private post(force = false) {
    if (!this.visible()) return;
    try {
      const snapshot = buildDailySummary({ watched: LeekFundConfig.getConfig('leek-fund.stocks', []),
        positions: portfolio.read(), quotes: this.stocks.stockList.map(item => item.info),
        jobs: research.history(), researchError: research.state().storageError, news: FlashNewsDaemon.cachedNews() });
      this.latest = snapshot;
      const signature = JSON.stringify({ ...snapshot, generatedAt: '' });
      if (force || signature !== this.signature) {
        this.signature = signature;
        void this.panel.webview.postMessage({ command: 'dailySummarySnapshot', data: snapshot });
      }
    } catch {
      void this.panel.webview.postMessage({ command: 'dailySummaryError', data: '摘要暂时无法生成，请刷新重试；已有数据保留。' });
    }
  }
  private async receive(message: any) {
    if (this.disposed) return;
    switch (message?.command) {
      case 'startDailySummary': this.active = true; this.visibility(); return;
      case 'stopDailySummary': this.active = false; this.visibility(); return;
      case 'refreshDailySummary':
        if (!this.visible() || this.refreshing) return;
        this.refreshing = true;
        void this.panel.webview.postMessage({ command: 'dailySummaryRefreshing', data: true });
        try { await commands.executeCommand('leek-fund.refreshStock'); }
        catch { if (this.visible()) void this.panel.webview.postMessage({ command: 'dailySummaryError', data: '行情刷新失败，保留已有摘要，可稍后重试。' }); }
        finally {
          this.refreshing = false;
          if (this.visible()) {
            this.post(true);
            void this.panel.webview.postMessage({ command: 'dailySummaryRefreshing', data: false });
          }
        }
        return;
      case 'openDailySummaryStock': {
        const code = message.data?.code;
        if (!this.visible() || typeof code !== 'string' || !this.latest?.rows.some(row => row.code === code)) return;
        if (!this.stocks.stockList.some(item => item.info.code.toLowerCase() === code)) {
          void this.panel.webview.postMessage({ command: 'dailySummaryError', data: '该标的行情尚未加载，请刷新后重试。' });
          return;
        }
        void this.panel.webview.postMessage({ command: 'navigate', data: { route: '/my-stocks', code } });
        return;
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.visibility();
    ['stockListUpdate', 'portfolioChanged', 'onDidChangeConfiguration'].forEach(event => events.off(event, this.schedule));
    this.stopResearch(); this.stopNews();
    this.disposables.splice(0).forEach(item => item.dispose());
  }
}
