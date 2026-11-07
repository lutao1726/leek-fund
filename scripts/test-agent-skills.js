const assert = require('assert').strict, fs = require('fs'), fsp = fs.promises, path = require('path'), os = require('os'), Module = require('module'), ts = require('typescript');
const { pathToFileURL, fileURLToPath } = require('url');
class URI {
  constructor(value) { this.value = new URL(value); }
  static file(value) { return new URI(pathToFileURL(path.resolve(value))); }
  static parse(value) { return new URI(value); }
  static joinPath(base, ...parts) { return URI.file(path.join(base.fsPath, ...parts)); }
  get fsPath() { return fileURLToPath(this.value); }
  get scheme() { return this.value.protocol.replace(':', ''); }
  toString() { return this.value.toString(); }
}
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename }).outputText, filename);
function load(file, mocks = {}) { const filename = path.resolve(__dirname, '..', file), mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename)); const original = mod.require.bind(mod); mod.require = name => Object.hasOwn(mocks, name) ? mocks[name] : original(name); mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename }).outputText, filename); return mod.exports; }
const { parseInstallableSkill, githubSkillRepository } = require('../src/shared/agentSkillImport.ts');
const { readSkillArchive, skillCRC32 } = require('../src/service/agentSkillArchive.ts');
const { BUILTIN_SKILLS, parseAgentPrompt } = require('../src/shared/agent.ts');
const cases = [], test = (name, run) => cases.push([name, run]);
const native = (slash = 'review') => `---\nname: 复盘技能\ndescription: 整理证据\nslash: ${slash}\ntools:\n  - news\n---\n输出来源、日期及待核实事项。`;
const standard = '---\nname: market-review\ndescription: >-\n  Market review\n  with source dates\nmetadata:\n  arbitrary: ignored\nallowed-tools: Bash\n---\n# Review\nRead the available evidence.';
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), content = Buffer.from(entry.text || ''), data = entry.store ? content : require('zlib').deflateRawSync(content), method = entry.store ? 0 : 8;
    const a = Buffer.alloc(30); a.writeUInt32LE(0x04034b50); a.writeUInt16LE(20, 4); a.writeUInt16LE(method, 8); a.writeUInt32LE(skillCRC32(content), 14); a.writeUInt32LE(data.length, 18); a.writeUInt32LE(content.length, 22); a.writeUInt16LE(name.length, 26);
    const b = Buffer.alloc(46); b.writeUInt32LE(0x02014b50); b.writeUInt16LE(0x0314, 4); b.writeUInt16LE(20, 6); b.writeUInt16LE(method, 10); b.writeUInt32LE(entry.badCRC ? 0 : skillCRC32(content), 16); b.writeUInt32LE(data.length, 20); b.writeUInt32LE(content.length, 24); b.writeUInt16LE(name.length, 28); if (entry.symlink) b.writeUInt32LE((0xa1ff * 65536) >>> 0, 38); b.writeUInt32LE(offset, 42);
    local.push(a, name, data); central.push(b, name); offset += a.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
