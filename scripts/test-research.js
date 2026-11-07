// Exercise research calculations, durable jobs and model failures without network/API credentials.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename);
function load(file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', file);
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = mod.require.bind(mod);
  mod.require = name => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
  }).outputText, filename);
  return mod.exports;
}
const { parseResearchBody, calculateExposure, researchMarkdown } = require('../src/shared/research.ts');
const { parseDailyHistory } = load('src/service/researchData.ts', { '../globalState': { default: {} } });
const body = { summary: '冻结证据支持观察，后续仍需核实', support: ['[S1] 行情快照'], counter: ['公告尚未获取'], conditions: ['下一交易日核对量价'], invalidation: ['原有趋势无法延续'], limitations: ['缺少财报'] };
const position = (extra = {}) => ({ code: 'sh600519', name: '测试股票', amount: 10, unitPrice: 100, ...extra });
const cases = [];
const test = (name, run) => cases.push([name, run]);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(done => setImmediate(done));
async function until(fn) { for (let i = 0; i < 200; i++) { if (fn()) return; await tick(); } throw new Error('test did not settle'); }

function harness(saved) {
  const files = new Map(saved ? [['/storage/research-v1.json', Buffer.from(JSON.stringify(saved))]] : []);
  const config = { aiConfig: { apiKey: 'test-secret', baseUrl: 'https://model.invalid/v1', model: 'test-model' }, aiStockHistoryRange: '3m' };
  let holdings = [position()];
  const stockService = { stockList: [{ info: { code: 'sh600519', name: '测试股票', price: '120', time: '2026-11-06 15:00:00', industry: '消费' } }] };
  let calls = 0;
  let generate = async () => ({ choices: [{ message: { content: JSON.stringify(body) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 }, model: 'test-model' });
  let news = async () => ({ items: [], available: true, fetchedAt: '2026-11-06T07:00:00Z' });
  let collect = async (stock, quote) => ({ ...stock, quote, capturedAt: '2026-11-06T07:00:00Z', limitations: [], sources: [
    { id: 'S1', title: '行情', status: 'available', content: '120', fetchedAt: '2026-11-06T07:00:00Z' },
  ] });
  const vscode = { workspace: { getConfiguration: () => ({ get: (key, fallback) => config[key] ?? fallback }), fs: {
    readFile: async file => { if (!files.has(file)) throw Object.assign(new Error('missing'), { code: 'FileNotFound' }); return files.get(file); },
    writeFile: async (file, bytes) => { files.set(file, Buffer.from(bytes)); }, createDirectory: async () => {},
    rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from); },
  } }, Uri: { joinPath: (...parts) => parts.join('/') } };
  class FakeOpenAI { constructor() { this.chat = { completions: { create: (...args) => { calls++; return generate(...args); } } }; } }
  class FakeData { news(...args) { return news(...args); } collect(...args) { return collect(...args); } }
  const { ResearchService } = load('src/service/research.ts', { vscode, openai: { default: FakeOpenAI },
    './portfolio': { portfolio: { read: () => holdings } }, './researchData': { ResearchData: FakeData, throwIfCancelled: signal => { if (signal.aborted) throw new Error('cancelled'); } } });
  const context = { globalStorageUri: '/storage', subscriptions: [] };
  const service = new ResearchService();
  return { service, files, config, stockService, context, init: () => service.initialize(context, stockService),
    setHoldings: value => { holdings = value; }, setGenerate: value => { generate = value; }, setNews: value => { news = value; }, setCollect: value => { collect = value; }, get calls() { return calls; } };
}

