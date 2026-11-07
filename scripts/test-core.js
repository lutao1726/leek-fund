// Run deterministic ledger/migration tests without launching VS Code or requesting market data.
const assert = require('assert').strict;
const fs = require('fs');
const ts = require('typescript');
const Module = require('module');
const { EventEmitter } = require('events');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename);
const { normalizeGroups, moveStocks, deleteGroup, numericAmount, sortQuotes } = require('../src/shared/watchlist.ts');
const { validatePosition, readPositions, calculatePortfolio, importPortfolio, addPosition } = require('../src/shared/portfolio.ts');
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const position = (overrides = {}) => ({ code: 'sh600519', name: '测试股票', amount: 10, unitPrice: 100, ...overrides });
const book = () => normalizeGroups({ version: 1, groups: [
  { id: 'default', name: '默认分组', codes: ['sh600519', 'sz000001'] },
  { id: 'tech', name: '科技', codes: ['hk00700'] },
] }, ['sh600519', 'sz000001', 'hk00700']);

test('legacy migration preserves order and is idempotent', () => {
  const migrated = normalizeGroups(undefined, ['hk00700', 'sh600519', 'hk00700']);
  assert.deepEqual(migrated.groups[0].codes, ['hk00700', 'sh600519']);
  assert.deepEqual(normalizeGroups(migrated, migrated.groups[0].codes), migrated);
});
test('migration removes stale codes, resolves duplicates and assigns new stocks', () => {
  const result = normalizeGroups({ version: 1, groups: [{ id: 'tech', name: '科技', codes: ['hk00700', 'old', 'hk00700'] }] }, ['hk00700', 'sh600519']);
  assert.deepEqual(result.groups.map(group => group.codes), [['sh600519'], ['hk00700']]);
});
test('malformed group entries cannot hide watchlist stocks', () => {
  assert.deepEqual(normalizeGroups({ version: 1, groups: [null, { id: 'bad', codes: [] }] }, ['sh600519']).groups[0].codes, ['sh600519']);
});
test('cross-group move preserves every stock and target order', () => {
  const old = book();
  const next = moveStocks(old, ['sz000001'], 'tech', 'hk00700');
  assert.deepEqual(next.groups.map(group => group.codes), [['sh600519'], ['sz000001', 'hk00700']]);
  assert.equal(old.groups[0].codes.length, 2);
});
test('multi-item drag keeps selection order and has no duplicates', () => {
  assert.deepEqual(moveStocks(book(), ['sz000001', 'sh600519', 'sz000001'], 'tech').groups[1].codes, ['hk00700', 'sz000001', 'sh600519']);
});
test('dropping a selection onto itself is a no-op', () => {
  const old = book(); assert.equal(moveStocks(old, ['sh600519'], 'default', 'sh600519'), old);
});
test('stale drag or invalid target cannot remove existing stocks', () => {
  assert.throws(() => moveStocks(book(), ['deleted'], 'tech'));
  assert.throws(() => moveStocks(book(), ['sh600519'], 'missing'));
});
test('deleting group returns members to default without deleting stock', () => {
  assert.deepEqual(deleteGroup(book(), 'tech').groups[0].codes, ['sh600519', 'sz000001', 'hk00700']);
  assert.throws(() => deleteGroup(book(), 'default'));
});
test('turnover handles Chinese units and unknown values', () => {
  assert.equal(numericAmount('1.5亿'), 150000000);
  assert.equal(numericAmount('2,000万'), 20000000);
  assert.equal(numericAmount('接口无数据'), undefined);
  const items = ['—', '3万', '2亿', '3万'].map((amount, index) => ({ info: { amount }, index }));
  assert.deepEqual(sortQuotes(items, -3).map(item => item.index), [2, 1, 3, 0]);
  assert.deepEqual(sortQuotes(items, 3).map(item => item.index), [1, 3, 2, 0]);
});
test('manual sorting leaves source and order unchanged', () => {
  const items = [{ info: { percent: '2' } }, { info: { percent: '-1' } }];
  assert.deepEqual(sortQuotes(items, 0), items);
  assert.deepEqual(sortQuotes(items, 1), [items[1], items[0]]);
  assert.equal(items[0].info.percent, '2');
});
test('valid legacy stockPrice entries migrate without changing the input', () => {
  const old = { sh600519: { name: '测试', amount: 10, unitPrice: 100, priceDate: 'legacy', price: 101 }, hk00700: { name: '空记录', amount: 0, unitPrice: 0 } };
  const rows = readPositions(old);
  assert.equal(rows.length, 1); assert.equal(rows[0].priceDate, undefined); assert.equal(old.sh600519.priceDate, 'legacy');
});
test('invalid and non-stock holdings are rejected', () => {
  for (const input of [position({ amount: -1 }), position({ unitPrice: Infinity }), position({ code: '__proto__' }), position({ code: 'nf_IF0' }), position({ name: ' ' }), position({ isSellOut: 'false' })]) assert.throws(() => validatePosition(input));
});
test('weighted add adjusts quantity and average cost', () => {
  const result = addPosition(position(), 10, 120);
  assert.equal(result.amount, 20); assert.equal(result.unitPrice, 110);
  assert.throws(() => addPosition(position(), 0, 120));
  assert.throws(() => addPosition(position({ isSellOut: true }), 10, 120));
});
test('portfolio calculates market value, floating P&L and daily estimate', () => {
  const { rows, totals } = calculatePortfolio([position()], [{ code: 'sh600519', name: '测试', price: '120', yestclose: '110' }], '2026-11-07');
  assert.equal(rows[0].marketValue, 1200); assert.equal(rows[0].profit, 200);
  assert.equal(rows[0].profitPercent, 20); assert.equal(rows[0].todayProfit, 100);
  assert.equal(totals[0].cost, 1000);
});
test('yesterday intraday override never leaks into today', () => {
  const row = calculatePortfolio([position({ todayUnitPrice: 115, priceDate: '2026-11-06' })], [{ code: 'sh600519', name: '测试', price: 120, yestclose: 110 }], '2026-11-07').rows[0];
  assert.equal(row.todayProfit, 100);
});
test('cleared holdings do not inflate market value or floating profit', () => {
  const result = calculatePortfolio([position({ isSellOut: true, todayUnitPrice: 115, priceDate: '2026-11-07' })], [{ code: 'sh600519', name: '测试', price: 120, yestclose: 110 }], '2026-11-07');
  assert.equal(result.rows[0].marketValue, 0); assert.equal(result.rows[0].profit, 0); assert.equal(result.rows[0].todayProfit, 50);
  assert.equal(calculatePortfolio([position({ isSellOut: true, priceDate: '2026-11-06', todayUnitPrice: 115 })], [], '2026-11-07').rows[0].todayProfit, 0);
});
test('missing quotes remain unknown rather than a fabricated total loss', () => {
  const result = calculatePortfolio([position()], [], '2026-11-07');
  assert.equal(result.rows[0].marketValue, undefined); assert.equal(result.rows[0].profit, undefined);
  assert.equal(result.totals[0].missingQuotes, 1); assert.equal(result.totals[0].cost, 1000);
});
test('missing previous close cannot produce a fabricated zero daily profit', () => {
  const result = calculatePortfolio([position({ isSellOut: true, todayUnitPrice: 115, priceDate: '2026-11-07' })], [], '2026-11-07');
  assert.equal(result.rows[0].todayProfit, undefined);
  assert.equal(result.totals[0].missingDailyQuotes, 1);
});
test('CNY/HKD/USD totals remain separate', () => {
  const rows = [position(), position({ code: 'hk00700' }), position({ code: 'usr_aapl' })];
  assert.deepEqual(calculatePortfolio(rows, [], '2026-11-07').totals.map(total => total.currency), ['CNY', 'HKD', 'USD']);
});
test('export/import roundtrip retains all holding values', () => {
  const rows = [validatePosition(position()), validatePosition(position({ code: 'hk00700', amount: 0.5 }))];
  assert.deepEqual(importPortfolio(JSON.parse(JSON.stringify({ version: 1, positions: rows }))), rows);
});
test('invalid import is rejected as a whole, including duplicate keys', () => {
  assert.throws(() => importPortfolio({ version: 2, positions: [] }));
  assert.throws(() => importPortfolio({ version: 1, positions: [position(), position({ amount: -1 })] }));
  assert.throws(() => importPortfolio({ version: 1, positions: [position(), position()] }));
});

