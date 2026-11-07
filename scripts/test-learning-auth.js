// Simulate VSCode's native account API. No real credentials are read or printed.
const assert = require('assert').strict, fs = require('fs'), path = require('path'), Module = require('module'), ts = require('typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
require.extensions['.ts'] = (m, p) => m._compile(compile(fs.readFileSync(p, 'utf8')), p);
function load(file, mocks) { const filename = path.resolve(__dirname, '..', file), m = new Module(filename, module); m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename)); const original = m.require.bind(m); m.require = name => Object.hasOwn(mocks, name) ? mocks[name] : original(name); m._compile(compile(fs.readFileSync(filename, 'utf8')), filename); return m.exports; }
const learning = require('../src/service/learning.ts');
const articlePath = '交易体系/入门.md';
const tree = { sha: 'a'.repeat(40), tree: [{ path: articlePath, type: 'blob', sha: 'b'.repeat(40), size: 20 }] };
const session = (label = 'local-user', token = 'test-only-token-one') => ({ id: 'session-' + label, accessToken: token, scopes: ['read:user'], account: { id: label, label } });
function harness() {
  const messages = [], requests = [], authCalls = [], files = new Map(); let receive, dispose, change, serial = 0;
  const state = { session: undefined, cancel: false, limited: false, disposed: false };
  const vscode = {
    Uri: { joinPath: (...parts) => parts.join('/'), parse: value => value }, env: { openExternal: async () => true },
    workspace: { fs: { readFile: async uri => { if (!files.has(uri)) throw new Error('missing'); return files.get(uri); }, createDirectory: async () => {}, writeFile: async (uri, bytes) => files.set(uri, bytes) } },
    authentication: {
      getSession: async (provider, scopes, options) => { authCalls.push({ provider, scopes, options }); if (state.cancel && options.createIfNone) throw new Error('cancelled'); return state.session; },
      onDidChangeSessions: callback => { change = callback; return { dispose() { state.disposed = true; } }; },
    },
  };
  const panel = { webview: { postMessage: value => { messages.push(value); return Promise.resolve(true); }, onDidReceiveMessage: callback => { receive = callback; return { dispose() {} }; } }, onDidDispose: callback => { dispose = callback; } };
  load('src/webview/leek-center/learning-service.ts', {
    vscode, '../../globalState': { default: { context: { globalStorageUri: '/storage' } } },
    '../../service/learning': { ...learning, fetchLearningText: async (url, signal, token) => {
      requests.push({ url, token });
      if (url.includes('/git/trees/')) { if (state.limited && !token) throw new learning.LearningHTTPError('匿名额度已用完', Date.now() + 3600000); return JSON.stringify(tree); }
      return '已读取的文章正文';
    } },
  }).registerLearningService(panel);
  return { state, messages, requests, authCalls, files, change: async () => { change({ provider: { id: 'github' } }); await new Promise(resolve => setTimeout(resolve, 5)); },
    send: async (command, data = {}) => { const id = `request-${++serial}`; await receive({ command, data: { ...data, id } }); return messages.find(message => message.command === 'learningResult' && message.data.id === id)?.data; },
    dispose: () => dispose() };
}
let count = 0;
async function test(name, run) { await run(); count++; console.log('PASS', name); }
(async () => {
  await test('reuses an authorized VSCode GitHub session silently with minimal scopes', async () => {
    const h = harness(); h.state.session = session(); const result = await h.send('learningCatalog');
    assert.equal(result.result.source, 'github'); assert.deepEqual(h.authCalls[0], { provider: 'github', scopes: ['read:user'], options: { silent: true } });
    assert.equal(h.requests[0].token, 'test-only-token-one'); assert(h.messages.some(message => message.command === 'learningAuthState' && message.data.account === 'local-user'));
    await h.send('learningArticle', { path: articlePath });
    assert(!JSON.stringify(h.messages).includes('test-only-token')); assert(!Array.from(h.files.values()).some(bytes => bytes.toString().includes('test-only-token'))); h.dispose();
  });
  await test('connecting an account immediately replaces the anonymous rate-limit cooldown', async () => {
    const h = harness(); h.state.limited = true;
    const anonymous = await h.send('learningCatalog'); assert.equal(anonymous.result.source, 'bundled');
    h.state.session = session(); const connected = await h.send('learningConnectGitHub');
    assert.equal(connected.result.source, 'github'); assert.equal(connected.result.stale, false); assert.equal(h.requests.filter(request => request.url.includes('/git/trees/')).length, 2);
    assert(h.authCalls.at(-1).options.createIfNone); assert.equal(h.authCalls.at(-1).options.clearSessionPreference, true); h.dispose();
  });
  await test('cancelling authorization preserves usable cached articles and reports a clear error', async () => {
    const h = harness(); await h.send('learningCatalog'); await h.send('learningArticle', { path: articlePath }); h.state.cancel = true;
    assert((await h.send('learningConnectGitHub')).error.includes('未获得 GitHub 账号授权'));
    assert.equal((await h.send('learningArticle', { path: articlePath })).result.value.text, '已读取的文章正文'); h.dispose();
  });
  await test('sign-out and account changes update the displayed identity and future requests', async () => {
    const h = harness(); h.state.session = session(); await h.send('learningCatalog');
    h.state.session = undefined; await h.change(); await h.send('learningCatalog', { force: true }); assert.equal(h.requests.at(-1).token, undefined);
    h.state.session = session('second-user', 'test-only-token-two'); await h.send('learningConnectGitHub'); assert.equal(h.requests.at(-1).token, 'test-only-token-two');
    assert(h.messages.some(message => message.command === 'learningAuthState' && message.data.account === 'second-user')); h.dispose(); assert(h.state.disposed);
  });
  await test('changing identity during an in-flight anonymous failure clears that failure afterwards', async () => {
    let reject; let calls = 0;
    const service = new learning.LearningService({ read: async () => undefined, write: async () => {} }, async () => {
      if (++calls === 1) return new Promise((_resolve, fail) => { reject = fail; }); return JSON.stringify(tree);
    });
    const first = service.catalog(); await new Promise(resolve => setImmediate(resolve));
    const identity = service.useIdentity('signed-in-session'); reject(new learning.LearningHTTPError('anonymous limit', Date.now() + 3600000));
    await assert.rejects(first); await identity; assert.equal((await service.catalog(true)).source, 'github'); service.dispose();
  });
  console.log(`${count}/${count} learning authentication tests passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
