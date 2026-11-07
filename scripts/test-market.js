const fs = require('fs');
const vm = require('vm');
const assert = require('assert').strict;
const ts = require('typescript');
const { EventEmitter } = require('events');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
const market = require('../src/shared/market.ts');
const { MarketDataService } = require('../src/service/marketData.ts');
const { layoutMarketMap } = require('../template-packages/leek-center/src/utils/market.ts');
const tests = []; const test = (name, run) => tests.push([name, run]);
const signal = () => new AbortController().signal;
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { resolve, reject, promise }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const board = (i = 0) => ({ f12: 'BK' + String(1000 + i), f14: '行业' + i, f2: 100, f3: 0, f8: 1, f20: 1e10, f62: -2e8, f124: 1793950770 });
const stock = (i = 0) => ({ f12: String(600000 + i), f13: 1, f14: '股票' + i, f2: 10, f3: 0, f6: 1e8, f8: 1, f20: 1e10, f62: -1e6, f124: 1793950770 });
const envelope = (rows, total = rows.length) => ({ rc: 0, data: { diff: rows, total } });

test('wire normalization preserves zeros, negative flow, Beijing prefixes and source times', () => {
  const result = market.parseBoard(board(), 'industry');
  assert.equal(result.percent, 0); assert.equal(result.netInflow, -2e8); assert.equal(result.quoteTime, '2026-11-06T07:39:30.000Z');
  assert.equal(market.parseStock({ ...stock(), f12: '920085', f13: 0 }).code, 'bj920085');
  assert.equal(market.stockCode('000001', null), undefined);
  assert.equal(market.marketNumber('-'), undefined); assert.equal(market.marketNumber(''), undefined);
  assert.equal(market.parseStock({ ...stock(), f13: 116 }), undefined);
});
test('vendor envelopes distinguish empty markets, malformed payloads and keyed rows', () => {
  assert.deepEqual(market.vendorRows({ rc: 0, data: { total: 0, diff: null } }).rows, []);
  assert.equal(market.vendorRows({ rc: 0, data: { total: 1, diff: { '0': stock() } } }).rows.length, 1);
  assert.throws(() => market.vendorRows({ rc: 1, data: null }));
  assert.throws(() => market.vendorRows({ rc: 0, data: { total: 1, diff: [] } }));
});
test('board loading follows pagination, deduplicates and records partial coverage', async () => {
  const calls = [];
  const service = new MarketDataService(async url => {
    const p = Number(new URL(url).searchParams.get('pn')); calls.push(p);
    return envelope(p === 1 ? Array.from({ length: 100 }, (_, i) => board(i)) : [board(99), board(100), { f12: 'invalid' }], 103);
  });
  const result = await service.boards('industry', signal());
  assert.deepEqual(calls, [1, 2]); assert.equal(result.data.items.length, 101); assert.equal(result.data.partial, true);
  service.dispose();
});
test('cache expiration and explicit refresh have bounded, observable request counts', async () => {
  let clock = 100000; let calls = 0;
  const service = new MarketDataService(async () => { calls++; return envelope([stock()]); }, () => clock);
  const first = await service.members('BK0475', 1, signal());
  assert.equal(await service.members('BK0475', 1, signal()), first); assert.equal(calls, 1);
  clock += 15001; await service.members('BK0475', 1, signal()); assert.equal(calls, 2);
  await service.members('BK0475', 1, signal(), true); assert.equal(calls, 3); service.dispose();
});
test('shared reads coalesce; cancelling one page does not cancel another page', async () => {
  const pending = defer(); let calls = 0; let upstream;
  const service = new MarketDataService(async (_, token) => { calls++; upstream = token; return pending.promise; });
  const a = new AbortController(); const b = new AbortController();
  const first = service.members('BK0475', 1, a.signal); const second = service.members('BK0475', 1, b.signal);
  await tick(); assert.equal(calls, 1); a.abort(); await assert.rejects(first);
  assert.equal(upstream.aborted, false); pending.resolve(envelope([stock()]));
  assert.equal((await second).data.items.length, 1); assert.equal(service.activeRequests, 0); service.dispose();
});
test('cancelling the last reader aborts transport and cannot contaminate a replacement request', async () => {
  const old = defer(); const replacement = defer(); const tokens = [];
  const service = new MarketDataService(async (_, token) => { tokens.push(token); return tokens.length === 1 ? old.promise : replacement.promise; });
  const controller = new AbortController(); const first = service.members('BK0475', 1, controller.signal);
  await tick(); controller.abort(); await assert.rejects(first); assert.equal(tokens[0].aborted, true);
  const next = service.members('BK0475', 1, signal()); await tick();
  old.resolve(envelope([{ ...stock(), f14: '过期响应' }]));
  replacement.resolve(envelope([{ ...stock(), f14: '最新响应' }]));
  assert.equal((await next).data.items[0].name, '最新响应');
  assert.equal((await service.members('BK0475', 1, signal())).data.items[0].name, '最新响应'); service.dispose();
});
test('failures retain the original snapshot timestamp and mark it stale', async () => {
  let fail = false; const service = new MarketDataService(async () => { if (fail) throw new Error('source offline'); return envelope([stock()]); });
  const first = await service.members('BK0475', 1, signal()); fail = true;
  const fallback = await service.members('BK0475', 1, signal(), true);
  assert.equal(fallback.stale, true); assert.equal(fallback.fetchedAt, first.fetchedAt); assert.equal(fallback.error, 'source offline');
  await assert.rejects(service.members('BK0476', 1, signal())); service.dispose();
});
test('one board category failure yields a labelled partial overview instead of discarding the other category', async () => {
  const service = new MarketDataService(async url => {
    if (new URL(url).searchParams.get('fs').includes('t:3')) throw new Error('concept offline');
    return envelope([board()]);
  });
  const result = await service.overview(signal()); assert.equal(result.data.industry.length, 1);
  assert.equal(result.data.concept.length, 0); assert.equal(result.stale, true); assert.equal(result.data.errors.length, 1); service.dispose();
});
test('board quote uses the verified ulist dictionary and preserves CNY net-inflow units', async () => {
  const service = new MarketDataService(async url => {
    assert.equal(new URL(url).pathname, '/api/qt/ulist.np/get');
    return envelope([{ ...board(), f12: 'BK0475', f62: 852760576 }]);
  });
  const result = await service.boardQuote('BK0475', signal()); assert.equal(result.data.netInflow, 852760576); service.dispose();
});
test('anomalies use literal CSV types so the provider does not silently return only its first type', async () => {
  const service = new MarketDataService(async url => {
    assert.equal(url.includes('%2C'), false);
    const types = new URL(url).searchParams.get('type').split(',').map(Number); assert.equal(types.length, 22);
    return { rc: 0, data: { tc: 2, allstock: [{ tm: 145654, c: '000017', m: 0, n: '股票A', t: 32, i: 'a' }, { tm: 145655, c: '600519', m: 1, n: '股票B', t: 8, i: 'b' }] } };
  });
  const result = await service.changes('all', undefined, 1, signal());
  assert.equal(result.data.items.length, 2); assert.equal(result.data.items[0].date, undefined); assert.equal(result.data.items[0].time, '14:56:54');
  assert.equal(result.data.items[0].direction, 'up'); assert.equal(result.data.items[1].direction, 'down'); service.dispose();
});
test('anomaly normalization removes duplicate/unknown records without inventing a trading date', () => {
  const row = { tm: 93100, c: '000001', m: 0, n: '股票', t: 8201, i: 'x' };
  const data = market.parseChanges({ rc: 0, data: { tc: 4, allstock: [row, row, null, { ...row, t: -1 }] } }, 1);
  assert.equal(data.items.length, 1); assert.equal(data.items[0].date, undefined); assert.equal(data.partial, true);
  assert.equal(market.parseChanges({ rc: 0, data: { tc: 0, allstock: null } }, 1).items.length, 0);
});
test('company failure still returns verified quote and independently labelled missing profile', async () => {
  const service = new MarketDataService(async url => {
    if (url.includes('datacenter')) throw new Error('profile offline');
    return { rc: 0, data: { f57: '600519', f58: '测试', f43: 100, f170: 1, f129: '概念A,概念B', f86: 1793950770 } };
  });
  const result = await service.profile('sh600519', signal());
  assert.equal(result.data.quote.price, 100); assert.deepEqual(result.data.concepts, ['概念A', '概念B']);
  assert.equal(result.data.description, undefined); assert.equal(result.stale, true); service.dispose();
});
test('input validation rejects injection, non-A stocks, invalid pages and prototype scope keys', () => {
  const service = new MarketDataService(async () => { throw new Error('must not request'); });
  assert.throws(() => service.members('BK0475&fs=bad', 1, signal()));
  assert.throws(() => service.profile('hk00700', signal()));
  assert.throws(() => service.leaders(0, signal())); assert.throws(() => service.leaders(1.5, signal()));
  assert.throws(() => service.universe('toString', 1, signal())); service.dispose();
});
test('heatmap rectangles conserve area, respect weights and never allocate missing capitalization', () => {
  const tiles = [{ id: 'a', name: 'A', weight: 4 }, { id: 'b', name: 'B', weight: 1 }, { id: 'bad', name: 'missing', weight: 0 }];
  const rects = layoutMarketMap(tiles, 100, 60); assert.equal(rects.length, 2);
  assert.ok(Math.abs(rects.reduce((sum, rect) => sum + rect.width * rect.height, 0) - 6000) < 1e-8);
  assert.ok(Math.abs(rects[0].width * rects[0].height / (rects[1].width * rects[1].height) - 4) < 1e-8);
  assert.equal(layoutMarketMap(tiles, 0, 60).length, 0);
});

