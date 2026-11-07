const assert = require('assert').strict;
const fs = require('fs'), path = require('path'), Module = require('module'), ts = require('typescript');
function harness() {
  const values = new Map(), handlers = {}, inputs = [], logs = [], requests = [], listeners = [];
  let post = async () => ({ data: { code: 20000, data: { token: 'test-token' } } });
  const secrets = {
    get: async key => values.get(key),
    store: async (key, value) => { values.set(key, value); listeners.forEach(fn => fn({ key })); },
    delete: async key => { values.delete(key); listeners.forEach(fn => fn({ key })); },
    onDidChange: fn => { listeners.push(fn); return { dispose() {} }; },
  };
  const context = { secrets, subscriptions: [] };
  const vscode = {
    commands: { registerCommand: (name, fn) => { handlers[name] = fn; return { dispose() {} }; } },
    window: { showInputBox: async options => { logs.push(options); return inputs.shift(); }, showInformationMessage() {}, showErrorMessage() {} },
  };
  const filename = path.resolve(__dirname, '../src/shared/xgbAuth.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = new Module(filename, module);
  m.require = name => ({ vscode, '../globalState': { default: { context } }, axios: { default: { post: async (...args) => { requests.push(args); return post(...args); } } } })[name];
  m._compile(compiled, filename);
  m.exports.registerXuanGuBaoAuth(context);
  return { ...m.exports, values, inputs, logs, requests, configure: () => handlers['leek-fund.configureXuanGuBaoAccount'](), clear: () => handlers['leek-fund.clearXuanGuBaoAccount'](), setPost: fn => { post = fn; } };
}
(async () => {
  const h = harness();
  assert.equal(await h.getXuanGuBaoIvankaToken(), null);
  assert.equal(h.requests.length, 0, 'unconfigured users must not send login requests');
  h.inputs.push('13800000000', undefined);
  await h.configure();
  assert.equal(h.values.size, 0, 'cancellation must not partially store credentials');
  h.inputs.push('13800000000', 'test-only-password');
  await h.configure();
  assert(h.logs.at(-1).password, 'password input must be masked');
  assert.deepEqual(await h.xuanGuBaoAccountStatus(), { configured: true }, 'status must not expose credentials');
  await assert.rejects(h.saveXuanGuBaoAccount({ mobile: 'invalid', password: 'test' }), /手机号/);
  const tokens = await Promise.all([h.getXuanGuBaoIvankaToken(), h.getXuanGuBaoIvankaToken()]);
  assert.deepEqual(tokens, ['test-token', 'test-token']);
  assert.equal(h.requests.length, 1, 'concurrent logins must be deduplicated');
  assert.equal(h.requests[0][1].mobile, '+8613800000000');
  await h.getXuanGuBaoIvankaToken();
  assert.equal(h.requests.length, 1, 'cached token must be reused');
  await h.clear();
  assert.deepEqual(await h.xuanGuBaoAccountStatus(), { configured: false });
  assert.equal(await h.getXuanGuBaoIvankaToken(), null);
  h.inputs.push('+8613800000001', 'test-only-password-two');
  await h.configure();
  let complete;
  h.setPost(() => new Promise(resolve => { complete = resolve; }));
  const pending = h.getXuanGuBaoIvankaToken();
  await new Promise(resolve => setImmediate(resolve));
  await h.clear();
  complete({ data: { code: 20000, data: { token: 'stale-token' } } });
  assert.equal(await pending, null, 'cleared account must not restore an in-flight token');
  h.inputs.push('13800000000', 'test-only-password');
  await h.configure();
  h.setPost(async () => { throw { config: { data: 'test-only-password' } }; });
  const errors = [], original = console.error;
  console.error = (...args) => errors.push(args);
  try { assert.equal(await h.getXuanGuBaoIvankaToken(), null); } finally { console.error = original; }
  assert(!JSON.stringify(errors).includes('test-only-password'), 'errors must not leak credentials');
  console.log('PASS: missing credentials, cancellation, secure configuration, login deduplication/cache, clearing, in-flight invalidation, sanitized errors');
})().catch(error => { console.error(error); process.exitCode = 1; });
