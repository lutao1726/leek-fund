import { startProxyServer } from './proxyService/proxyService';
import axios from 'axios';
import { EventEmitter } from 'events';
import { commands, ViewColumn, Webview, window } from 'vscode';
import StockService from '../explorer/stockService';
import globalState from '../globalState';
import { FlashNewsServerInterface } from '../output/flash-news/NewsFlushServiceAbstractClass';
import { LeekFundConfig } from '../shared/leekConfig';
import { LeekTreeItem } from '../shared/leekTreeItem';
import { events, formatHTMLWebviewResourcesUrl, getTemplateFileContent } from '../shared/utils';
import { AiService } from './leek-center/ai-service';
import { FlashNewsService } from './leek-center/flash-news-service';
import LeekCenterFlashNewsView from './leek-center/flash-news-view';
import ReusedWebviewPanel from './ReusedWebviewPanel';
import { getEastMoneyHost, getEastmoneyPort } from './proxyService/proxyConfig';
import { stockGroups } from '../service/stockGroups';
import { portfolio } from '../service/portfolio';
import { sortQuotes } from '../shared/watchlist';
import { registerPresentationBridge } from './leek-center/presentation-service';
import { registerResearchService } from './leek-center/research-service';
import { FetchBridge } from './fetchBridge';
import { QuoteUpdates } from '../shared/quoteUpdates';
import { MarketBridge } from './leek-center/market-service';
import { DailySummaryBridge } from './leek-center/daily-summary-service';
import { registerAgentBridge } from './leek-center/agent-service';
import { registerLearningService } from './leek-center/learning-service';

let _INITED = false;

let panelEvents: EventEmitter;

async function leekCenterView(stockService: StockService, route = '/my-stocks', code?: string) {
  await startProxyServer().catch(error => console.error('Proxy unavailable:', error));
  const panel = ReusedWebviewPanel.create('leekCenterWebview', `韭菜中心`, ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });

  if (_INITED) { panel.webview.postMessage({ command: 'navigate', data: { route, code } }); return; }
  _INITED = true;
  registerPresentationBridge(panel, stockService);
  registerResearchService(panel);
  registerLearningService(panel);
  registerAgentBridge(panel.webview, panel);
  new MarketBridge(panel);
  new DailySummaryBridge(panel, stockService);
  panelEvents = new EventEmitter();

  let flashNewsServer: FlashNewsServerInterface | undefined;

  setList(panel.webview, panelEvents, stockService, () => panel.visible);
  setStocksRemind(panel.webview, panelEvents);

  const fetchBridge = new FetchBridge(data => { panel.webview.postMessage({ command: 'fetchResponse', data }); });
  const flashNewsService = new FlashNewsService(panel.webview);
  const aiService = new AiService(panel.webview, flashNewsService);
  const sentTools = new Map<string, string>();
  const sendTool = (command: string, data: any, force: boolean) => {
    const signature = JSON.stringify(data);
    if (force || sentTools.get(command) !== signature) {
      sentTools.set(command, signature);
      panel.webview.postMessage({ command, data });
    }
  };
  const postTools = (force = false) => {
    if (!panel.visible) return;
    const book = stockGroups.read();
    const order = LeekFundConfig.getConfig('leek-fund.stockSort', 0);
    const quotesByCode = new Map(stockService.stockList.map(item => [item.info.code, item]));
    const sortedCodes = (codes: string[]) => order === 0 ? codes : sortQuotes(codes.map(code => ({ info: quotesByCode.get(code)?.info || { code, percent: undefined, amount: undefined } })), order).map(item => item.info.code);
    sendTool('updateStockGroups', {
      ...book, groups: book.groups.map(group => ({ ...group, codes: sortedCodes(group.codes) })), enabled: LeekFundConfig.getConfig('leek-fund.useStockGroups', false),
      heldCodes: sortedCodes(portfolio.read().filter(position => !position.isSellOut).map(position => position.code)),
    }, force === true);
    sendTool('portfolioSnapshot', { ...portfolio.snapshot(stockService), cryptoCodes: LeekFundConfig.getConfig('leek-fund.binance', []) }, force === true);
  };
  events.on('stockListUpdate', postTools);
  events.on('binanceListUpdate', postTools);
  events.on('onDidChangeConfiguration', postTools);
  events.on('portfolioChanged', postTools);
  panelEvents.on('pageReady', () => {
    postTools(true);
    panel.webview.postMessage({ command: 'navigate', data: { route, code } });
  });

  panel.webview.onDidReceiveMessage(async (message) => {
    panelEvents.emit('onDidReceiveMessage', message);
    switch (message.command) {
      case 'getPortfolio':
        postTools(true);
        return;
      case 'portfolioAction':
        try {
          const data = message.data;
          switch (data.action) {
            case 'save': await portfolio.save(data.position); break;
            case 'add': await portfolio.add(data.code, data.amount, data.price); break;
            case 'close': await portfolio.close(data.code, data.price); break;
            case 'delete': await portfolio.remove(data.code); break;
            case 'import': await portfolio.import(); break;
            case 'export': await portfolio.export(); break;
            default: throw new Error('未知持仓操作');
          }
          postTools();
          panel.webview.postMessage({ command: 'portfolioResult', data: { success: true } });
        } catch (error) {
          panel.webview.postMessage({ command: 'portfolioResult', data: { success: false, error: (error as Error).message } });
        }
        return;
      case 'alert':
        window.showErrorMessage(message.data);
        return;
      case 'fail':
        window.showErrorMessage('保存失败！');
        return;
      case 'pageReady':
        panelEvents.emit('pageReady');
        flashNewsServer = new LeekCenterFlashNewsView(panel.webview);
        return;
      case 'executeCommand':
        commands.executeCommand(message.data);
        return;
      case 'fetch':
        void fetchBridge.request(message.data);
        return;
      case 'cancelFetch':
        fetchBridge.cancel(message.data);
        return;
      case 'getStockWindVaneUrl': {
        const port = getEastmoneyPort();
        const host = getEastMoneyHost();
        const url = `${host}/zhuti/#ggfxb`;
        panel.webview.postMessage({
          command: 'stockWindVaneUrl',
          data: { url }
        });
        return;
      }

      case 'getNewsData':
      case 'refreshNews':
        flashNewsService.getNewsData();
        return;

      case 'getAiConfig':
      case 'updateAiConfig':
      case 'sendAIMessage':
        aiService.handleMessage(message);
        return;
    }
  }, undefined);

  panel.onDidChangeViewState(event => { if (event.webviewPanel.visible) { postTools(true); panelEvents.emit('syncQuotes'); } });

  panel.onDidDispose(() => {
    fetchBridge.dispose();
    events.off('stockListUpdate', postTools);
    events.off('binanceListUpdate', postTools);
    events.off('onDidChangeConfiguration', postTools);
    events.off('portfolioChanged', postTools);
    panelEvents.emit('onDidDispose');
    flashNewsServer?.destroy();
    _INITED = false;
  });

  const loadProductionContent = () => {
    const html = getTemplateFileContent(['leek-center', 'build', 'index.html'], panel.webview);
    const host = getEastMoneyHost();
    const url = `${host}/zhuti/#ggfxb`;
    panel.webview.html = html.replace('</head>', `<script>window.stockWindVaneUrl = ${JSON.stringify(url)};</script></head>`);
  };

  if (globalState.isDevelopment) {
    const DEV_URL = 'http://localhost:3030/';
    axios
      .get(DEV_URL)
      .then((res) => {
        const html = res.data;
        panel.webview.html = formatHTMLWebviewResourcesUrl(html, (link) => {
          return DEV_URL + link;
        });
      })
      .catch(() => {
        // 开发服务未启动时，自动降级到加载本地构建文件
        console.log('[开发模式] 连接调试服务失败，降级加载本地 Build 文件');
        loadProductionContent();
      });
  } else {
    loadProductionContent();
  }
}


