const fs = require('fs');
const vm = require('vm');
const assert = require('assert').strict;
const ts = require('typescript');
const { EventEmitter } = require('events');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
function load(file, mocks, extras = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { exports, require: id => { if (!(id in mocks)) throw new Error('Unexpected dependency ' + id); return mocks[id]; }, console, URL, Date, Buffer, setTimeout, clearTimeout, setInterval, clearInterval, ...extras }, { filename: file });
  return exports;
}
const display = require('../src/shared/presentation.ts');
const hooks = require('../src/shared/webhook.ts');
const tests = [];
const test = (name, run) => tests.push([name, run]);
const defaults = () => ({ ...display.DISPLAY_DEFAULTS, statusBarStock: ['sh600519', 'hk00700'] });
test('settings validation accepts a complete legacy-compatible form and rejects invalid values', () => {
  assert.equal(display.validatePreferences(defaults()).bossMode, false);
  assert.equal(display.validatePreferences({ ...defaults(), blameCodeLensCount: 10 }).blameCodeLensCount, 10);
  for (const fields of [{ blameRotateSeconds: 1 }, { blameCodeLensCount: 11 }, { riseColor: '#12345' }, { iconType: 'invalid' }, { bossMode: 1 }, { statusBarStock: Array(9).fill('sh600519') }, { blameAuthor: 'one\ntwo' }]) assert.throws(() => display.validatePreferences({ ...defaults(), ...fields }));
});

test('sidebar preferences persist through the presentation bridge and reject invalid switches before writing', async () => {
  const bus = new EventEmitter(); const config = {}; const writes = []; const sent = []; let receive;
  const sidebarKeys = ['sidebarStockEnabled', 'sidebarNewsEnabled', 'sidebarBinanceEnabled', 'sidebarForexEnabled', 'sidebarSettingsEnabled', 'sidebarAgentEnabled'];
  const { readPreferences, registerPresentationBridge } = load('src/webview/leek-center/presentation-service.ts', {
    '../../shared/leekConfig': { LeekFundConfig: {
      getConfig: (key, fallback) => config[key] ?? fallback,
      setConfig: async (key, value) => { config[key] = value; writes.push(key); },
    } },
    '../../shared/presentation': display, '../../shared/utils': { events: bus },
    '../../service/webhook': { webhook: { status: async () => ({ enabled: false, targets: [] }) } },
    '../../shared/xgbAuth': { xuanGuBaoAccountStatus: async () => ({ configured: false }) },
  });
  for (const key of sidebarKeys) assert.equal(readPreferences()[key], true);
  registerPresentationBridge({ visible: true, webview: { onDidReceiveMessage: fn => { receive = fn; return { dispose() {} }; }, postMessage: data => sent.push(data) }, onDidDispose() {} }, { stockList: [] });
  const settings = { ...defaults(), ...Object.fromEntries(sidebarKeys.map(key => [key, false])) };
  await receive({ command: 'savePresentationSettings', data: settings });
  for (const key of sidebarKeys) { assert.equal(config['leek-fund.' + key], false); assert.equal(readPreferences()[key], false); }
  assert.equal(readPreferences().newsPanelEnabled, true);
  assert.equal(sent.find(item => item.command === 'presentationSettings').data.settings.sidebarSettingsEnabled, false);
  const before = writes.length;
  await receive({ command: 'savePresentationSettings', data: { ...settings, sidebarAgentEnabled: 'false' } });
  assert.equal(writes.length, before); assert.equal(sent.at(-1).data.success, false);
});

