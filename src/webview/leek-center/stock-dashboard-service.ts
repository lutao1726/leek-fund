import { WebviewPanel } from 'vscode';
import { eastMoneyDataServer } from '../../service/eastmoney';

/** Keep a dashboard lease per mounted page, including pages opened in standalone panels. */
export function registerStockDashboardService(panel: WebviewPanel): void {
  let active: { owner: object; requestId: string } | undefined;
  const release = () => {
    if (!active) return;
    const owner = active.owner;
    active = undefined;
    void eastMoneyDataServer.release(owner);
  };
  const messages = panel.webview.onDidReceiveMessage(async (message) => {
    const requestId = message?.data?.requestId;
    if (typeof requestId !== 'string' || requestId.length > 100) return;
    if (message.command === 'stopStockDashboard') {
      if (active?.requestId === requestId) release();
      return;
    }
    if (message.command !== 'startStockDashboard') return;
    release();
    const current = { owner: {}, requestId };
    active = current;
    try {
      await eastMoneyDataServer.acquire(current.owner);
      if (active === current) {
        void panel.webview.postMessage({ command: 'stockDashboardStatus', data: { requestId, ready: true } });
      }
    } catch (error) {
      if (active === current) {
        active = undefined;
        void panel.webview.postMessage({ command: 'stockDashboardStatus', data: {
          requestId, ready: false, error: error instanceof Error ? error.message : '资金大屏服务启动失败',
        } });
      }
    }
  });
  panel.onDidDispose(() => {
    messages.dispose();
    release();
  });
}