function fixture(service) {
  const state = { 'leek-fund.stocks': ['sh600519'], 'leek-fund.followedBoards': [] }; const events = new EventEmitter();
  const prefs = { LeekFundConfig: { getConfig: (key, fallback) => state[key] ?? fallback, setConfig: async (key, value) => { state[key] = value; events.emit('onDidChangeConfiguration'); } } };
  const exports = {};
  const mocks = { '../../service/marketData': { marketData: service }, '../../shared/market': market, '../../shared/leekConfig': prefs, '../../shared/utils': { events } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/webview/leek-center/market-service.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { exports, require: id => { if (!(id in mocks)) throw new Error('Unexpected ' + id); return mocks[id]; }, AbortController, console }, { filename: 'market-service.ts' });
  const listeners = {}; const sent = [];
  const panel = { visible: true, webview: { postMessage: value => sent.push(value), onDidReceiveMessage: callback => { listeners.message = callback; return { dispose() {} }; } }, onDidChangeViewState: callback => { listeners.visible = callback; return { dispose() {} }; }, onDidDispose: callback => { listeners.dispose = callback; return { dispose() {} }; } };
  const bridge = new exports.MarketBridge(panel, service);
  return { state, events, sent, panel, bridge, listeners, preferences: exports.marketPreferences };
}
test('follow and add-stock mutations persist concurrently without losing first-batch watchlist data', async () => {
  const service = new MarketDataService(async () => envelope([])); const f = fixture(service);
  await Promise.all([f.preferences.change('follow', { code: 'BK0475', follow: true }, signal()), f.preferences.change('follow', { code: 'BK0477', follow: true }, signal()), f.preferences.change('addStock', { code: 'sz000001' }, signal())]);
  assert.deepEqual(Array.from(f.state['leek-fund.followedBoards']), ['BK0475', 'BK0477']);
  assert.deepEqual(Array.from(f.state['leek-fund.stocks']), ['sh600519', 'sz000001']);
  f.bridge.dispose(); service.dispose();
});
test('hidden panels abort pending work, suppress late replies and resume with a fresh request', async () => {
  const waits = []; const service = new MarketDataService(async (_, token) => { const wait = defer(); waits.push({ ...wait, token }); return wait.promise; });
  const f = fixture(service);
  const first = f.bridge.receive({ command: 'marketRequest', data: { id: 'one', channel: 'members', action: 'members', params: { code: 'BK0475', page: 1 } } });
  await tick(); f.panel.visible = false; f.listeners.visible(); assert.equal(waits[0].token.aborted, true);
  waits[0].resolve(envelope([stock()])); await first;
  assert.equal(f.sent.some(message => message.command === 'marketReply' && message.data.id === 'one'), false);
  f.panel.visible = true; f.listeners.visible();
  const next = f.bridge.receive({ command: 'marketRequest', data: { id: 'two', channel: 'members', action: 'members', params: { code: 'BK0475', page: 1 } } });
  await tick(); waits[1].resolve(envelope([stock()])); await next;
  assert.equal(f.sent.some(message => message.command === 'marketReply' && message.data.id === 'two' && message.data.success), true);
  f.bridge.dispose(); assert.equal(f.events.listenerCount('onDidChangeConfiguration'), 0); service.dispose();
});
test('rapid channel replacement does not exhaust the per-panel request budget', async () => {
  const waits = []; const service = new MarketDataService(async () => { const wait = defer(); waits.push(wait); return wait.promise; }); const f = fixture(service);
  const requests = [];
  for (let i = 0; i < 12; i++) { requests.push(f.bridge.receive({ command: 'marketRequest', data: { id: 'request-' + i, channel: 'members', action: 'members', params: { code: 'BK0475', page: i + 1 } } })); await tick(); }
  waits.forEach(wait => wait.resolve(envelope([stock()]))); await Promise.all(requests);
  assert.equal(f.sent.some(message => message.data?.error?.includes('过多')), false);
  assert.equal(f.sent.filter(message => message.command === 'marketReply').length, 1); f.bridge.dispose(); service.dispose();
});

(async () => { let failed = 0; for (const [name, run] of tests) { try { await run(); console.log('PASS ' + name); } catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); } } console.log(`${tests.length - failed}/${tests.length} market tests passed`); process.exitCode = failed ? 1 : 0; })();