test('account bridge returns status only and keeps account writes separate from display settings', async () => {
  const sent = []; let receive; let account; let configured = false;
  const { registerPresentationBridge } = load('src/webview/leek-center/presentation-service.ts', {
    '../../shared/leekConfig': { LeekFundConfig: { getConfig: (_key, fallback) => fallback, setConfig: () => { throw new Error('must not write display settings'); } } },
    '../../shared/presentation': display, '../../shared/utils': { events: new EventEmitter() },
    '../../service/webhook': { webhook: { status: async () => ({ enabled: false, targets: [] }) } },
    '../../shared/xgbAuth': {
      xuanGuBaoAccountStatus: async () => ({ configured }),
      saveXuanGuBaoAccount: async value => { account = value; configured = true; },
      clearXuanGuBaoAccount: async () => { account = undefined; configured = false; },
    },
  });
  registerPresentationBridge({ visible: true, webview: { onDidReceiveMessage: fn => { receive = fn; return { dispose() {} }; }, postMessage: data => sent.push(data) }, onDidDispose() {} }, { stockList: [] });
  await receive({ command: 'saveXuanGuBaoAccount', data: { mobile: '13800000000', password: 'test-only-password' } });
  assert.equal(account.password, 'test-only-password');
  assert.equal(sent[0].command, 'xuanGuBaoAccountStatus');
  assert.equal(sent[0].data.configured, true);
  await receive({ command: 'getPresentationSettings' });
  assert.equal(sent.at(-1).data.xuanGuBao.configured, true);
  assert(!JSON.stringify(sent).includes('test-only-password'));
  assert(!JSON.stringify(sent).includes('13800000000'));
  await receive({ command: 'clearXuanGuBaoAccount' });
  assert.equal(account, undefined);
  assert.equal(sent.at(-2).data.configured, false);
});
test('profit templates preserve zero values and separate currency identity', () => {
  assert.equal(display.renderProfitLabel('${currency} ${profit} / ${todayProfit}', { currency: 'HKD', profit: 0, todayProfit: -10.123, marketValue: 5, cost: 5 }), 'HKD 0.00 / -10.12');
});
test('news keeps plain text, a stable vendor ID and a source-defined timestamp', () => {
  const item = display.normalizeNews('<b>重要</b>&amp;消息', { type: 'jin10', time: 123, data: { id: 42, important: 1 } });
  assert.equal(item.text, '重要&消息'); assert.equal(item.id, 'jin10:42'); assert.equal(item.time, 123); assert.equal(item.important, true);
  assert.equal(display.normalizeNews('bad', { type: 'other' }), undefined);
});
const wecom = { provider: 'wecom', url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=private-token' };
const ding = { provider: 'dingtalk', url: 'https://oapi.dingtalk.com/robot/send?access_token=private-token', secret: 'secret' };
const feishu = { provider: 'feishu', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-bot', secret: 'secret' };
test('robot endpoints reject wrong providers, embedded credentials and lookalike hosts', () => {
  for (const target of [{ ...wecom, url: wecom.url.replace('https:', 'http:') }, { ...wecom, url: wecom.url.replace('qyapi.weixin.qq.com', 'qyapi.weixin.qq.com.evil.test') }, { ...ding, provider: 'wecom' }, { ...feishu, url: 'https://user:pass@open.feishu.cn/open-apis/bot/v2/hook/id' }]) assert.throws(() => hooks.validateWebhook(target));
});
test('DingTalk and Feishu signatures match fixed timestamp vectors and their distinct envelopes', () => {
  const request = hooks.buildWebhook(ding, 'LeekFund 测试', 1700000000000);
  const url = new URL(request.url);
  assert.equal(url.searchParams.get('timestamp'), '1700000000000');
  assert.equal(url.searchParams.get('sign'), 'OuzzJR5+xZ4/EYwqtNt6sMYZQMTa/HEGvc9miJe7XzY=');
  assert.equal(request.body.msgtype, 'text'); assert.equal(request.body.text.content, 'LeekFund 测试');
  const lark = hooks.buildWebhook(feishu, 'LeekFund 测试', 1700000000000);
  assert.equal(lark.body.timestamp, '1700000000'); assert.equal(lark.body.sign, 'fiWS2+gh28DOydAv7hzONH/mDn9+b1Y4Y5ivXWXy8vA=');
  assert.equal(lark.body.content.text, 'LeekFund 测试');
});
test('HTTP success without a successful provider response is not treated as delivery', () => {
  assert.equal(hooks.webhookSucceeded('wecom', { errcode: 0 }), true);
  assert.equal(hooks.webhookSucceeded('dingtalk', { errcode: 310000 }), false);
  assert.equal(hooks.webhookSucceeded('feishu', { code: 19021, StatusCode: 0 }), false);
  assert.equal(hooks.webhookSucceeded('feishu', {}), false);
});
function sender() {
  const config = { enabled: false }; const secrets = new Map(); const calls = []; const warnings = [];
  let reply = () => Promise.resolve({ data: { errcode: 0, code: 0 } });
  const axios = { post: (...args) => { calls.push(args); return reply(...args); }, CancelToken: { source: () => ({ token: {}, cancel() {} }) } };
  const { WebhookService } = load('src/service/webhook.ts', { axios: { default: axios }, vscode: { window: { showWarningMessage: text => warnings.push(text) } }, '../shared/leekConfig': { LeekFundConfig: { getConfig: () => config.enabled } }, '../shared/webhook': hooks });
  const service = new WebhookService(0);
  service.initialize({ secrets: { get: async key => secrets.get(key), store: async (key, value) => secrets.set(key, value), delete: async key => secrets.delete(key) } });
  return { service, config, calls, warnings, secrets, reply: value => { reply = value; } };
}
test('robot credentials are stored separately, never returned in settings, and saving does not enable sending', async () => {
  const f = sender(); await f.service.save(wecom); await f.service.notify('a', 'price');
  assert.equal(f.calls.length, 0); assert.equal(f.secrets.size, 1);
  const status = JSON.stringify(await f.service.status());
  assert.equal(status.includes('private-token'), false); assert.equal(status.includes('configured'), true);
});
test('the sender deduplicates a price alert across all configured providers', async () => {
  const f = sender(); await f.service.save(wecom); await f.service.save(feishu); f.config.enabled = true;
  await Promise.all([f.service.notify('sh600519', 'price'), f.service.notify('sh600519', 'price')]);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0][2].maxRedirects, 0);
  f.service.dispose(); await f.service.notify('other', 'price'); assert.equal(f.calls.length, 2);
});
test('failed deliveries report only a generic failure and do not expose credentials', async () => {
  const f = sender(); await f.service.save(ding); f.config.enabled = true;
  f.reply(() => Promise.reject(new Error('private-token secret')));
  await f.service.notify('a', 'price');
  assert.equal(f.warnings.length, 1); assert.equal(f.warnings[0].includes('private-token'), false); assert.equal(f.warnings[0].includes('secret'), false);
});
test('disabling delivery while a request is pending prevents queued notifications', async () => {
  const f = sender(); await f.service.save(wecom); f.config.enabled = true;
  let release; f.reply(() => new Promise(resolve => { release = resolve; }));
  const first = f.service.notify('a', 'price');
  while (!release) await Promise.resolve();
  const second = f.service.notify('b', 'price'); f.config.enabled = false;
  release({ data: { errcode: 0 } }); await Promise.all([first, second]); assert.equal(f.calls.length, 1);
});