function setStocksRemind(webview: Webview, panelEvents: EventEmitter) {
  // console.log('stockList: ', stockList);

  panelEvents.on('onDidReceiveMessage', (message) => {
    switch (message.command) {
      case 'saveRemind':
        console.log(JSON.parse(message.data));
        setStocksRemindCfgCb(JSON.parse(message.data));
        return;
    }
  });

  panelEvents.on('pageReady', () => {
    webview.postMessage({
      command: 'updateStockRemind',
      data: globalState.stocksRemind,
    });
  });

  const updateWebViewCfg = () => {
    console.log('updateStockRemind: ', globalState.stocksRemind);
    webview.postMessage({
      command: 'updateStockRemind',
      data: globalState.stocksRemind,
    });
  };
  events.on('onDidChangeConfiguration', updateWebViewCfg);

  panelEvents.on('onDidDispose', () => {
    events.off('onDidChangeConfiguration', updateWebViewCfg);
  });
}

function setList(
  webview: Webview,
  panelEvents: EventEmitter,
  stockService: StockService,
  panelVisible: () => boolean
) {
  const updates = new QuoteUpdates();
  const post = (data: LeekTreeItem[], force = false) => {
    if (!panelVisible()) return;
    const delta = updates.next(data, force);
    if (!delta) return;
    if (delta.full) webview.postMessage({ command: 'updateStockList', data: delta.updates });
    else webview.postMessage({ command: 'updateStockQuotes', data: delta });
  };
  const onUpdate = (data: LeekTreeItem[]) => post(data);
  const sync = () => post(stockService.stockList, true);
  events.on('stockListUpdate', onUpdate);
  panelEvents.on('pageReady', sync);
  panelEvents.on('syncQuotes', sync);
  panelEvents.on('onDidDispose', () => { events.off('stockListUpdate', onUpdate); });
}

export function setStocksRemindCfgCb(cfg: Object) {
  LeekFundConfig.setConfig('leek-fund.stocksRemind', cfg).then(
    () => {
      window.showInformationMessage('价格预警保存成功！');
      cacheStocksRemindData(cfg);
    },
    (err) => {
      console.error(err);
    }
  );
}

export function cacheStocksRemindData(remindObj: Object) {
  globalState.stocksRemind = remindObj;
}

export default leekCenterView;
