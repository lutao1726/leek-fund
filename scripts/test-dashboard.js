// Exercise the dashboard HTTP service and page leases without VS Code or market requests.
const assert = require('assert').strict;
const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const axios = require('axios');
const { EventEmitter } = require('events');

function load(file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', file);
  const loadedModule = new Module(filename, module);
  loadedModule.filename = filename;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(filename));
  const requireOriginal = loadedModule.require.bind(loadedModule);
  loadedModule.require = name => Object.hasOwn(mocks, name) ? mocks[name] : requireOriginal(name);
  loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText, filename);
  return loadedModule.exports;
}
const { EastMoneyDataServer } = load('src/service/eastmoney.ts');
const cases = [];
const test = (name, run) => cases.push([name, run]);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { ...options, agent: false }, res => {
      let text = '';
      res.on('data', data => { text += data; });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('Test HTTP request timed out')));
    req.end();
  });
}

test('market requests run concurrently, retain chart fields, and discard invalid values', async () => {
  const calls = [];
  const gate = deferred();
  const { fetchDashboardData } = load('src/service/eastmoney.ts', { https: {
    get: (url, options, callback) => {
      calls.push({ url, ...options });
      const request = new EventEmitter();
      request.destroy = error => request.emit('error', error);
      const rows = url.endsWith('3A1') ? [
        { f14: '北京板块', f174: 200000000 }, { f14: '上海板块', f174: -100000000 },
        null, { f14: '无效', f174: null }, { f14: '无效', f174: '' }, { f14: '无效', f174: 'bad' },
      ] : [{ f14: '科技', f174: 300000000 }, { f14: '消费', f174: -200000000 }, { f14: 'MSCI中国', f174: 900000000 }];
      gate.promise.then(() => {
        const response = new EventEmitter();
        response.statusCode = 200;
        response.setEncoding = () => {};
        callback(response);
        response.emit('data', JSON.stringify({ data: { diff: rows } }));
        response.emit('end');
      });
      return request;
    },
  } });
  const result = fetchDashboardData(axios.CancelToken.source().token);
  assert.equal(calls.length, 3);
  assert(calls.every(call => call.timeout === 10000));
  gate.resolve();
  const data = await result;
  assert.deepEqual(data.bk_xAxis, ['北京板块', '上海板块']);
  assert.deepEqual(data.bk_seriesData, [2, -1]);
  assert.deepEqual(data.gn_top_xAxis, ['科技', '消费']);
  assert.deepEqual(data.hy_top_seriesData, [3, -2]);
  assert.equal(data.map_echarts_data.length, 2);
  assert(Object.values(data).every(value => typeof value !== 'number' || Number.isFinite(value)));
  assert.equal(Object.keys(data).length, 17);
});

test('multiple pages share one listener; concurrent requests and fresh cache share one load', async () => {
  const gate = deferred(); const started = deferred(); let calls = 0;
  const server = new EastMoneyDataServer({ port: 0, load: async () => { calls++; started.resolve(); await gate.promise; return { value: calls }; } });
  const first = {}, second = {};
  try {
    assert.equal(server.url, undefined);
    await Promise.all([server.acquire(first), server.acquire(second)]);
    const url = server.url;
    const responses = Promise.all([request(url), request(url)]);
    await started.promise;
    gate.resolve();
    assert((await responses).every(response => response.status === 200));
    assert.equal(calls, 1);
    assert.equal((await request(url)).status, 200);
    assert.equal(calls, 1);
    await server.release(first);
    assert.equal(server.url, url);
    await server.release(second);
    assert.equal(server.url, undefined);
    await assert.rejects(request(url), error => error.code === 'ECONNREFUSED');
  } finally { await server.dispose(); }
});

test('cache expires and failed loads remain retryable', async () => {
  let calls = 0;
  const server = new EastMoneyDataServer({ port: 0, cacheMs: 20, load: async () => {
    if (++calls === 1) throw new Error('upstream unavailable');
    return { calls };
  } });
  try {
    await server.acquire({});
    assert.equal((await request(server.url)).status, 502);
    assert.equal(JSON.parse((await request(server.url)).text).calls, 2);
    assert.equal(JSON.parse((await request(server.url)).text).calls, 2);
    await new Promise(resolve => setTimeout(resolve, 35));
    assert.equal(JSON.parse((await request(server.url)).text).calls, 3);
  } finally { await server.dispose(); }
});