function newsFixture() {
  const bus = new EventEmitter(); let enabled = true; let consumer; let releases = 0;
  const disposables = []; const listeners = {}; const sent = [];
  const view = { visible: true, webview: { html: '', options: {}, onDidReceiveMessage: fn => { listeners.message = fn; return { dispose() {} }; }, postMessage: value => sent.push(value) }, onDidChangeVisibility: fn => { listeners.visible = fn; return { dispose() {} }; }, onDidDispose: fn => { listeners.dispose = fn; return { dispose() {} }; } };
  const { NewsPanel } = load('src/webview/newsPanel.ts', { crypto: require('crypto'), '../output/flash-news/FlashNewsDaemon': { default: { registerServer: value => { consumer = value; return () => { releases++; }; } } }, '../shared/leekConfig': { LeekFundConfig: { getConfig: () => enabled } }, '../shared/presentation': display, '../shared/utils': { events: bus } }, { setTimeout: () => 1, clearTimeout() {} });
  const panel = new NewsPanel(); panel.resolveWebviewView(view);
  return { panel, view, sent, bus, push: (content, source) => consumer.print(content, source), message: data => listeners.message({ command: 'newsPanel', data }), visibility: value => { view.visible = value; listeners.visible(); }, releases: () => releases, disable: () => { enabled = false; bus.emit('onDidChangeConfiguration'); } };
}
test('news panel deduplicates, filters and detaches the shared stream when hidden', () => {
  const f = newsFixture();
  f.push('<b>headline</b>', { type: 'jin10', time: 123, data: { id: 1, important: 1 } });
  f.push('headline', { type: 'jin10', time: 123, data: { id: 1, important: 1 } });
  f.push('other', { type: 'xgb', time: 124, data: { id: 2 } });
  f.message({ action: 'filter', source: 'jin10', important: true });
  assert.equal(f.sent.at(-1).data.entries.length, 1); assert.equal(f.sent.at(-1).data.entries[0].text, 'headline');
  f.visibility(false); assert.equal(f.releases(), 1);
  f.panel.dispose(); assert.equal(f.bus.listenerCount('onDidChangeConfiguration'), 0);
});
test('news panel retains at most 500 entries and can clear them without new network subscriptions', () => {
  const f = newsFixture();
  for (let i = 0; i < 600; i++) f.push('headline ' + i, { type: 'jin10', time: i, data: { id: i } });
  f.message({ action: 'ready' }); assert.equal(f.sent.at(-1).data.entries.length, 500);
  f.message({ action: 'clear' }); assert.equal(f.sent.at(-1).data.entries.length, 0);
  f.disable(); assert.equal(f.releases(), 1); f.panel.dispose();
});

