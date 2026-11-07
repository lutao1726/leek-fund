/*--------------------------------------------------------------
 *  Copyright (c) Nicky<giscafer@outlook.com>. All rights reserved.
 *  Licensed under the BSD-3-Clause License.
 *  Github: https://github.com/giscafer
 *-------------------------------------------------------------*/

import { ConfigurationChangeEvent, ExtensionContext, TreeView, window, workspace } from 'vscode';
import { BinanceProvider } from './explorer/binanceProvider';
import BinanceService from './explorer/binanceService';
import { ForexProvider } from './explorer/forexProvider';
import { ForexService } from './explorer/forexService';
import { NewsProvider } from './explorer/newsProvider';
import { StockProvider } from './explorer/stockProvider';
import StockService from './explorer/stockService';
import globalState from './globalState';
import FlashNewsDaemon from './output/flash-news/FlashNewsDaemon';
import FlashNewsOutputServer from './output/flash-news/FlashNewsOutputServer';
import { registerCommandPaletteEvent, registerViewEvent } from './registerCommand';
import { HolidayHelper } from './shared/holidayHelper';
import { LeekFundConfig } from './shared/leekConfig';
import Log from './shared/log';
import { Telemetry } from './shared/telemetry';
import { events, isStockTime } from './shared/utils';
import { ProfitStatusBar } from './statusbar/Profit';
import { StatusBar } from './statusbar/statusBar';
import { cacheStocksRemindData } from './webview/leekCenterView';
import { cacheStockPriceData } from './webview/setStockPrice';
import { disposeProxyServer } from './webview/proxyService/proxyService';
import { eastMoneyDataServer } from './service/eastmoney';
import { registerStockTools } from './registerStockTools';
import { research } from './service/research';
import { webhook } from './service/webhook';
import { BlameQuotes } from './service/blame';
import { NewsPanel } from './webview/newsPanel';
import { marketData } from './service/marketData';
import { agent } from './service/agent';
import { AgentView } from './webview/agentView';
import { registerAgentChat } from './service/agentChat';
import { commands } from 'vscode';

let loopTimer: NodeJS.Timeout | null = null;
let pollingStopped = false;
let binanceLoopTimer: NodeJS.Timeout | null = null;
let forexLoopTimer: NodeJS.Timeout | null = null;
let stockTreeView: TreeView<any> | null = null;
let forexTreeView: TreeView<any> | null = null;
let binanceTreeView: TreeView<any> | null = null;

let flashNewsOutputServer: FlashNewsOutputServer | null = null;
let profitBar: ProfitStatusBar | null = null;

