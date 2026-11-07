const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert').strict;

function load(file, mocks, timers = {}) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  vm.runInNewContext(js, {
    exports, require: id => { if (!(id in mocks)) throw Error('Unexpected dependency ' + id); return mocks[id]; },
    console: { log() {}, info() {}, error() {} }, Buffer, setTimeout: () => 0, clearTimeout() {},
    setInterval: () => 0, clearInterval() {}, ...timers,
  }, { filename: file });
  return exports;
}
function defer() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

async function main() {
  const requests = [];
  const industry = defer();
  const axios = { get(url) { requests.push(url); if (url.includes('eastmoney')) return industry.promise; return Promise.resolve({ data: '' }); } };
  const globalState = { stockPrice: {}, telemetry: { sendEvent() {} } };
  const mocks = {
    axios: { default: axios }, 'iconv-lite': { decode: x => x }, vscode: { window: { showErrorMessage() {} } },
    '../globalState': { default: globalState }, '../shared/leekConfig': { LeekFundConfig: { getConfig: () => false, setConfig() {} } },
    '../shared/leekTreeItem': { LeekTreeItem: class {} }, '../shared/remindNotification': { executeStocksRemind() {} },
    '../shared/utils': { events: { emit() {} }, sortData: x => x, randHeader: () => ({}) },
    '../shared/xueqiu-helper': {}, './leekService': { LeekService: class {} }, moment: require('moment'),
    'moment-timezone': require('moment-timezone'), '../shared/log': { default: {} }, '../shared/tencentStock': {},
    '../shared/portfolio': { readPositions: () => [] },
  };
  const StockService = load('src/explorer/stockService.ts', mocks).default;
  const service = new StockService({});
  const first = service.getData(['sh600000'], 0);
  const duplicate = service.getData(['sh600000'], 0);
  assert.equal(first, duplicate);
  await first;
  assert.equal(requests.filter(url => url.includes('eastmoney')).length, 1);
  assert.equal(requests.filter(url => url.includes('hq.sinajs')).length, 1);
  industry.resolve({ data: { data: { diff: [] } } });
  await Promise.resolve(); await Promise.resolve();
  await service.getData(['sh600000'], 0);
  assert.equal(requests.filter(url => url.includes('eastmoney')).length, 1, 'missing industry is negatively cached');
  console.log('PASS coalesced requests, nonblocking industry lookup and negative cache');

  const queued = new StockService({});
  const gates = [];
  queued.updateIndustry = async () => {};
  queued.getStockData = codes => { const gate = defer(); gates.push({ gate, codes }); return gate.promise; };
  queued.getHKStockData = async () => [];
  const old = queued.getData(['sh600000'], 0);
  for (let i = 0; gates.length < 1 && i < 10; i++) await Promise.resolve();
  const newer = queued.getData(['sh600001'], 0);
  assert.equal(gates.length, 1, 'a new request waits for the current one');
  gates[0].gate.resolve([{ info: { code: 'sh600000', price: '10' } }]);
  await old;
  for (let i = 0; gates.length < 2 && i < 10; i++) await Promise.resolve();
  assert.equal(gates.length, 2);
  assert.equal(queued.stockList.length, 0, 'obsolete result was not committed');
  gates[1].gate.resolve([{ info: { code: 'sh600001', price: '12' } }]);
  await newer;
  assert.equal(queued.stockList[0].info.price, '12');
  console.log('PASS serialized requests and obsolete response protection');

  const burst = new StockService({});
  burst.updateIndustry = async () => {};
  const requestedCodes = [];
  burst.getStockData = async codes => { requestedCodes.push(codes[0]); return []; };
  burst.getHKStockData = async () => [];
  await Promise.all(Array.from({ length: 50 }, (_, index) => burst.getData(['sh' + index], 0)));
  assert.equal(requestedCodes.length, 1);
  assert.equal(requestedCodes[0], 'sh49');
  console.log('PASS 50 queued revisions issue only the latest HTTP batch');

  const fallback = new StockService({});
  fallback.stockList = [{ info: { code: 'sh600000', price: '10' } }];
  fallback.updateIndustry = async () => {};
  fallback.getStockData = async () => { throw Error('network'); };
  fallback.getHKStockData = async () => [];
  await fallback.getData(['sh600000'], 0);
  assert.equal(fallback.stockList[0].info.price, '10');
  console.log('PASS failed market retains last known quote');

  const activeIntervals = new Set(), activeTimeouts = new Set(); let sequence = 0;
  class Socket { constructor() { this.handlers = {}; } addEventListener(name, fn) { this.handlers[name] = fn; } removeAllListeners() {} close() {} send() {} }
  Socket.OPEN = 1;
  const Jin10 = load('src/output/flash-news/impl/Jin10FlushService.ts', {
    ws: Socket, '../../../globalState': { default: globalState }, '../NewsFlushServiceAbstractClass': { default: class {} },
  }, {
    setInterval: () => { activeIntervals.add(++sequence); return sequence; },
    clearInterval: id => activeIntervals.delete(id),
    setTimeout: fn => { activeTimeouts.add(++sequence); return sequence; },
    clearTimeout: id => activeTimeouts.delete(id),
  }).default;
  const news = new Jin10({});
  news.ws.handlers.open(); news.openSocket(); news.ws.handlers.open();
  assert.equal(activeIntervals.size, 1);
  news.ws.handlers.close(); assert.equal(activeTimeouts.size, 1);
  news.destroy(); assert.equal(activeIntervals.size, 0); assert.equal(activeTimeouts.size, 0);
  console.log('PASS reconnect and destroy clean up heartbeat and reconnect timers');
  const { QuoteUpdates } = load('src/shared/quoteUpdates.ts', {});
  const transport = new QuoteUpdates();
  const rows = Array.from({ length: 1000 }, (_, index) => ({ id: String(index), info: { code: String(index), price: '10', name: 'test' } }));
  assert.equal(transport.next(rows).full, true);
  assert.equal(transport.next(rows), undefined);
  const changed = rows.map((row, index) => index === 4 ? { ...row, info: { ...row.info, price: '11' } } : row);
  const delta = transport.next(changed);
  assert.equal(delta.updates.length, 1);
  assert.equal(delta.updates[0].info.price, '11');
  assert(JSON.stringify(delta).length < JSON.stringify(changed).length / 5);
  const removed = transport.next(changed.slice(1).reverse());
  assert.equal(removed.removed[0], '0');
  assert.equal(removed.order[0], '999');
  assert.equal(transport.next([], true).full, true);
  console.log('PASS quote deltas skip unchanged snapshots and preserve removals/order/full resync');

  const timers = new Map(); let timerId = 0;
  const { RequestBridge } = load('template-packages/leek-center/src/utils/requestBridge.ts', {}, {
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
  });
  const messages = [];
  const bridge = new RequestBridge((command, data) => messages.push({ command, data }));
  const success = bridge.request('a', {}, 1000);
  bridge.receive({ sessionId: 'a', success: true, response: { data: 'ok' } });
  assert.equal((await success).data, 'ok'); assert.equal(bridge.size, 0); assert.equal(timers.size, 0);
  bridge.receive({ sessionId: 'a', success: true, response: {} });
  const expired = bridge.request('b', {}, 1000); const expiredError = expired.catch(error => error);
  timers.values().next().value();
  assert.match((await expiredError).message, /超时/); assert.equal(bridge.size, 0); assert.equal(timers.size, 0);
  const controller = new AbortController();
  const cancelled = bridge.request('c', {}, 1000, controller.signal).catch(error => error);
  controller.abort(); assert.match((await cancelled).message, /取消/);
  const closing = bridge.request('d', {}, 1000).catch(error => error);
  bridge.dispose(); assert.match((await closing).message, /关闭/); assert.equal(timers.size, 0);
  assert.equal(bridge.size, 0);
  console.log('PASS bridge success, timeout, late replies, abort and page-close cleanup');

  const outbound = [], requests2 = [];
  const axios2 = options => { const gate = defer(); requests2.push({ gate, options }); return gate.promise; };
  let cancellations = 0;
  axios2.CancelToken = { source: () => ({ token: {}, cancel: () => cancellations++ }) };
  const { FetchBridge } = load('src/webview/fetchBridge.ts', { axios: { default: axios2 } });
  const backendBridge = new FetchBridge(reply => outbound.push(reply));
  const active = backendBridge.request({ sessionId: 'first', url: '/data', timeout: 0 });
  assert.equal(requests2[0].options.timeout, 15000);
  backendBridge.cancel('first');
  requests2[0].gate.resolve({ data: 'late', status: 200 }); await active;
  assert.equal(outbound.length, 0); assert.equal(cancellations, 1);
  const disposed = backendBridge.request({ sessionId: 'second', url: '/data' });
  backendBridge.dispose(); requests2[1].gate.reject(Error('cancelled')); await disposed;
  assert.equal(outbound.length, 0); assert.equal(cancellations, 2);
  console.log('PASS backend cancels HTTP work and suppresses replies after disposal');

  let servers = 0, closes = 0, destroyed = 0, server;
  const { EventEmitter } = require('events');
  const { startProxyServer, disposeProxyServer } = load('src/webview/proxyService/proxyService.ts', {
    http: { createServer: () => { servers++; server = new EventEmitter(); server.listen = (_port, fn) => fn(); server.address = () => ({ port: 16100 }); server.close = fn => { closes++; fn(); }; return server; } },
    'http-proxy-middleware': { createProxyMiddleware: () => () => {} },
    './proxyConfig': { setEastmoneyPort() {}, getEastmoneyPort: () => 16100 },
    '../../shared/findAvailablePort': { findAvailablePort: async () => 16100 }, axios: { default: {} }, cheerio: {},
  });
  await Promise.all([startProxyServer(), startProxyServer()]); assert.equal(servers, 1);
  server.emit('connection', { on() {}, destroy() { destroyed++; } });
  await disposeProxyServer(); assert.equal(closes, 1); assert.equal(destroyed, 1);
  await disposeProxyServer(); assert.equal(closes, 1);
  await startProxyServer(); assert.equal(servers, 2); await disposeProxyServer();
  console.log('PASS lazy proxy startup coalesces and disposal closes sockets/server');

}
main().catch(error => { console.error(error); process.exitCode = 1; });