test('status bar respects selected order, omits unavailable quotes, supports eight slots and disposes listeners', () => {
  const bus = new EventEmitter(); const bars = []; const crypto = { items: [] };
  const config = { 'leek-fund.statusBarStock': ['missing', ...Array.from({ length: 8 }, (_, i) => 'sh' + i)], 'leek-fund.hideStatusBar': false, 'leek-fund.hideStatusBarStock': false };
  const { StatusBar } = load('src/statusbar/statusBar.ts', {
    '../shared/binance': { binanceCode: /^[A-Z0-9]+_[A-Z0-9]+$/ },
    '../explorer/binanceQuotes': { binanceQuotes: crypto },
    vscode: { StatusBarAlignment: { Left: 1 }, window: { createStatusBarItem: () => { const bar = { show() {}, hide() {}, dispose() { this.disposed = true; } }; bars.push(bar); return bar; } } },
    '../globalState': { default: { labelFormat: { statusBarLabelFormat: '${name}' } } },
    '../shared/constant': { DEFAULT_LABEL_FORMAT: { statusBarLabelFormat: '${name}' } },
    '../shared/leekConfig': { LeekFundConfig: { getConfig: (key, fallback) => config[key] ?? fallback } },
    '../shared/utils': { events: bus, formatLabelString: (template, data) => data.name },
  });
  const quotes = Array.from({ length: 8 }, (_, i) => ({ info: { code: 'sh' + i, name: 'stock' + i, percent: '0' } }));
  const status = new StatusBar({ stockList: quotes.reverse() });
  assert.equal(bars.length, 7); assert.equal(bars[0].text, 'stock0'); assert.equal(bars[6].text, 'stock6');
  config['leek-fund.statusBarStock'] = Array.from({ length: 8 }, (_, i) => 'sh' + i);
  status.refresh(); assert.equal(bars.length, 8); assert.equal(bars[7].text, 'stock7');
  config['leek-fund.statusBarStock'] = ['BTC_USDT'];
  crypto.items = [{ info: { code: 'BTC_USDT', name: 'BTC_USDT', price: '70000', percent: '2' } }];
  bus.emit('binanceListUpdate');
  assert.equal(bars[0].text, 'BTC_USDT');
  assert.match(bars[0].tooltip, /滚动24小时/);
  assert.equal(bars[0].command.arguments[0], 'BTC_USDT');
  status.dispose(); assert.equal(bus.listenerCount('binanceListUpdate'), 0); assert.equal(bars.every(bar => bar.disposed), true); assert.equal(bus.listenerCount('stockListUpdate'), 0);
});

