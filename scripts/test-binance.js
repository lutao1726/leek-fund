const assert = require('assert').strict;
const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const { EventEmitter } = require('events');
function load(file, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: id => {
    if (!(id in mocks)) throw Error('Unexpected dependency ' + id);
    return mocks[id];
  }, Date, Promise, Set });
  return exports;
}
const binanceCode = /^[A-Z0-9]{2,20}_[A-Z0-9]{2,20}$/;
const cache = { items: [] }, bus = new EventEmitter(), requests = [];
const settings = { 'leek-fund.stockPrice': { ETH_BTC: { name: 'Ether', amount: 0.1, unitPrice: 0.04 } }, 'leek-fund.statusBarStock': ['SOL_USDT', 'sh600519'] };
const Service = load('src/explorer/binanceService.ts', {
  axios: { default: { get: async (_, options) => {
    const symbols = JSON.parse(options.params.symbols); requests.push(symbols);
    if (symbols.includes('BADUSDT')) throw { response: { data: { code: -1121 } } };
    return { data: symbols.map(symbol => ({ symbol, lastPrice: '120', openPrice: '100', prevClosePrice: '105', priceChangePercent: '20', closeTime: 1794297600000 })) };
  } } },
  '../globalState': { default: { telemetry: { sendEvent() {} } } },
  '../shared/leekTreeItem': { LeekTreeItem: class { constructor(info) { this.info = info; } } },
  '../shared/typed': { TreeItemType: { BINANCE: 'binance' } },
  '../shared/leekConfig': { LeekFundConfig: { getConfig: (key, fallback) => settings[key] ?? fallback } },
  '../shared/binance': { binanceCode }, './binanceQuotes': { binanceQuotes: cache },
  '../shared/portfolio': { readPositions: raw => Object.keys(raw).map(code => ({ code })) },
  '../shared/utils': { events: bus, randHeader: () => ({}), sortData: rows => rows },
  './leekService': { LeekService: class {} },
}).default;
(async () => {
  const service = new Service({});
  const input = ['BTC_USDT', 'BAD_USDT'];
  const rows = await service.getData(input, 0);
  assert.deepEqual(input, ['BTC_USDT', 'BAD_USDT']);
  assert.deepEqual(Array.from(rows, row => row.info.code), ['BTC_USDT', 'BAD_USDT', 'ETH_BTC', 'SOL_USDT']);
  assert.equal(rows[0].info.yestclose, '100');
  assert.equal(rows[1].info.price, undefined);
  assert.ok(rows[0].info.time);
  assert.equal(cache.items, rows);
  assert.equal(requests.flat().includes('sh600519'), false);
  console.log('PASS Binance includes off-watchlist holdings/status symbols, isolates invalid pairs, preserves input and uses the rolling 24h baseline');
})().catch(error => { console.error(error); process.exitCode = 1; });
