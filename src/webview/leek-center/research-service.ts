import { WebviewPanel, window, workspace } from 'vscode';
import { research } from '../../service/research';
import { researchMarkdown } from '../../shared/research';

export function registerResearchService(panel: WebviewPanel): void {
  let selected: string | undefined;
  const postState = () => { void panel.webview.postMessage({ command: 'researchState', data: research.state() }); };
  const postDetail = () => { void panel.webview.postMessage({ command: 'researchDetail', data: selected ? research.find(selected) || null : null }); };
  const unsubscribe = research.subscribe(job => {
    postState();
    if (!job || job.id === selected) postDetail();
  });
  const messages = panel.webview.onDidReceiveMessage(async message => {
    if (!['getResearch', 'selectResearch', 'startStockResearch', 'startPortfolioResearch', 'cancelResearch', 'retryResearch', 'deleteResearch', 'exportResearch'].includes(message?.command)) return;
    try {
      const id = message.data?.id;
      if (['selectResearch', 'cancelResearch', 'retryResearch', 'deleteResearch', 'exportResearch'].includes(message.command) && (typeof id !== 'string' || id.length > 100)) throw new Error('研究记录编号无效');
      switch (message.command) {
        case 'getResearch': postState(); postDetail(); return;
        case 'selectResearch': selected = id; postDetail(); return;
        case 'startStockResearch': selected = research.startStock(message.data?.code, message.data?.name).id; break;
        case 'startPortfolioResearch': selected = research.startPortfolio().id; break;
        case 'cancelResearch': research.cancel(id); break;
        case 'retryResearch': selected = research.retry(id).id; break;
        case 'deleteResearch': research.remove(id); if (selected === id) selected = undefined; break;
        case 'exportResearch': {
          const job = research.find(id);
          if (!job) throw new Error('研究记录已不存在');
          const uri = await window.showSaveDialog({ filters: { '研究报告 Markdown': ['md'] }, saveLabel: '导出报告' });
          if (uri) await workspace.fs.writeFile(uri, Buffer.from(researchMarkdown(job), 'utf8'));
          return;
        }
      }
      postState(); postDetail();
      void panel.webview.postMessage({ command: 'researchActionResult', data: { success: true, id: selected } });
    } catch (error) {
      void panel.webview.postMessage({ command: 'researchActionResult', data: { success: false, error: error instanceof Error ? error.message : '研究操作失败' } });
    }
  });
  panel.onDidDispose(() => { unsubscribe(); messages.dispose(); });
}