export async function activate(context: ExtensionContext) {
  globalState.isDevelopment = process.env.NODE_ENV === 'development';
  globalState.context = context;
  webhook.initialize(context);
  marketData.initialize();
  context.subscriptions.push(marketData);
  context.subscriptions.push(webhook);
  const newsPanel = new NewsPanel();
  context.subscriptions.push(newsPanel, window.registerWebviewViewProvider('leekFundView.flashNews', newsPanel));

  const telemetry = new Telemetry();
  globalState.telemetry = telemetry;

  let intervalTimeConfig = LeekFundConfig.getConfig('leek-fund.interval', 5000);

  // 节假日，异步会存在延迟判断准确问题，设置成同步影响插件激活速度，暂使用异步
  HolidayHelper.isHolidayInChina().then((isHoliday) => {
    globalState.isHolidayChina = isHoliday;
  });

  setGlobalVariable();

  flashNewsOutputServer = new FlashNewsOutputServer();

  const stockService = new StockService(context);
  await research.initialize(context, stockService);
  await agent.initialize(context, stockService);
  const agentView = new AgentView(context);
  context.subscriptions.push(window.registerWebviewViewProvider('leekFundView.agent', agentView, { webviewOptions: { retainContextWhenHidden: true } }),
    commands.registerCommand('leek-fund.openAgent', () => agentView.open()),
    commands.registerCommand('leek-fund.agentExplain', (item: any) => agentView.open('/explain ' + (item?.info?.code || item?.code || ''))));
  registerAgentChat(context);
  const binanceService = new BinanceService(context);
  const forexService = new ForexService(context);

  const nodeStockProvider = new StockProvider(stockService);
  const binanceProvider = new BinanceProvider(binanceService);
  const forexProvider = new ForexProvider(forexService);
  const newsProvider = new NewsProvider();

  const statusBar = new StatusBar(stockService);
  context.subscriptions.push(statusBar, new BlameQuotes(stockService));
  profitBar = new ProfitStatusBar();

  stockTreeView = window.createTreeView('leekFundView.stock', {
    treeDataProvider: nodeStockProvider,
    dragAndDropController: nodeStockProvider,
    canSelectMany: true,
  });
  context.subscriptions.push(stockTreeView);
  registerStockTools(context, stockService, nodeStockProvider, stockTreeView);

  binanceTreeView = window.createTreeView('leekFundView.binance', {
    treeDataProvider: binanceProvider,
  });

  forexTreeView = window.createTreeView('leekFundView.forex', {
    treeDataProvider: forexProvider,
  });

  window.createTreeView('leekFundView.news', {
    treeDataProvider: newsProvider,
  });

  pollingStopped = false;
  const refreshQuotes = () => nodeStockProvider.refresh();
  let pollingGeneration = 0;
  const loopCallback = async () => {
    if (pollingStopped) return;
    const generation = pollingGeneration;
    try {
      if (isStockTime()) await refreshQuotes();
    } catch (error) { Log.error('Quote polling failed: ' + error); }
    finally {
      if (!pollingStopped && generation === pollingGeneration) {
        const delay = isStockTime() ? Math.max(3000, intervalTimeConfig) : Math.min(60000, Math.max(3000, intervalTimeConfig * 100));
        loopTimer = setTimeout(loopCallback, delay);
      }
    }
  };
  const setIntervalTime = () => {
    pollingGeneration++;
    if (loopTimer) clearTimeout(loopTimer);
    loopTimer = setTimeout(loopCallback, Math.max(3000, intervalTimeConfig));
  };
  void refreshQuotes().catch(error => Log.error('Initial quote fetch failed: ' + error));
  setIntervalTime();
  binanceLoopTimer = setInterval(() => { if (binanceTreeView?.visible) binanceProvider.refresh(); }, 300000);
  forexLoopTimer = setInterval(() => { if (forexTreeView?.visible) forexProvider.refresh(); }, 120000);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  workspace.onDidChangeConfiguration((e: ConfigurationChangeEvent) => {
    if (!e.affectsConfiguration('leek-fund')) return;
    Log.info('Configuration changed');
    if (e.affectsConfiguration('leek-fund.interval')) {
      intervalTimeConfig = LeekFundConfig.getConfig('leek-fund.interval', 5000);
      setIntervalTime();
    }
    setGlobalVariable();
    statusBar.refresh();
    const quotesChanged = ['stocks', 'stockPrice', 'showStockIndustry'].some(key => e.affectsConfiguration('leek-fund.' + key));
    if (quotesChanged) void nodeStockProvider.refresh();
    else if (['stockSort', 'stockGroups', 'useStockGroups', 'showStockIndustry', 'groupStockByIndustry', 'labelFormat', 'iconType', 'stockHeldTipShow'].some(key => e.affectsConfiguration('leek-fund.' + key))) void nodeStockProvider.refresh(false);
    if (e.affectsConfiguration('leek-fund.newsUserIds')) newsProvider.refresh();
    if (e.affectsConfiguration('leek-fund.binance')) binanceProvider.refresh();
    flashNewsOutputServer?.reload();
    events.emit('onDidChangeConfiguration');
    profitBar?.reload();
  });

  // register event
  registerViewEvent(
    context,
    stockService,
    nodeStockProvider,
    newsProvider,
    flashNewsOutputServer,
    binanceProvider,
    forexProvider
  );

  // register command
  registerCommandPaletteEvent(context, statusBar);

  // Telemetry Event
  telemetry.sendEvent('activate');
}

function setGlobalVariable() {
  const stockPrice = LeekFundConfig.getConfig('leek-fund.stockPrice') || {};
  cacheStockPriceData(stockPrice);

  globalState.iconType = LeekFundConfig.getConfig('leek-fund.iconType') || 'arrow';

  globalState.stockHeldTipShow = LeekFundConfig.getConfig('leek-fund.stockHeldTipShow') ?? true;

  const stocksRemind = LeekFundConfig.getConfig('leek-fund.stocksRemind') || {};
  cacheStocksRemindData(stocksRemind);

  globalState.showEarnings = LeekFundConfig.getConfig('leek-fund.showEarnings');

  globalState.remindSwitch = LeekFundConfig.getConfig('leek-fund.stockRemindSwitch');

  globalState.kLineChartSwitch = LeekFundConfig.getConfig('leek-fund.stockKLineChartSwitch');

  globalState.labelFormat = LeekFundConfig.getConfig('leek-fund.labelFormat');

  globalState.immersiveBackground = LeekFundConfig.getConfig('leek-fund.immersiveBackground', true);
}

// this method is called when your extension is deactivated
export async function deactivate() {
  pollingStopped = true;
  Log.info('deactivate');
  FlashNewsDaemon.KillAllServer();
  profitBar?.destroy();
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
  if (binanceLoopTimer) {
    clearInterval(binanceLoopTimer);
    binanceLoopTimer = null;
  }
  if (forexLoopTimer) {
    clearInterval(forexLoopTimer);
    forexLoopTimer = null;
  }
  await Promise.all([eastMoneyDataServer.dispose(), disposeProxyServer()]);
}
