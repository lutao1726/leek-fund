import { WebviewView, WebviewViewProvider } from 'vscode';
import { randomBytes } from 'crypto';
import FlashNewsDaemon from '../output/flash-news/FlashNewsDaemon';
import { LeekFundConfig } from '../shared/leekConfig';
import { NewsEntry, normalizeNews } from '../shared/presentation';
import { events } from '../shared/utils';

export class NewsPanel implements WebviewViewProvider {
  private view?: WebviewView;
  private unsubscribe?: () => void;
  private entries = new Map<string, NewsEntry>();
  private timer?: NodeJS.Timeout;
  private paused = false;
  private source = 'all';
  private important = false;
  private closed = false;
  private disposables: { dispose(): unknown }[] = [];
  constructor() { events.on('onDidChangeConfiguration', this.reload); }
  resolveWebviewView(view: WebviewView) {
    this.view = view; this.closed = false;
    this.paused = false; this.source = 'all'; this.important = false;
    const nonce = randomBytes(16).toString('hex');
    view.webview.options = { enableScripts: true };
    view.webview.html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">body{font:var(--vscode-font-size) var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:12px}header{display:flex;gap:12px;align-items:center;position:sticky;top:0;padding:6px 0;background:var(--vscode-editor-background);flex-wrap:wrap}button,select{color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);padding:4px 8px}article{padding:10px 0;border-bottom:1px solid var(--vscode-panel-border);white-space:pre-wrap;line-height:1.6}small{opacity:.65}.important{border-left:3px solid var(--vscode-editorWarning-foreground);padding-left:8px}#hint{opacity:.7;padding:10px 0}</style></head><body><header><strong>LeekFund News</strong><select id="source" aria-label="新闻来源"><option value="all">全部来源</option><option value="jin10">金十</option><option value="xgb">选股宝</option></select><label><input type="checkbox" id="important">仅重要</label><button id="pause">暂停滚动</button><button id="clear">清空</button></header><div id="hint">连接快讯中…</div><main id="news"></main><script nonce="${nonce}">const vscode=acquireVsCodeApi();let paused=false;const send=(action)=>vscode.postMessage({command:'newsPanel',data:{action,source:document.getElementById('source').value,important:document.getElementById('important').checked}});document.getElementById('source').onchange=()=>send('filter');document.getElementById('important').onchange=()=>send('filter');document.getElementById('pause').onclick=()=>{paused=!paused;document.getElementById('pause').textContent=paused?'继续滚动':'暂停滚动';send(paused?'pause':'resume')};document.getElementById('clear').onclick=()=>send('clear');window.addEventListener('message',event=>{if(event.data.command!=='newsPanelSnapshot')return;const data=event.data.data;document.getElementById('hint').textContent=data.enabled?(data.entries.length?'报价与新闻来自第三方，时间按来源显示。':'暂无快讯，等待数据源推送。'):'底部快讯已关闭，可在个性化设置中开启。';const nearTop=window.scrollY<40;const root=document.getElementById('news');root.replaceChildren();data.entries.forEach(item=>{const article=document.createElement('article');if(item.important)article.className='important';const meta=document.createElement('small');meta.textContent=(item.source==='jin10'?'金十':'选股宝')+' · '+(item.time?new Date(item.time).toLocaleString():'时间未知');const text=document.createElement('div');text.textContent=item.text;article.append(meta,text);root.append(article)});if(nearTop&&!paused)window.scrollTo(0,0)});send('ready');</script></body></html>`;
    this.disposables.push(view.webview.onDidReceiveMessage(message => {
      if (message.command !== 'newsPanel') return;
      const data = message.data;
      if (!data || typeof data !== 'object') return;
      if (data.action === 'pause') { this.paused = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined; return; }
      if (data.action === 'resume') this.paused = false;
      if (data.action === 'clear') this.entries.clear();
      if (data.action === 'filter') { this.source = ['jin10', 'xgb'].includes(data.source) ? data.source : 'all'; this.important = data.important === true; }
      this.post();
    }), view.onDidChangeVisibility(this.reload), view.onDidDispose(() => { this.detach(); this.view = undefined; this.entries.clear(); this.disposables.splice(0).forEach(item => item.dispose()); }));
    this.reload();
  }
  private reload = () => {
    const enabled = LeekFundConfig.getConfig('leek-fund.newsPanelEnabled', true);
    if (!enabled || !this.view?.visible) this.detach();
    else if (!this.unsubscribe) this.unsubscribe = FlashNewsDaemon.registerServer({ print: (content, source) => {
      const entry = normalizeNews(content, source);
      if (!entry) return;
      this.entries.delete(entry.id); this.entries.set(entry.id, entry);
      while (this.entries.size > 500) this.entries.delete(this.entries.keys().next().value!);
      if (!this.timer && !this.paused) this.timer = setTimeout(() => { this.timer = undefined; this.post(); }, 250);
    }, destroy: () => this.detach() });
    this.post();
  };
  private post() {
    if (this.closed || !this.view?.visible) return;
    const entries = Array.from(this.entries.values()).reverse().filter(entry => (this.source === 'all' || entry.source === this.source) && (!this.important || entry.important));
    this.view.webview.postMessage({ command: 'newsPanelSnapshot', data: { entries, enabled: !!LeekFundConfig.getConfig('leek-fund.newsPanelEnabled', true) } });
  }
  private detach() { const unsubscribe = this.unsubscribe; this.unsubscribe = undefined; unsubscribe?.(); if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  dispose() { this.closed = true; this.detach(); events.off('onDidChangeConfiguration', this.reload); this.disposables.splice(0).forEach(item => item.dispose()); this.view = undefined; }
}