// Test the actual service and provider against a minimal in-memory VS Code API.
const settings = { stocks: ['sh600519', 'sz000001', 'hk00700'], stockGroups: book(), useStockGroups: true, stockPrice: {} };
const writes = [];
const vscode = {
  workspace: { getConfiguration: () => ({
    get: (key, fallback) => settings[key.replace(/^leek-fund\./, '')] ?? fallback,
    inspect: key => ({ globalValue: settings[key.replace(/^leek-fund\./, '')] }),
    update: async (key, value) => { settings[key.replace(/^leek-fund\./, '')] = value; writes.push(key); },
  }) },
  window: { showErrorMessage: text => { throw new Error(text); }, showInformationMessage() {} },
  commands: { executeCommand: async () => {} },
  TreeItem: class { constructor(label) { this.label = label; } },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  DataTransferItem: class { constructor(value) { this.value = value; } },
  EventEmitter: class { constructor() { this.emitter = new EventEmitter(); this.event = callback => { this.emitter.on('event', callback); return { dispose: () => this.emitter.off('event', callback) }; }; } fire(value) { this.emitter.emit('event', value); } },
};
const load = Module._load;
Module._load = function(name, ...args) { return name === 'vscode' ? vscode : load.call(this, name, ...args); };
test('serialized group edits do not lose concurrent additions', async () => {
  const { StockGroupsService } = require('../src/service/stockGroups.ts');
  const service = new StockGroupsService();
  await Promise.all([service.add('第一组'), service.add('第二组')]);
  assert.ok(service.read().groups.some(group => group.name === '第一组'));
  assert.ok(service.read().groups.some(group => group.name === '第二组'));
  assert.deepEqual(settings.stocks, ['sh600519', 'sz000001', 'hk00700']);
});
test('provider uses distinct occurrence IDs with valid parents and legacy commands', async () => {
  const { StockProvider } = require('../src/explorer/stockProvider.ts');
  const { LeekTreeItem } = require('../src/shared/leekTreeItem.ts');
  const item = new LeekTreeItem({ code: 'sh600519', name: '测试', percent: '1', type: 'sh', symbol: '600519', contextValue: 'aStock' });
  const service = { stockList: [item], getData: async () => [item] };
  const provider = new StockProvider(service);
  const roots = await provider.getChildren();
  const fallback = roots.find(root => root.id === 'watch-group:default');
  const child = (await provider.getChildren(fallback))[0];
  assert.notEqual(child.id, child.info.code); assert.equal(provider.getParent(child), fallback);
  assert.equal(child.command.command, 'leek-fund.stockItemClick');
  assert.equal((await provider.findByCode('sh600519')).info.code, 'sh600519');
});
test('drag persists cross-group move and resets automatic sorting', async () => {
  settings.stockGroups = book(); settings.stockSort = -3;
  const { StockProvider } = require('../src/explorer/stockProvider.ts');
  const provider = new StockProvider({ stockList: [], getData: async () => [] });
  const target = (await provider.getChildren()).find(item => item.id === 'watch-group:tech');
  const transfer = new Map([['application/vnd.code.tree.leekfundview.stock', { value: [{ code: 'sh600519' }] }]]);
  await provider.handleDrop(target, transfer, { isCancellationRequested: false });
  assert.deepEqual(settings.stockGroups.groups[1].codes, ['hk00700', 'sh600519']);
  assert.equal(settings.stockSort, 0);
});
test('tree reads and presentation refreshes do not request quotes', async () => {
  const { StockProvider } = require('../src/explorer/stockProvider.ts');
  let requests = 0;
  const provider = new StockProvider({ stockList: [], getData: async () => { requests++; return []; } });
  await provider.getChildren();
  await provider.refresh(false);
  await provider.getChildren();
  assert.equal(requests, 0);
  await provider.refresh();
  assert.equal(requests, 1);
});