test('structured output accepts JSON fences and rejects incomplete reports', () => {
  assert.deepEqual(parseResearchBody('```json\n' + JSON.stringify(body) + '\n```'), body);
  for (const value of ['模型不可用', '{}', JSON.stringify({ ...body, counter: [] }), JSON.stringify({ ...body, support: [''] }), JSON.stringify({ ...body, invalidation: [123] })]) assert.throws(() => parseResearchBody(value));
});
test('currency exposure excludes sold positions and never combines currencies', () => {
  const result = calculateExposure([position(), position({ code: 'sz000001' }), position({ code: 'hk00700' }), position({ code: 'usr_aapl', isSellOut: true })], [
    { code: 'sh600519', name: '一', price: 100, industry: '消费' }, { code: 'sz000001', name: '二', price: 300, industry: '金融' }, { code: 'hk00700', name: '三', price: 500 },
  ], '2026-11-06');
  assert.equal(result.currencies.length, 2);
  assert.equal(result.currencies[0].largestPercent, 75);
  assert.equal(result.currencies[0].topThreePercent, 100);
  assert.equal(result.currencies[1].largestPercent, 100);
  assert.deepEqual(result.unclassified, ['hk00700']);
});
test('one missing quote suppresses concentration for that currency only', () => {
  const result = calculateExposure([position(), position({ code: 'sz000001' }), position({ code: 'hk00700' })], [
    { code: 'sh600519', name: '一', price: '100' }, { code: 'hk00700', name: '二', price: 200 },
  ], '2026-11-06');
  assert.equal(result.currencies[0].complete, false);
  assert.equal(result.currencies[0].largestPercent, undefined);
  assert.deepEqual(result.currencies[0].industries, []);
  assert.equal(result.currencies[1].largestPercent, 100);
  assert.deepEqual(result.missingQuotes, ['sz000001']);
});
test('vendor history parses JSONP, sorts dates and rejects error envelopes', () => {
  const rows = [['2026-11-06', '1', '2', '3', '1', '100'], ['2026-11-05', '1', '1', '2', '1', '80'], ['2026-11-04', '0', '0', '0', '0', '0']];
  const sohu = [['2026-11-06', '10', '9', '-1', '-10%', '8', '11', '100', '1000', '1%']];
  assert.deepEqual(parseDailyHistory('historySearchHandler(' + JSON.stringify([{ status: 0, hq: sohu }]) + ');', ''), [['2026-11-06', '10', '9', '11', '8', '100']]);
  assert.equal(parseDailyHistory({ data: { hk00700: { qfqday: rows } } }, 'hk00700')[0][0], '2026-11-05');
  assert.deepEqual(parseDailyHistory([{ status: 1, hq: rows }], ''), []);
  assert.deepEqual(parseDailyHistory('<html>error</html>', ''), []);
});
test('vendor requests bridge AbortSignal cancellation to Axios 0.19 tokens', async () => {
  const axios = require('axios');
  const started = deferred();
  const { ResearchData } = load('src/service/researchData.ts', { '../globalState': { default: {} }, axios: { default: {
    CancelToken: axios.CancelToken,
    get: (_, options) => new Promise((resolve, reject) => { started.resolve(options); options.cancelToken.promise.then(reject); }),
  } } });
  const controller = new AbortController();
  const request = new ResearchData().history('sh600519', '3m', controller.signal);
  const options = await started.promise; assert.equal(options.timeout, 15000); controller.abort();
  await assert.rejects(request, /取消/);
});
test('duplicate stock jobs share one request and history persists without credentials', async () => {
  const h = harness(); await h.init(); const gate = deferred(); h.setNews(() => gate.promise);
  const job = h.service.startStock('sh600519');
  assert.equal(h.service.startStock('sh600519').id, job.id);
  gate.resolve({ items: [], available: true });
  await until(() => job.status === 'completed'); await h.service.flush();
  assert.equal(h.calls, 1); assert.deepEqual(job.report, body);
  assert.equal(h.service.state().jobs[0].request, undefined);
  const stored = h.files.get('/storage/research-v1.json').toString();
  assert(!stored.includes('test-secret')); assert(!stored.includes('apiKey'));
  assert.equal(job.usage[0].input, 100);
  assert(researchMarkdown(job).includes('判断失效条件'));
  assert(researchMarkdown(job).includes('[S1]'));
});
test('leaving the page unsubscribes presentation without stopping the job', async () => {
  const h = harness(); await h.init(); const gate = deferred(); h.setNews(() => gate.promise);
  let updates = 0; const off = h.service.subscribe(() => updates++);
  const job = h.service.startStock('sh600519'); off(); const seen = updates;
  gate.resolve({ items: [], available: true });
  await until(() => job.status === 'completed'); assert.equal(updates, seen); assert.equal(h.calls, 1);
});
test('queued cancellation performs no model call and the next task still runs', async () => {
  const h = harness(); await h.init(); const gate = deferred(); h.setNews(() => gate.promise);
  const first = h.service.startStock('sh600519');
  const second = h.service.startStock('sz000001', '第二只'); h.service.cancel(second.id);
  gate.resolve({ items: [], available: true });
  await until(() => first.status === 'completed');
  assert.equal(second.status, 'cancelled'); assert.equal(h.calls, 1);
});
test('cancellation aborts in-flight models and late results cannot overwrite status', async () => {
  const h = harness(); await h.init(); const started = deferred();
  h.setGenerate((_, options) => new Promise((resolve, reject) => { started.resolve(); options.signal.addEventListener('abort', () => reject(new Error('aborted'))); }));
  const job = h.service.startStock('sh600519'); await started.promise; h.service.cancel(job.id);
  await tick(); assert.equal(job.status, 'cancelled'); assert.equal(job.report, undefined);
});
test('malformed model output fails visibly and retains actual usage', async () => {
  const h = harness(); await h.init(); h.setGenerate(async () => ({ choices: [{ message: { content: '我无法分析' } }], usage: { prompt_tokens: 20, completion_tokens: 3 } }));
  const job = h.service.startStock('sh600519'); await until(() => job.status === 'failed');
  assert.equal(job.usage[0].input, 20); assert(job.error.includes('JSON')); assert.equal(job.report, undefined);
});
test('missing vendor usage is estimated separately from actual usage', async () => {
  const h = harness(); await h.init(); h.setGenerate(async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] }));
  const job = h.service.startStock('sh600519'); await until(() => job.status === 'completed');
  assert.equal(job.usage[0].input, undefined); assert(job.usage[0].estimatedInput > 0);
});
test('portfolio freezes holdings and quotes; one stock failure preserves other reports', async () => {
  const h = harness(); h.setHoldings([position(), position({ code: 'sz000001', name: '第二只' })]); await h.init();
  const gate = deferred(); h.setNews(() => gate.promise);
  h.setCollect(async (stock, quote) => { if (stock.code === 'sz000001') throw new Error('行情缺失'); return { ...stock, quote, limitations: [], sources: [{ id: 'S1', status: 'available' }] }; });
  const job = h.service.startPortfolio(); h.stockService.stockList[0].info.price = '999'; h.setHoldings([]);
  gate.resolve({ items: [], available: true }); await until(() => job.status === 'partial');
  assert.equal(job.request.positions.length, 2); assert.equal(job.request.quotes[0].price, '120');
  assert.equal(job.exposure.currencies[0].marketValue, 1200);
  assert(job.stocks[0].report); assert.equal(job.stocks[1].error, '行情缺失'); assert(job.report);
});
test('extension restart marks active jobs interrupted and preserves completed evidence', async () => {
  const h = harness(); await h.init(); const gate = deferred(); h.setNews(() => gate.promise);
  const job = h.service.startStock('sh600519'); await h.service.flush();
  const saved = JSON.parse(h.files.get('/storage/research-v1.json'));
  const restored = harness(saved); await restored.init();
  assert.equal(restored.service.find(job.id).status, 'interrupted'); assert.equal(restored.calls, 0);
  h.service.cancel(job.id); gate.resolve({ items: [], available: true });
});
test('retry creates a new snapshot while keeping original reports immutable', async () => {
  const h = harness(); await h.init(); const first = h.service.startStock('sh600519'); await until(() => first.status === 'completed');
  h.stockService.stockList[0].info.price = '150'; const second = h.service.retry(first.id); await until(() => second.status === 'completed');
  assert.notEqual(first.id, second.id); assert.equal(first.request.quotes[0].price, '120'); assert.equal(second.request.quotes[0].price, '150');
});
test('invalid input, missing AI config, empty portfolios and deleting running jobs are rejected', async () => {
  const h = harness(); await h.init(); assert.throws(() => h.service.startStock('__proto__'));
  h.setHoldings([]); assert.throws(() => h.service.startPortfolio());
  h.config.aiConfig.apiKey = ''; assert.throws(() => h.service.startStock('sh600519'));
  h.config.aiConfig.apiKey = 'test'; const gate = deferred(); h.setNews(() => gate.promise);
  const job = h.service.startStock('sh600519'); assert.throws(() => h.service.remove(job.id));
  h.service.cancel(job.id); h.service.remove(job.id); assert.equal(h.service.find(job.id), undefined); gate.resolve({ items: [] });
});

(async () => { let failed = 0; for (const [name, run] of cases) { try { await run(); console.log('PASS', name); } catch (error) { failed++; console.error('FAIL', name, error); } } console.log(`${cases.length - failed}/${cases.length} research tests passed`); process.exitCode = failed ? 1 : 0; })();
