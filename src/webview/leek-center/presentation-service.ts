import { WebviewPanel } from 'vscode';
import StockService from '../../explorer/stockService';
import { LeekFundConfig } from '../../shared/leekConfig';
import { DISPLAY_DEFAULTS, DisplayPreferences, validatePreferences } from '../../shared/presentation';
import { events } from '../../shared/utils';
import { webhook } from '../../service/webhook';
import { clearXuanGuBaoAccount, saveXuanGuBaoAccount, xuanGuBaoAccountStatus } from '../../shared/xgbAuth';

export function readPreferences(): DisplayPreferences {
  const result = { ...DISPLAY_DEFAULTS };
  for (const key of Object.keys(DISPLAY_DEFAULTS) as (keyof DisplayPreferences)[]) {
    const value = LeekFundConfig.getConfig('leek-fund.' + key, DISPLAY_DEFAULTS[key]);
    (result as any)[key] = typeof DISPLAY_DEFAULTS[key] === 'boolean' ? !!value : value;
  }
  result.statusBarFormat = LeekFundConfig.getConfig('leek-fund.labelFormat', {}).statusBarLabelFormat || DISPLAY_DEFAULTS.statusBarFormat;
  return result;
}

export function registerPresentationBridge(panel: WebviewPanel, stocks: StockService) {
  let disposed = false;
  const send = async () => {
    const hooks = await webhook.status();
    const xuanGuBao = await xuanGuBaoAccountStatus();
    if (disposed || !panel.visible) return;
    panel.webview.postMessage({ command: 'presentationSettings', data: { settings: readPreferences(), webhook: hooks, xuanGuBao,
      stocks: LeekFundConfig.getConfig('leek-fund.stocks', []).map((code: string) => ({ code, name: stocks.stockList.find(item => item.info.code === code)?.info.name || code })) } });
  };
  const listener = panel.webview.onDidReceiveMessage(async message => {
    if (message.command === 'getPresentationSettings') { await send(); return; }
    if (['saveXuanGuBaoAccount', 'clearXuanGuBaoAccount'].includes(message.command)) {
      try {
        if (message.command === 'saveXuanGuBaoAccount') await saveXuanGuBaoAccount(message.data);
        else await clearXuanGuBaoAccount();
        panel.webview.postMessage({ command: 'xuanGuBaoAccountStatus', data: await xuanGuBaoAccountStatus() });
        panel.webview.postMessage({ command: 'presentationResult', data: { success: true, command: message.command } });
      } catch (error) {
        panel.webview.postMessage({ command: 'presentationResult', data: { success: false, command: message.command, error: (error as Error).message } });
      }
      return;
    }
    if (!['savePresentationSettings', 'saveWebhook', 'removeWebhook', 'toggleWebhook', 'setBossMode'].includes(message.command)) return;
    try {
      if (message.command === 'savePresentationSettings') {
        const settings = validatePreferences(message.data);
        for (const key of Object.keys(settings) as (keyof DisplayPreferences)[]) {
          if (key === 'statusBarFormat') {
            const old = LeekFundConfig.getConfig('leek-fund.labelFormat', {});
            if (old.statusBarLabelFormat !== settings[key]) await LeekFundConfig.setConfig('leek-fund.labelFormat', { ...old, statusBarLabelFormat: settings[key] });
          } else if (JSON.stringify(LeekFundConfig.getConfig('leek-fund.' + key)) !== JSON.stringify(settings[key])) {
            await LeekFundConfig.setConfig('leek-fund.' + key, settings[key]);
          }
        }
      } else if (message.command === 'setBossMode') {
        if (typeof message.data !== 'boolean') throw new Error('老板模式开关值不正确');
        await LeekFundConfig.setConfig('leek-fund.bossMode', message.data);
      } else if (message.command === 'saveWebhook') await webhook.save(message.data);
      else if (message.command === 'removeWebhook') await webhook.remove(message.data.provider);
      else {
        if (typeof message.data.enabled !== 'boolean') throw new Error('开关值不正确');
        await LeekFundConfig.setConfig('leek-fund.webhookEnabled', message.data.enabled);
      }
      if (message.command === 'savePresentationSettings') await send();
      else if (message.command !== 'setBossMode') panel.webview.postMessage({ command: 'webhookStatus', data: await webhook.status() });
      panel.webview.postMessage({ command: 'presentationResult', data: { success: true, command: message.command } });
    } catch (error) { panel.webview.postMessage({ command: 'presentationResult', data: { success: false, command: message.command, error: (error as Error).message } }); }
  });
  let bossMode = !!LeekFundConfig.getConfig('leek-fund.bossMode', false);
  const notify = () => {
    const current = !!LeekFundConfig.getConfig('leek-fund.bossMode', false);
    if (!disposed && current !== bossMode) { bossMode = current; panel.webview.postMessage({ command: 'presentationChanged', data: { bossMode } }); }
  };
  events.on('onDidChangeConfiguration', notify);
  panel.onDidDispose(() => { disposed = true; listener.dispose(); events.off('onDidChangeConfiguration', notify); });
}