async function temporary(run) {
  const folder = await fsp.mkdtemp(path.join(os.tmpdir(), 'leek-skill-test-'));
  try { return await run(folder); } finally {
    const absolute = path.resolve(folder), base = path.resolve(os.tmpdir());
    if (path.dirname(absolute) !== base || !path.basename(absolute).startsWith('leek-skill-test-')) throw new Error('Unsafe test cleanup target');
    await fsp.rm(absolute, { recursive: true, force: true });
  }
}
function installer(root) {
  const { AgentSkillInstaller, readSkillDirectory } = load('src/service/agentSkillInstall.ts', { vscode: { Uri: URI }, './agentSkills': { agentSkillRoot: () => URI.file(root), agentSkillId: uri => 'skill-' + require('crypto').createHash('sha256').update(process.platform === 'win32' ? uri.toLowerCase() : uri).digest('hex').slice(0, 24) } });
  return { manager: new AgentSkillInstaller(root), readSkillDirectory };
}
test('standard documents become on-demand read-only Skills; explicit native tool declarations remain validated', () => {
  const skill = parseInstallableSkill(standard, '用户'); assert.equal(skill.slash, 'market-review'); assert.equal(skill.prefetch, false); assert.equal(skill.description, 'Market review with source dates'); assert(!skill.tools.includes('Bash'));
  assert.equal(parseInstallableSkill(native(), '用户').tools[0], 'news');
  assert.throws(() => parseInstallableSkill(native().replace('- news', '- shell'), '用户'));
  assert.throws(() => parseInstallableSkill('---\nname: ../../escape\ndescription: bad\n---\nbody', '用户'));
  assert.throws(() => parseInstallableSkill(standard + 'x'.repeat(24000), '用户'));
});
test('GitHub imports accept public repository roots and reject credentials, alternate hosts and arbitrary paths', () => {
  assert.equal(githubSkillRepository('https://github.com/example/skills.git'), 'example/skills');
  for (const url of ['http://github.com/a/b', 'https://github.com.evil.test/a/b', 'https://secret@github.com/a/b', 'https://github.com/a/b/tree/main', 'https://github.com/a/b?token=secret', 'file:///tmp/skills', 'https://127.0.0.1/a/b']) assert.throws(() => githubSkillRepository(url));
});
test('ZIP reader validates CRC and extracts only documents from store/deflate archives', () => {
  assert.equal(skillCRC32(Buffer.from('123456789')), 0xcbf43926);
  const docs = readSkillArchive(zip([{ name: 'repo/a/SKILL.md', text: native() }, { name: 'repo/b/SKILL.md', text: native('other'), store: true }, { name: 'repo/a/run.js', text: 'process.exit(1)' }]));
  assert.equal(docs.length, 2); assert.equal(docs[0].text, native());
  assert.throws(() => readSkillArchive(zip([{ name: 'a/SKILL.md', text: native(), badCRC: true }])), /校验/);
  assert.throws(() => readSkillArchive(zip([{ name: 'a/SKILL.md', text: 'x'.repeat(32001) }])), /32KB/);
});
test('ZIP path traversal, duplicate paths, links, truncation and unsupported archives never reach installation', () => {
  for (const name of ['../SKILL.md', '/root/SKILL.md', 'C:/SKILL.md', 'a\\SKILL.md', 'a/../../SKILL.md']) assert.throws(() => readSkillArchive(zip([{ name, text: native() }])), /路径/);
  assert.throws(() => readSkillArchive(zip([{ name: 'a/SKILL.md', text: native(), symlink: true }])), /符号/);
  assert.throws(() => readSkillArchive(zip([{ name: 'a/SKILL.md', text: native() }, { name: 'a/skill.md', text: native() }])), /重复/);
  assert.throws(() => readSkillArchive(zip([{ name: 'SKILL.md', text: native() }]).subarray(0, 25)));
  assert.throws(() => readSkillArchive(Buffer.alloc(21 * 1024 * 1024)), /20MB/);
});
test('directory imports discover nested documents, ignore assets and never execute package scripts', () => temporary(async folder => {
  const source = path.join(folder, 'source'); await fsp.mkdir(path.join(source, 'nested'), { recursive: true }); await fsp.writeFile(path.join(source, 'nested', 'SKILL.md'), native()); await fsp.writeFile(path.join(source, 'nested', 'run.js'), 'throw new Error("must not execute")');
  const { readSkillDirectory } = installer(path.join(folder, 'target')); const docs = await readSkillDirectory(source); assert.equal(docs.length, 1); assert.equal(docs[0].text, native());
}));
test('installs are document-only and disabled before activation; duplicates preserve the original bytes', () => temporary(async folder => {
  const root = path.join(folder, 'skills'), { manager } = installer(root), disabled = [];
  const result = await manager.install([{ path: 'from-anywhere/SKILL.md', text: native() }, { path: 'other/SKILL.md', text: 'invalid' }], async id => { disabled.push(id); });
  assert.deepEqual(result.installed, ['review']); assert.equal(result.skipped.length, 1); assert(/^skill-[a-f0-9]{24}$/.test(disabled[0]));
  assert.deepEqual(await fsp.readdir(path.join(root, 'review')), ['SKILL.md']);
  const duplicate = await manager.install([{ path: 'update/SKILL.md', text: native().replace('整理证据', 'changed') }], async () => {});
  assert.equal(duplicate.installed.length, 0); assert.equal(await fsp.readFile(path.join(root, 'review', 'SKILL.md'), 'utf8'), native());
}));
test('preference failures roll back only the newly created install folder', () => temporary(async folder => {
  const root = path.join(folder, 'skills'), { manager } = installer(root);
  const result = await manager.install([{ path: 'SKILL.md', text: native() }], async () => { throw new Error('storage failure'); });
  assert.equal(result.installed.length, 0); assert.deepEqual(await fsp.readdir(root), []);
}));
test('uninstall refuses builtin/workspace/outside paths and preserves unrelated user assets', () => temporary(async folder => {
  const root = path.join(folder, 'skills'), { manager } = installer(root); await manager.install([{ path: 'SKILL.md', text: native() }], async () => {});
  const directory = path.join(root, 'review'); await fsp.writeFile(path.join(directory, 'notes.txt'), 'keep');
  const entry = { builtin: false, removable: true, directory: URI.file(directory).toString() };
  await assert.rejects(() => manager.uninstall({ ...entry, builtin: true })); await assert.rejects(() => manager.uninstall({ ...entry, removable: false })); await assert.rejects(() => manager.uninstall({ ...entry, directory: URI.file(folder).toString() }));
  await manager.uninstall(entry); assert.equal(await fsp.readFile(path.join(directory, 'notes.txt'), 'utf8'), 'keep'); assert(!fs.existsSync(path.join(directory, 'SKILL.md')));
}));
test('disabled higher-priority definitions remain installed and do not fall back to builtin Skills', async () => {
  const root = URI.file(path.join(os.tmpdir(), 'fake-skill-root'));
  const vscode = { Uri: URI, FileType: { File: 1, Directory: 2 }, workspace: { isTrusted: false, fs: { readDirectory: async () => [['custom', 2]], stat: async () => ({ size: 200, type: 1 }), readFile: async () => Buffer.from(native('scan')) } } };
  const { loadAgentSkills, agentSkillId } = load('src/service/agentSkills.ts', { vscode, os: { homedir: () => root.fsPath } });
  const loaded = await loadAgentSkills(); const entry = loaded.catalog.find(s => s.slash === 'scan' && s.effective); assert.equal(entry.builtin, false); assert.equal(entry.id, agentSkillId(entry.directory)); assert.equal(loaded.catalog.find(s => s.id === 'builtin-scan').effective, false);
  const disabled = await loadAgentSkills([entry.id]); assert(!disabled.skills.some(s => s.slash === 'scan')); assert.equal(disabled.catalog.find(s => s.slash === 'scan' && s.effective).enabled, false);
  assert.throws(() => parseAgentPrompt('/scan', disabled.skills), /未启用/);
});
test('enable switches persist, active menus omit disabled Skills, and streamed states omit full instructions', async () => {
  const values = new Map(); const context = { globalStorageUri: '/storage', subscriptions: [], globalState: { get: (key, fallback) => values.get(key) || fallback, update: async (key, value) => { values.set(key, value); } } };
  const catalog = disabled => BUILTIN_SKILLS.map(s => ({ ...s, id: 'builtin-' + s.slash, enabled: !disabled.includes('builtin-' + s.slash), builtin: true, removable: false }));
  const { AgentService } = load('src/service/agent.ts', { vscode: { Uri: { joinPath: (...parts) => parts.join('/') }, workspace: { fs: { readFile: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }, createDirectory: async () => {}, writeFile: async () => {}, rename: async () => {} } } }, './agentModels': { AgentModels: class {} }, './agentTools': { AgentTools: class {}, agentToolDefinitions: [] }, './agentSkills': { loadAgentSkills: async (disabled = []) => ({ catalog: catalog(disabled), skills: catalog(disabled).filter(s => s.enabled), errors: [] }) } });
  const service = new AgentService(); await service.initialize(context, {}); await service.setSkillEnabled('builtin-scan', false);
  assert(values.get('agent.disabledSkills').includes('builtin-scan')); assert(!service.state().skills.some(s => s.slash === 'scan')); assert.equal(service.state().skillCatalog[0].instruction, ''); assert(service.skillDetail('builtin-scan').instruction);
  const id = service.create(); assert.throws(() => service.send(id, '/scan', 'byok'), /未启用/);
  await service.setSkillEnabled('builtin-scan', true); assert(service.state().skills.some(s => s.slash === 'scan')); service.dispose();
});
test('management bridge uses native selection, disables imported IDs and never accepts uninstall paths from UI', async () => {
  let receive, close, busy = false; const sent = [], disabled = [], removals = []; let reloads = 0;
  const entry = { id: 'known', directory: 'file:///known', removable: true, builtin: false };
  const fake = { state: () => ({ sessions: [] }), subscribe: () => () => {}, beginSkillOperation: () => { assert(!busy); busy = true; }, endSkillOperation: () => { busy = false; },
    disableInstalledSkill: async id => disabled.push(id), reloadSkills: async () => reloads++, skillDetail: id => { assert.equal(id, 'known'); return entry; }, forgetRemovedSkill: async id => { assert.equal(id, 'known'); }, setSkillEnabled: async () => {} };
  class Installer { async install(documents, disable) { assert.equal(documents[0].text, native()); await disable('skill-' + 'a'.repeat(24)); return { installed: ['review'], skipped: [] }; } async uninstall(record) { removals.push(record); } }
  const { registerAgentBridge } = load('src/webview/leek-center/agent-service.ts', { vscode: { window: { showOpenDialog: async () => [URI.file(path.join(os.tmpdir(), 'chosen-directory'))] } }, '../../service/agent': { agent: fake }, '../../service/agentSkillInstall': { AgentSkillInstaller: Installer, readSkillDirectory: async selected => { assert(selected.includes('chosen-directory')); return [{ path: 'SKILL.md', text: native() }]; } }, '../../service/agentSkillArchive': {} });
  registerAgentBridge({ postMessage: message => sent.push(message), onDidReceiveMessage: fn => { receive = fn; return { dispose() {} }; } }, { visible: true, onDidDispose: fn => { close = fn; } });
  await receive({ command: 'agentSkillDirectory' }); assert.equal(disabled.length, 1); assert.equal(reloads, 1); assert.equal(busy, false); assert(sent.some(m => m.command === 'agentSkillResult' && m.data.result?.installed[0] === 'review'));
  await receive({ command: 'agentSkillUninstall', data: { id: 'known', directory: 'file:///untrusted-path' } }); assert.equal(removals[0], entry); close();
});
test('closing a downloading panel cancels transport, releases the global operation and suppresses late results', async () => {
  let receive, close, signal, busy = false, installs = 0; const sent = [];
  const fake = { state: () => ({ sessions: [] }), subscribe: () => () => {}, beginSkillOperation: () => { if (busy) throw new Error('已有操作'); busy = true; }, endSkillOperation: () => { busy = false; } };
  const { registerAgentBridge } = load('src/webview/leek-center/agent-service.ts', { vscode: {}, '../../service/agent': { agent: fake }, '../../service/agentSkillInstall': { AgentSkillInstaller: class { install() { installs++; } } }, '../../service/agentSkillArchive': { downloadSkillRepository: (url, token) => { signal = token; return new Promise((resolve, reject) => token.addEventListener('abort', () => reject(new Error('安装已取消')))); } } });
  registerAgentBridge({ postMessage: message => sent.push(message), onDidReceiveMessage: fn => { receive = fn; return { dispose() {} }; } }, { visible: true, onDidDispose: fn => { close = fn; } });
  const request = receive({ command: 'agentSkillGithub', data: { url: 'https://github.com/example/skills' } });
  assert.equal(busy, true); await receive({ command: 'agentSkillToggle', data: { id: 'known', enabled: true } }); assert(sent.some(m => m.command === 'agentSkillResult' && m.data.success === false));
  const count = sent.length; close(); await request; assert(signal.aborted); assert.equal(installs, 0); assert.equal(busy, false); assert.equal(sent.length, count);
});
(async () => { let failed = 0; for (const [name, run] of cases) try { await run(); console.log('PASS', name); } catch (error) { failed++; console.error('FAIL', name, error); } console.log(`${cases.length - failed}/${cases.length} skill tests passed`); process.exitCode = failed ? 1 : 0; })();