test('the service binds loopback and rejects unrelated origins, routes, and methods', async () => {
  let calls = 0;
  const server = new EastMoneyDataServer({ port: 0, load: async () => { calls++; return {}; } });
  try {
    await server.acquire({});
    assert(server.url.startsWith('http://127.0.0.1:'));
    assert.equal((await request(server.url, { headers: { Origin: 'https://example.com' } })).status, 403);
    assert.equal((await request(server.url.replace('/api/stock/data', '/other'))).status, 404);
    assert.equal((await request(server.url, { method: 'POST' })).status, 405);
    const preflight = await request(server.url, { method: 'OPTIONS', headers: { Origin: 'https://view.le5le.com' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], 'https://view.le5le.com');
    assert.equal(preflight.headers['access-control-allow-private-network'], 'true');
    assert.equal(calls, 0);
  } finally { await server.dispose(); }
});

test('port conflicts reject cleanly and do not prevent a later successful start', async () => {
  const blocker = http.createServer();
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const server = new EastMoneyDataServer({ port: blocker.address().port, load: async () => ({}) });
  const owner = {};
  try {
    await assert.rejects(server.acquire(owner), /已被占用/);
    assert.equal(server.url, undefined);
    await new Promise(resolve => blocker.close(resolve));
    await server.acquire(owner);
    assert.equal((await request(server.url)).status, 200);
  } finally {
    await server.dispose();
    if (blocker.listening) await new Promise(resolve => blocker.close(resolve));
  }
});

test('closing a page during startup leaves no listener', async () => {
  const server = new EastMoneyDataServer({ port: 0, load: async () => ({}) });
  const owner = {};
  try {
    const start = server.acquire(owner);
    const stop = server.release(owner);
    await Promise.all([start, stop]);
    assert.equal(server.url, undefined);
  } finally { await server.dispose(); }
});

test('closing the last page cancels upstream work and closes active connections', async () => {
  const started = deferred(); let cancelled = false;
  const server = new EastMoneyDataServer({ port: 0, load: token => new Promise((resolve, reject) => {
    token.promise.then(reason => { cancelled = true; reject(reason); });
    started.resolve();
  }) });
  const owner = {};
  try {
    await server.acquire(owner);
    const response = request(server.url).catch(error => ({ error }));
    await started.promise;
    await server.release(owner);
    assert(cancelled);
    assert((await response).error);
    assert.equal(server.url, undefined);
  } finally { await server.dispose(); }
});

test('stale page cleanup cannot release a new page lease; disposal releases the current lease', async () => {
  const pending = []; const released = []; const posted = [];
  const service = { acquire: owner => { const gate = deferred(); pending.push({ owner, gate }); return gate.promise; }, release: async owner => { released.push(owner); } };
  const { registerStockDashboardService } = load('src/webview/leek-center/stock-dashboard-service.ts', { '../../service/eastmoney': { eastMoneyDataServer: service } });
  let receive, dispose, messageDisposed = false;
  registerStockDashboardService({
    webview: { onDidReceiveMessage: handler => { receive = handler; return { dispose: () => { messageDisposed = true; } }; }, postMessage: async message => { posted.push(message); } },
    onDidDispose: handler => { dispose = handler; },
  });
  const first = receive({ command: 'startStockDashboard', data: { requestId: 'first' } });
  await receive({ command: 'stopStockDashboard', data: { requestId: 'first' } });
  const second = receive({ command: 'startStockDashboard', data: { requestId: 'second' } });
  await receive({ command: 'stopStockDashboard', data: { requestId: 'first' } });
  assert.equal(released.length, 1);
  pending[0].gate.resolve(); await first;
  assert.equal(posted.length, 0);
  pending[1].gate.resolve(); await second;
  assert.equal(posted[0].data.requestId, 'second');
  dispose();
  assert.equal(released.length, 2);
  assert.equal(released[1], pending[1].owner);
  assert(messageDisposed);
});

(async () => {
  for (const [name, run] of cases) { await run(); console.log('PASS', name); }
  console.log(`${cases.length} dashboard tests passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