test('Blame draws only enabled holdings, rotates cached quotes, provides clickable lenses and cleans up', () => {
  const bus = new EventEmitter(); const timers = new Map(); let nextTimer = 0; let lenses;
  const config = { blameEnabled: false, blameOnlyHoldings: true, blameAuthor: 'You', blameCodeLensCount: 3, blameRotateSeconds: 10 };
  class Range { constructor(...args) { this.args = args; } }
  const document = { uri: { scheme: 'file' }, lineCount: 4, lineAt: () => ({ range: { end: {} } }) };
  const editor = { document, selection: { active: { line: 2 } }, draws: [], setDecorations(_, items) { this.draws.push(items); } };
  const deco = { dispose() { this.disposed = true; } };
  const vscode = { CodeLens: class { constructor(range, command) { this.range = range; this.command = command; } }, Range, ThemeColor: class {}, DecorationRangeBehavior: { ClosedClosed: 1 },
    EventEmitter: class { constructor() { this.event = () => {}; } fire() {} dispose() {} }, MarkdownString: class { appendText(text) { this.text = text; } },
    window: { activeTextEditor: editor, visibleTextEditors: [editor], createTextEditorDecorationType: () => deco, onDidChangeActiveTextEditor: () => ({ dispose() {} }), onDidChangeTextEditorSelection: () => ({ dispose() {} }) },
    languages: { registerCodeLensProvider: (_, provider) => { lenses = provider; return { dispose() {} }; } } };
  const quotes = ['a', 'b', 'c'].map(code => ({ info: { code, name: code, price: '100', percent: '1' } }));
  const { BlameQuotes } = load('src/service/blame.ts', {
    vscode, '../shared/leekConfig': { LeekFundConfig: { getConfig: (key, fallback) => config[key.replace('leek-fund.', '')] ?? fallback } },
    '../shared/utils': { events: bus }, './portfolio': { portfolio: { read: () => [{ code: 'a' }, { code: 'b' }, { code: 'c', isSellOut: true }] } }, '../shared/presentation': display,
  }, { setInterval: fn => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearInterval: id => timers.delete(id) });
  const service = new BlameQuotes({ stockList: quotes });
  assert.equal(lenses.provideCodeLenses(document).length, 0); assert.equal(timers.size, 0);
  config.blameEnabled = true; bus.emit('onDidChangeConfiguration');
  assert.equal(editor.draws.at(-1)[0].renderOptions.after.contentText.includes('a 100'), true);
  assert.equal(lenses.provideCodeLenses(document).length, 2);
  assert.equal(lenses.provideCodeLenses(document)[0].command.command, 'leek-fund.openQuoteByCode');
  [...timers.values()][0](); assert.equal(editor.draws.at(-1)[0].renderOptions.after.contentText.includes('b 100'), true);
  quotes.push(...Array.from({ length: 9 }, (_, i) => ({ info: { code: 'extra' + i, name: 'extra' + i, price: '100', percent: '1' } })));
  config.blameOnlyHoldings = false; config.stocks = quotes.map(item => item.info.code);
  document.lineCount = 20; config.blameCodeLensCount = 10;
  assert.equal(lenses.provideCodeLenses(document).length, 10);
  config.blameCodeLensCount = 11;
  assert.equal(lenses.provideCodeLenses(document).length, 10);
  config.blameEnabled = false; bus.emit('onDidChangeConfiguration'); assert.equal(editor.draws.at(-1).length, 0); assert.equal(timers.size, 0);
  service.dispose(); assert.equal(deco.disposed, true); assert.equal(bus.listenerCount('stockListUpdate'), 0); assert.equal(bus.listenerCount('onDidChangeConfiguration'), 0);
});

test('chart boss mode persists toggles, accepts host updates and installs only one toolbar', async () => {
  const { JSDOM } = require('../template-packages/leek-center/node_modules/jsdom');
  const bus = new EventEmitter(); let receive, dispose; const sent = []; const changes = [];
  const panel = { webview: { html: '<html><body><img src="chart.png"></body></html>', onDidReceiveMessage: fn => { receive = fn; return { dispose() {} }; }, postMessage: value => sent.push(value) }, onDidDispose: fn => { dispose = fn; } };
  const { installBossMode } = load('src/webview/bossMode.ts', { '../shared/leekConfig': { LeekFundConfig: { getConfig: () => true, setConfig: async (key, value) => changes.push([key, value]) } }, '../shared/utils': { events: bus } });
  installBossMode(panel); installBossMode(panel);
  const dom = new JSDOM(panel.webview.html, { runScripts: 'outside-only' });
  const posts = []; dom.window.acquireVsCodeApi = () => ({ postMessage: value => posts.push(value) });
  dom.window.eval(dom.window.document.querySelector('script').textContent);
  assert.equal(dom.window.document.querySelectorAll('#leek-boss-mode').length, 1);
  assert.equal(dom.window.document.body.classList.contains('boss-mode'), true);
  dom.window.document.querySelector('button').click();
  assert.equal(posts[0].command, 'bossModeToggle'); assert.equal(posts[0].data, false);
  await receive(posts[0]); assert.equal(changes[0][1], false);
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { command: 'bossMode', data: true } }));
  assert.equal(dom.window.document.body.classList.contains('boss-mode'), true);
  dispose(); assert.equal(bus.listenerCount('onDidChangeConfiguration'), 0); dom.window.close();
});

(async () => { let failed = 0; for (const [name, run] of tests) { try { await run(); console.log('PASS ' + name); } catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); } } console.log(`${tests.length - failed}/${tests.length} tests passed`); process.exitCode = failed ? 1 : 0; })();
