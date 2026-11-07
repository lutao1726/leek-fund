import { WebviewPanel } from 'vscode';
import { LeekFundConfig } from '../shared/leekConfig';
import { events } from '../shared/utils';

const installed = new WeakSet<WebviewPanel>();
export function installBossMode(panel: WebviewPanel) {
  if (!installed.has(panel)) {
    installed.add(panel);
    const listener = panel.webview.onDidReceiveMessage(async message => {
      if (message.command === 'bossModeToggle' && typeof message.data === 'boolean') await LeekFundConfig.setConfig('leek-fund.bossMode', message.data);
    });
    const update = () => panel.webview.postMessage({ command: 'bossMode', data: !!LeekFundConfig.getConfig('leek-fund.bossMode', false) });
    events.on('onDidChangeConfiguration', update);
    panel.onDidDispose(() => { listener.dispose(); events.off('onDidChangeConfiguration', update); });
  }
  if (panel.webview.html.includes('id="leek-boss-mode"')) return;
  const enabled = !!LeekFundConfig.getConfig('leek-fund.bossMode', false);
  const injection = `<style>body.boss-mode iframe,body.boss-mode img{filter:grayscale(1)!important}#leek-boss-mode{position:fixed;z-index:10000;top:6px;left:12px;padding:5px 10px;background:var(--vscode-button-secondaryBackground,#444);color:var(--vscode-button-secondaryForeground,#fff);border:0;border-radius:3px;cursor:pointer}</style><button id="leek-boss-mode" type="button" aria-pressed="${enabled}">老板模式</button><script>(function(){const api=acquireVsCodeApi();const button=document.getElementById('leek-boss-mode');const apply=(enabled)=>{document.body.classList.toggle('boss-mode',enabled);button.setAttribute('aria-pressed',String(enabled));button.textContent='老板模式：'+(enabled?'开':'关')};apply(${JSON.stringify(enabled)});button.onclick=()=>{const enabled=!document.body.classList.contains('boss-mode');apply(enabled);api.postMessage({command:'bossModeToggle',data:enabled})};window.addEventListener('message',event=>{if(event.data.command==='bossMode')apply(event.data.data===true)})})();</script>`;
  panel.webview.html = panel.webview.html.replace('</body>', injection + '</body>');
}
