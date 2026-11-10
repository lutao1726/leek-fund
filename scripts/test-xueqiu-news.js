const assert = require('assert').strict;
const fs = require('fs'), path = require('path'), Module = require('module'), ts = require('typescript');
function harness() {
  const requests = [], warnings = [], state = { cookie: '', initCalls: 0 };
  let init = async () => 'anonymous-cookie';
  let get = async () => ({ status: 200, data: { user: { id: 2657407918, screen_name: '何纯在南国' } } });
  const filename = path.resolve(__dirname, '../src/explorer/newsService.ts');
  const mocks = {
    axios: { default: { get: async (...args) => { requests.push(args); return get(...args); } } },
    vscode: { TreeItem: class { constructor(label) { this.label = label; } }, Uri: { parse: uri => uri }, window: { showWarningMessage: async text => { warnings.push(text); } }, commands: { executeCommand() {} } },
    '../shared/utils': { randHeader: () => ({}) },
    '../shared/leekConfig': { LeekFundConfig: { getConfig: () => state.cookie } },
    '../shared/xueqiu-helper': { defaultXueQiuHeaders: {}, getXueQiuToken: async () => { state.initCalls++; return init(); } },
  };
  const m = new Module(filename, module);
  m.require = name => { if (!(name in mocks)) throw new Error(name); return mocks[name]; };
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
  return { ...m.exports, state, requests, warnings, setInit: fn => { init = fn; }, setGet: fn => { get = fn; } };
}
(async () => {
  const h = harness();
  for (const input of ['2657407918', ' 2657407918 ', 'https://www.xueqiu.com/u/2657407918#/comments', 'https://xueqiu.com/2657407918']) assert.equal(h.normalizeXueQiuUserId(input), '2657407918');
  for (const input of ['', 'abc', 'https://evil.test/u/2657407918', 'https://xueqiu.com/2657407918/123']) assert.equal(h.normalizeXueQiuUserId(input), undefined);
  let finish;
  h.setInit(() => new Promise(resolve => { finish = resolve; }));
  const service = new h.NewsService();
  const pending = service.getNewsUserList(['2657407918']);
  assert.equal(h.requests.length, 0, 'profile request must await cookie initialization');
  finish('initialized-cookie');
  const users = await pending;
  assert.equal(users[0].label, '何纯在南国');
  assert.equal(h.requests[0][1].headers.Cookie, 'initialized-cookie');
  h.state.cookie = 'configured-cookie';
  h.setGet(async () => { throw { response: { status: 410 }, config: { headers: { Cookie: 'configured-cookie' } } }; });
  const failed = await service.getNewsUserList(['2657407918', '2657407918']);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].id, '2657407918');
  assert(failed[0].tooltip.includes('HTTP 410'));
  assert(!failed[0].tooltip.includes('configured-cookie'));
  assert.equal(failed[0].command.command, 'vscode.open');
  assert.equal(h.requests.at(-1)[1].headers.Cookie, 'configured-cookie');
  h.state.cookie = 'updated-cookie';
  h.setGet(async () => ({ status: 200, data: { statuses: [{ id: 1 }] } }));
  assert.deepEqual(await service.getNewsData('2657407918'), [{ id: 1 }]);
  assert.equal(h.requests.at(-1)[1].headers.Cookie, 'updated-cookie');
  h.setGet(async () => ({ status: 200, data: '<html>blocked</html>' }));
  assert.equal((await service.getNewsUserList(['2657407918'])).length, 1, 'unexpected HTML must keep a visible fallback');
  await service.getNewsData('2657407918'); await service.getNewsData('2657407918');
  assert.equal(h.warnings.length, 1, 'polling failures must not repeatedly notify');
  const configured = harness(); configured.state.cookie = 'saved-cookie';
  await new configured.NewsService().getNewsUserList(['2657407918']);
  assert.equal(configured.state.initCalls, 0, 'configured cookies must skip anonymous bootstrap');
  const rejected = harness(); rejected.setInit(async () => { throw new Error('bootstrap unavailable'); });
  assert.equal((await new rejected.NewsService().getNewsUserList(['2657407918'])).length, 1);
  console.log('PASS: ID/link parsing, awaited initialization, configured/updated cookies, visible HTTP/HTML failures, timeline data, warning deduplication, bootstrap rejection');
})().catch(error => { console.error(error); process.exitCode = 1; });
