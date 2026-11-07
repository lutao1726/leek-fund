import { commands, ExtensionContext, TreeView, window, workspace } from 'vscode';
import StockService from './explorer/stockService';
import { StockProvider } from './explorer/stockProvider';
import { LeekTreeItem } from './shared/leekTreeItem';
import { stockGroups } from './service/stockGroups';
import { portfolio } from './service/portfolio';
import { DEFAULT_GROUP } from './shared/watchlist';
import leekCenterView from './webview/leekCenterView';
import { research } from './service/research';
import { LeekFundConfig } from './shared/leekConfig';

export function registerStockTools(context: ExtensionContext, service: StockService, provider: StockProvider, tree: TreeView<LeekTreeItem>) {
  const register = (id: string, run: (...args: any[]) => unknown) => context.subscriptions.push(commands.registerCommand(`leek-fund.${id}`, async (...args) => {
    try { return await run(...args); }
    catch (error) { window.showErrorMessage((error as Error).message); }
  }));
  const groupName = (value = '') => window.showInputBox({ title: '股票分组名称', value, validateInput: name => !name.trim() || name.trim().length > 40 ? '请输入 1～40 个字符' : undefined });
  register('openPresentationSettings', () => leekCenterView(service, '/settings'));
  register('openSectorBoards', () => leekCenterView(service, '/sector-boards'));
  register('openMarketCloudMap', () => leekCenterView(service, '/market-map'));
  register('openStockChanges', () => leekCenterView(service, '/stock-changes'));
  register('openQuoteByCode', async (code: string) => {
    const item = service.stockList.find(stock => stock.info.code === code);
    if (!item?.command?.command || item.type === 'nodata') { window.showInformationMessage('该标的行情暂不可用'); return; }
    await commands.executeCommand(item.command.command, ...(item.command.arguments || []));
  });

  register('addStockGroup', async () => { const name = await groupName(); if (name !== undefined) await stockGroups.add(name); });
  register('renameStockGroup', async (target: LeekTreeItem) => {
    const id = provider.groupId(target);
    const group = stockGroups.read().groups.find(item => item.id === id);
    if (!group) return;
    const name = await groupName(group.name);
    if (name !== undefined) await stockGroups.rename(group.id, name);
  });
  register('deleteStockGroup', async (target: LeekTreeItem) => {
    const id = provider.groupId(target);
    if (!id || id === DEFAULT_GROUP) throw new Error('默认分组不能删除');
    const answer = await window.showWarningMessage('删除分组后，组内股票会移回默认分组，自选和持仓将保留。', { modal: true }, '删除分组');
    if (answer) await stockGroups.remove(id);
  });
  register('toggleStockGroups', async () => {
    await stockGroups.update(book => book);
    await workspace.getConfiguration('leek-fund', null).update('useStockGroups', !provider.customGroups, true);
  });
  register('moveStockToGroup', async (target: LeekTreeItem) => {
    if (!target || target.isCategory) return;
    const selected = await window.showQuickPick(stockGroups.read().groups.map(group => ({ label: group.name, id: group.id })), { placeHolder: '移动到分组' });
    if (!selected) return;
    await stockGroups.move([target.info.code], selected.id);
    await workspace.getConfiguration('leek-fund', null).update('useStockGroups', true, true);
  });
  register('sortStockBy', async () => {
    const selected = await window.showQuickPick([
      { label: '手动顺序', order: 0 }, { label: '涨跌幅升序', order: 1 }, { label: '涨跌幅降序', order: -1 },
      { label: '成交额升序', order: 3 }, { label: '成交额降序', order: -3 },
    ], { placeHolder: '选择排序方式；拖拽和置顶会恢复手动顺序' });
    if (selected) await workspace.getConfiguration('leek-fund', null).update('stockSort', selected.order, true);
  });
  register('openPortfolio', () => leekCenterView(service, '/portfolio'));
  register('openResearch', () => leekCenterView(service, '/research'));
  register('openDailySummary', () => leekCenterView(service, '/daily-summary'));
  register('openLearning', () => leekCenterView(service, '/learning'));
  register('inspectPortfolio', () => {
    const job = research.startPortfolio();
    leekCenterView(service, `/research?job=${job.id}`);
  });
  register('exportPortfolio', () => portfolio.export());
  register('importPortfolio', () => portfolio.import());
  register('locateWatchlist', async () => {
    const codes: string[] = LeekFundConfig.getConfig('leek-fund.stocks', []);
    if (!codes.length) { window.showInformationMessage('请先添加股票自选'); return; }
    const groups = stockGroups.read().groups;
    const selected = await window.showQuickPick(codes.map(code => {
      const quote = service.stockList.find(item => item.info.code === code);
      const group = groups.find(item => item.codes.includes(code));
      return { label: quote?.info.name || code, description: code,
        detail: `${group?.name || '默认分组'} · 涨跌幅 ${quote?.info.percent || '--'}%`, code };
    }), { title: '自选快速定位', placeHolder: '搜索股票名称或代码', matchOnDescription: true, matchOnDetail: true });
    if (!selected) return;
    const action = await window.showQuickPick(['在侧栏定位', '打开实时走势', '在韭菜中心打开', 'AI 分析', '置顶']);
    if (!action) return;
    const item = await provider.findByCode(selected.code);
    if (!item) { window.showWarningMessage('自选已变更，请重试'); return; }
    if (action === '在侧栏定位') await tree.reveal(item, { select: true, focus: true, expand: true });
    if (action === '在韭菜中心打开') leekCenterView(service, '/my-stocks', selected.code);
    if (action === '打开实时走势') {
      if (item.type === 'nodata' || !item.command?.command) { window.showWarningMessage('该标的行情尚未加载'); return; }
      await commands.executeCommand(item.command.command, ...(item.command.arguments || []));
    }
    if (action === 'AI 分析') {
      if (!['aStock', 'hkStock', 'usStock'].includes(item.contextValue || '')) { window.showWarningMessage('该标的暂不支持 AI 分析'); return; }
      await commands.executeCommand('leek-fund.aiStockAnalysis', item);
    }
    if (action === '置顶') await commands.executeCommand('leek-fund.setStockTop', item);
  });
}