test('manual down move affects its own group only', async () => {
  settings.stockGroups = book();
  const { StockProvider } = require('../src/explorer/stockProvider.ts');
  const provider = new StockProvider({ stockList: [] });
  await provider.moveManual('sh600519', 1);
  assert.deepEqual(settings.stockGroups.groups[0].codes, ['sz000001', 'sh600519']);
  assert.deepEqual(settings.stockGroups.groups[1].codes, ['hk00700']);
});
test('portfolio snapshots are shared and invalidated by holdings and quotes', () => {
  const { PortfolioService } = require('../src/service/portfolio.ts');
  const previous = settings.stockPrice;
  try {
    settings.stockPrice = { sh600519: { name: '测试', amount: 10, unitPrice: 100 } };
    const service = new PortfolioService();
    const quotes = { stockList: [{ info: { code: 'sh600519', price: '110', yestclose: '105' } }] };
    const first = service.snapshot(quotes);
    assert.equal(first, service.snapshot(quotes));
    settings.stockPrice.sh600519.amount = 20;
    const changed = service.snapshot(quotes);
    assert.notEqual(first, changed); assert.equal(changed.rows[0].marketValue, 2200);
    quotes.stockList = [{ info: { code: 'sh600519', price: '120', yestclose: '105' } }];
    assert.equal(service.snapshot(quotes).rows[0].marketValue, 2400);
  } finally { settings.stockPrice = previous; }
});

test('portfolio service persists weighted add, close and deletion in the legacy ledger', async () => {
  const { PortfolioService } = require('../src/service/portfolio.ts');
  const service = new PortfolioService();
  await service.save(position()); await service.add('sh600519', 10, 120);
  assert.equal(settings.stockPrice.sh600519.unitPrice, 110);
  await service.close('sh600519', 130); assert.equal(service.read()[0].isSellOut, true);
  await service.remove('sh600519'); assert.equal(service.read().length, 0);
});

(async () => {
  let failed = 0;
  for (const [name, run] of cases) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
  }
  Module._load = load;
  console.log(`${cases.length - failed}/${cases.length} tests passed`);
  process.exitCode = failed ? 1 : 0;
})();
