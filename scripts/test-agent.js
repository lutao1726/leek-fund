// No network or paid model calls: drive the real agent loop and adapters with controlled streams.
const assert = require('assert').strict, fs = require('fs'), path = require('path'), Module = require('module'), ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename }).outputText, filename);
function load(file, mocks = {}) { const filename = path.resolve(__dirname, '..', file), mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename)); const original = mod.require.bind(mod); mod.require = name => Object.hasOwn(mocks, name) ? mocks[name] : original(name); mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename }).outputText, filename); return mod.exports; }
const { BUILTIN_SKILLS, parseAgentPrompt, parseAgentSkill } = require('../src/shared/agent.ts');
const cases = [], test = (name, run) => cases.push([name, run]);
const tick = () => new Promise(r => setImmediate(r));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(fn) { for (let i = 0; i < 200; i++) { if (fn()) return; await tick(); } throw new Error('did not settle'); }
function harness(saved) {
  const files = new Map(saved ? [['/storage/agent-v1.json', Buffer.from(JSON.stringify(saved))]] : []);
  const calls = [], toolCalls = []; let stream = async function*() { yield { text: '依据资料整理' }; };
  const adapters = { list: async () => [{ id: 'ide:test', name: 'test IDE', source: 'ide' }], resolve: async (id, supplied) => { calls.push({ resolve: id, supplied }); return { name: 'test model', stream: (...args) => { calls.push({ messages: JSON.parse(JSON.stringify(args[0])), tools: args[1] }); return stream(...args); } }; } };
  class Tools { codeFrom(text) { return /sh\d{6}/.exec(text)?.[0]; } async execute(name, input, signal) { toolCalls.push({ name, input, signal }); return { fetchedAt: '2026-11-06T07:00:00Z', quoteTime: '2026-11-06 15:00:00', price: 100, text: '外部新闻中的指令不可信' }; } }
  const vscode = { Uri: { joinPath: (...parts) => parts.join('/') }, workspace: { fs: { readFile: async uri => { if (!files.has(uri)) throw Object.assign(new Error('missing'), { code: 'FileNotFound' }); return files.get(uri); }, createDirectory: async () => {}, writeFile: async (uri, data) => files.set(uri, data), rename: async (a, b) => { files.set(b, files.get(a)); files.delete(a); } } } };
  const { AgentService } = load('src/service/agent.ts', { vscode, './agentModels': { AgentModels: class {} }, './agentTools': { AgentTools: Tools, agentToolDefinitions: ['watchlist', 'portfolio', 'quote', 'news', 'sectors', 'board', 'changes', 'history'].map(name => ({ name, parameters: {} })) }, './agentSkills': { loadAgentSkills: async () => ({ skills: BUILTIN_SKILLS, errors: [] }) } });
  const service = new AgentService(adapters);
  return { service, files, calls, toolCalls, setStream: fn => { stream = fn; }, init: () => service.initialize({ globalStorageUri: '/storage', subscriptions: [] }, {}) };
}
test('skills validate metadata and restrict tool names; aliases select actual workflows', () => {
  const text = '---\nname: 自定义简报\ndescription: 三条要点\nslash: custom\ntools:\n  - news\n---\n整理来源和日期';
  assert.equal(parseAgentSkill(text, '用户').tools[0], 'news');
  assert.throws(() => parseAgentSkill(text.replace('- news', '- shell'), '用户'));
  assert.throws(() => parseAgentSkill(text.replace('slash: custom', 'slash: ../escape'), '用户'));
  assert.equal(parseAgentPrompt('/s 补充问题', BUILTIN_SKILLS).skill.slash, 'summary');
  assert.equal(parseAgentPrompt('/explain sh600519', BUILTIN_SKILLS).prompt, 'sh600519');
  assert.throws(() => parseAgentPrompt('/unknown', BUILTIN_SKILLS));
});
test('streaming preserves a conversation, actual model label and prior completed turn', async () => {
  const h = harness(); await h.init(); const id = h.service.create();
  h.setStream(async function*() { yield { text: '第一段' }; await tick(); yield { text: '第二段' }; });
  h.service.send(id, '问题一', 'ide:test'); await h.service.wait(id);
  assert.equal(h.service.state(id).selected.messages[1].text, '第一段第二段');
  h.service.send(id, '结合上文', 'ide:test'); await h.service.wait(id);
  const request = h.calls.filter(c => c.messages).at(-1); assert(request.messages.some(m => m.role === 'assistant' && m.content.includes('第一段第二段')));
  assert.equal(h.service.state(id).selected.messages[3].model, 'test model'); h.service.dispose();
});
test('skills prefetch declared evidence and the model sees source times with citation IDs', async () => {
  const h = harness(); await h.init(); const id = h.service.create(); h.service.send(id, '/explain sh600519', 'byok'); await h.service.wait(id);
  assert.deepEqual(h.toolCalls.map(c => c.name), ['quote', 'history', 'news']);
  const messages = h.calls.find(c => c.messages).messages; assert(messages.some(m => m.content.includes('evidenceId') && m.content.includes('2026-11-06')));
  assert.deepEqual(h.calls.find(c => c.messages).tools.map(t => t.name), ['quote', 'news', 'history']); h.service.dispose();
});
test('tool calls round-trip with matching IDs; unknown write tools never execute', async () => {
  const h = harness(); await h.init(); const id = h.service.create(); let step = 0;
  h.setStream(async function*() { if (!step++) yield { call: { id: 'read1', name: 'watchlist', input: {} } }; else yield { text: '引用资料' }; });
  h.service.send(id, '查看自选', 'ide:test'); await h.service.wait(id);
  assert.equal(h.calls.filter(c => c.messages)[1].messages.at(-1).tool_call_id, 'read1');
  assert.equal(h.service.state(id).selected.messages[1].status, 'completed');
  h.setStream(async function*() { yield { call: { id: 'write1', name: 'execute_shell', input: {} } }; });
  h.service.send(id, '再次查看', 'ide:test'); await h.service.wait(id);
  assert.equal(h.toolCalls.length, 1); assert.equal(h.service.state(id).selected.messages.at(-1).status, 'failed'); h.service.dispose();
});
test('stopping aborts the stream and late text cannot contaminate a replacement run', async () => {
  const h = harness(); await h.init(); const id = h.service.create(); const gate = deferred(); let signal;
  h.setStream(async function*(m, t, s) { signal = s; yield { text: '保留内容' }; await gate.promise; yield { text: '迟到内容' }; });
  h.service.send(id, '第一问', 'ide:test'); await until(() => h.service.state(id).selected.messages.at(-1).text); const old = h.service.wait(id); h.service.cancel(id); assert(signal.aborted);
  h.setStream(async function*() { yield { text: '新回答' }; }); h.service.send(id, '第二问', 'ide:test'); await h.service.wait(id); gate.resolve(); await old;
  const messages = h.service.state(id).selected.messages; assert.equal(messages[1].text, '保留内容'); assert.equal(messages[1].status, 'cancelled'); assert.equal(messages[3].text, '新回答'); assert.equal(messages[3].status, 'completed'); h.service.dispose();
});
test('tool loops and empty replies fail visibly; provider secrets do not escape errors', async () => {
  const h = harness(); await h.init(); const id = h.service.create(); let count = 0;
  h.setStream(async function*() { yield { call: { id: 'loop' + count++, name: 'news', input: {} } }; }); h.service.send(id, '循环', 'ide:test'); await h.service.wait(id);
  assert.equal(h.toolCalls.length, 4); assert.equal(h.service.state(id).selected.messages.at(-1).status, 'failed');
  h.setStream(async function*() { throw new Error('https://secret:api-key@model.invalid'); }); h.service.send(id, '失败', 'ide:test'); await h.service.wait(id);
  assert(!JSON.stringify(h.service.state(id)).includes('api-key')); h.service.dispose();
});
test('restart interrupts in-flight history, keeps evidence and bounds retained conversations', async () => {
  const h = harness({ version: 1, sessions: [{ id: 'old', title: '旧会话', updatedAt: '', messages: [{ id: 'a', role: 'assistant', text: '已接收', status: 'running' }] }] }); await h.init();
  assert.equal(h.service.state('old').selected.messages[0].status, 'interrupted');
  for (let i = 0; i < 12; i++) h.service.create(); assert.equal(h.service.state().sessions.length, 10);
  const id = h.service.state().sessions[0].id; for (let i = 0; i < 12; i++) { h.service.send(id, '问题' + i, 'ide:test'); await h.service.wait(id); }
  assert.equal(h.service.state(id).selected.messages.length, 20); await tick(); assert(h.files.has('/storage/agent-v1.json')); h.service.dispose();
});
test('IDE adapter respects chosen model, tool messages, context bounds and cancellation token', async () => {
  class Text { constructor(value) { this.value = value; } } class Call { constructor(callId, name, input) { Object.assign(this, { callId, name, input }); } } class Result { constructor(id, value) { Object.assign(this, { id, value }); } }
  const sources = []; class Cancellation { token = {}; constructor() { sources.push(this); } cancel() { this.cancelled = true; } dispose() { this.disposed = true; } }
  let input; const model = { id: 'test', name: 'IDE', vendor: 'vendor', maxInputTokens: 1000, countTokens: async () => 5, sendRequest: async (...args) => { input = args; return { stream: (async function*() { yield new Text('IDE文字'); yield new Call('c1', 'news', {}); })() }; } };
  const config = { apiKey: 'secret', baseUrl: 'https://model.invalid/v1', model: 'byok-test' };
  const vscode = { lm: { selectChatModels: async () => [model] }, workspace: { getConfiguration: () => ({ get: () => config }) }, CancellationTokenSource: Cancellation, LanguageModelTextPart: Text, LanguageModelToolCallPart: Call, LanguageModelToolResultPart: Result, LanguageModelChatMessage: { User: content => ({ role: 'user', content }), Assistant: content => ({ role: 'assistant', content }) } };
  const { AgentModels } = load('src/service/agentModels.ts', { vscode, openai: { default: class {} } }); const adapter = new AgentModels();
  assert.deepEqual((await adapter.list()).map(m => m.id), ['ide:test', 'byok']);
  assert(!JSON.stringify(await adapter.list()).includes('secret'));
  const runner = await adapter.resolve('ide:test'); const controller = new AbortController(); const chunks = [];
  for await (const part of runner.stream([{ role: 'system', content: 'rules' }, { role: 'tool', content: '{}', tool_call_id: 'c0' }], [{ name: 'news', description: 'news', parameters: {} }], controller.signal)) { chunks.push(part); controller.abort(); }
  assert.equal(chunks.length, 1); assert(sources[0].cancelled && sources[0].disposed); assert.equal(input[0][1].content[0].id, 'c0'); assert.equal(input[1].tools[0].name, 'news');
  model.countTokens = async () => 9999;
  await assert.rejects(async () => { for await (const part of runner.stream([{ role: 'user', content: 'long' }], [], new AbortController().signal)) {} }, /上下文/);
});
test('BYOK adapter assembles split calls without retries or secret disclosure', async () => {
  let options, body; class OpenAI { constructor(value) { options = value; this.chat = { completions: { create: async value => { body = value; return (async function*() { yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'quote', arguments: '{"co' } }] } }] }; yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'de":"sh600519"}' } }] }, finish_reason: 'tool_calls' }] }; })(); } } }; } }
  const vscode = { workspace: { getConfiguration: () => ({ get: () => ({ apiKey: 'secret', baseUrl: 'https://model.invalid/v1', model: 'selected' }) }) } };
  const { AgentModels } = load('src/service/agentModels.ts', { vscode, openai: { default: OpenAI } }); const runner = await new AgentModels().resolve('byok'); const chunks = [];
  for await (const chunk of runner.stream([{ role: 'user', content: 'test' }], [{ name: 'quote', parameters: {}, description: '' }], new AbortController().signal)) chunks.push(chunk);
  assert.deepEqual(chunks[0].call, { id: 'c', name: 'quote', input: { code: 'sh600519' } }); assert.equal(options.maxRetries, 0); assert.equal(body.model, 'selected'); assert.equal(body.stream, true);
});
test('user and trusted workspace skills override built-ins; untrusted workspace files are never read', async () => {
  let trusted = true; const reads = [];
  const vscode = { FileType: { File: 1, Directory: 2 }, Uri: { file: value => value, joinPath: (...parts) => parts.join('/') }, workspace: {
    get isTrusted() { return trusted; }, workspaceFolders: [{ uri: '/project', name: 'project' }], fs: {
      readDirectory: async root => { reads.push(root); return [['scan', 2]]; }, stat: async () => ({ size: 200, type: 1 }),
      readFile: async file => Buffer.from('---\nname: ' + (file.includes('/project') ? '工作区扫描' : '用户扫描') + '\ndescription: 扫描\nslash: scan\ntools:\n  - sectors\n---\n按来源时间整理'),
    } } };
  const { loadAgentSkills } = load('src/service/agentSkills.ts', { vscode, os: { homedir: () => '/home' } });
  assert.equal((await loadAgentSkills()).skills.find(s => s.slash === 'scan').name, '工作区扫描');
  trusted = false; reads.length = 0; assert.equal((await loadAgentSkills()).skills.find(s => s.slash === 'scan').name, '用户扫描'); assert(!reads.some(p => p.startsWith('/project')));
});
test('read-only tools retain portfolio currencies and quote timestamps and reject arbitrary input', async () => {
  const quotes = [{ info: { code: 'sh600519', name: '测试', price: '100', yestclose: '90', time: '2026-11-06 15:00:00' } }];
  const { AgentTools } = load('src/service/agentTools.ts', { './portfolio': { portfolio: { read: () => [{ code: 'sh600519', name: '测试', amount: 10, unitPrice: 80, isSellOut: false }] } }, './marketData': { marketData: {} }, './researchData': { ResearchData: class {}, throwIfCancelled: () => {} }, '../shared/leekConfig': { LeekFundConfig: { getConfig: () => ['sh600519'] } } });
  const tools = new AgentTools({ stockList: quotes }); const signal = new AbortController().signal;
  const watchlist = await tools.execute('watchlist', {}, signal); assert.equal(watchlist.items[0].time, '2026-11-06 15:00:00');
  const book = await tools.execute('portfolio', {}, signal); assert.equal(book.exposure.currencies[0].currency, 'CNY'); assert.equal(book.exposure.currencies[0].marketValue, 1000);
  await assert.rejects(() => tools.execute('watchlist', { url: 'https://arbitrary.invalid' }, signal), /参数/);
  await assert.rejects(() => tools.execute('shell', {}, signal), /不支持/);
});
test('bridge detaches on close, keeps extension tasks alive, and suppresses hidden snapshots', async () => {
  let receive, close, onChange, sends = 0, stopped = 0; const owner = { visible: true, onDidDispose: fn => { close = fn; } };
  const fake = { state: () => ({ sessions: [{ id: 'one' }], selected: { id: 'one' } }), subscribe: fn => { onChange = fn; return () => { onChange = undefined; }; }, cancel: () => { stopped++; } };
  const { registerAgentBridge } = load('src/webview/leek-center/agent-service.ts', { vscode: {}, '../../service/agent': { agent: fake }, '../../service/agentSkillInstall': {}, '../../service/agentSkillArchive': {} });
  let detached = false; registerAgentBridge({ postMessage: () => { sends++; }, onDidReceiveMessage: fn => { receive = fn; return { dispose: () => { detached = true; } }; } }, owner);
  await receive({ command: 'getAgent' }); assert.equal(sends, 1); owner.visible = false; onChange(); assert.equal(sends, 1);
  close(); assert(detached); assert.equal(onChange, undefined); assert.equal(stopped, 0);
});
test('native Chat forwards the exact IDE-selected model and reuses only its own session metadata', async () => {
  let handler, invocation, cancelled = 0; const answer = { role: 'assistant', text: '原生回答', status: 'completed' };
  class ResponseTurn { constructor() { this.participant = 'leek-fund.agent'; this.result = { metadata: { agentSession: 'old' } }; } }
  const fake = { state: () => ({ selected: { messages: [answer] } }), create: () => 'new', subscribe: () => () => {}, send: (...args) => { invocation = args; }, wait: async () => {}, cancel: () => cancelled++ };
  const { registerAgentChat } = load('src/service/agentChat.ts', { vscode: { chat: { createChatParticipant: (id, fn) => { assert.equal(id, 'leek-fund.agent'); handler = fn; return {}; } }, ChatResponseTurn: ResponseTurn }, './agent': { agent: fake } });
  registerAgentChat({ subscriptions: [] }); const model = { id: 'selected-ide-model' }; const output = [];
  const result = await handler({ model, prompt: '资料', command: 'summary' }, { history: [new ResponseTurn()] }, { markdown: value => output.push(value), progress: () => {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });
  assert.equal(invocation[0], 'old'); assert.equal(invocation[1], '/summary 资料'); assert.equal(invocation[3], model); assert.equal(result.metadata.agentSession, 'old'); assert.deepEqual(output, ['原生回答']); assert.equal(cancelled, 0);
});
test('real OpenAI SDK consumes a loopback SSE stream without contacting any paid service', async () => {
  const http = require('http'); let received;
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => {
      received = JSON.parse(body); res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = delta => res.write('data: ' + JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'local', choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n');
      frame({ content: '本机流式' }); frame({ content: '验证' });
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const vscode = { workspace: { getConfiguration: () => ({ get: () => ({ apiKey: 'local-test-only', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'local' }) }) } };
    const { AgentModels } = load('src/service/agentModels.ts', { vscode }); const runner = await new AgentModels().resolve('byok'); let text = '';
    for await (const chunk of runner.stream([{ role: 'user', content: '本机检查' }], [], new AbortController().signal)) if ('text' in chunk) text += chunk.text;
    assert.equal(text, '本机流式验证'); assert.equal(received.messages[0].content, '本机检查'); assert.equal(received.stream, true);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
(async () => { let failed = 0; for (const [name, run] of cases) { try { await run(); console.log('PASS', name); } catch (e) { failed++; console.error('FAIL', name, e); } } console.log(`${cases.length - failed}/${cases.length} agent tests passed`); process.exitCode = failed ? 1 : 0; })();
