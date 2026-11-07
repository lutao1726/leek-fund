const assert = require('assert').strict, fs = require('fs'), ts = require('typescript');
require.extensions['.ts'] = (m, p) => m._compile(ts.transpileModule(fs.readFileSync(p, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, p);
const { LearningService, LearningHTTPError, fetchLearningText } = require('../src/service/learning.ts');
const { parseLearningTree, learningUrl, learningPath } = require('../src/shared/learning.ts');
const revision = 'a'.repeat(40), sha = 'b'.repeat(40), nextSha = 'c'.repeat(40);
const path = '游资心法/炒股养家/学习笔记.md';
const entry = (path, sha = 'b'.repeat(40)) => ({ path, sha, type: 'blob', size: 100 });
const tree = entries => ({ sha: revision, truncated: false, tree: entries });
const store = () => ({ value: undefined, async read() { return this.value; }, async write(value) { this.value = JSON.parse(JSON.stringify(value)); } });
let count = 0;
async function test(name, run) { await run(); count++; console.log('PASS', name); }
(async () => {
  await test('catalog counts actual files and preserves topics and file types', () => {
    const catalog = parseLearningTree(tree([entry(path), entry('个人复盘/复盘表.xlsx'), entry('可视化/图解.html'), entry('README.md'), entry(path), entry('游资心法/资料.exe')]), 0);
    assert.equal(catalog.items.length, 3); assert.equal(catalog.items.find(x => x.path === path).topic, '炒股养家');
    assert.throws(() => parseLearningTree({ ...tree([]), truncated: true }, 0)); assert.throws(() => parseLearningTree(tree([]), 0));
  });
  await test('source URLs encode paths, open the visual homepage and reject traversal', () => {
    assert.equal(learningPath('交易体系/../a.md'), false); assert.equal(learningPath('交易体系\\a.md'), false);
    const resource = { path: '可视化/图 #1.html', kind: 'html' };
    assert.equal(learningUrl(resource, revision, true), 'https://zhouqinglong520.github.io/trading-mastery/');
    assert.equal(learningUrl(undefined, 'main', true), 'https://zhouqinglong520.github.io/trading-mastery/');
    assert(learningUrl(resource, revision).endsWith('/%E5%8F%AF%E8%A7%86%E5%8C%96/%E5%9B%BE%20%231.html'));
    assert(learningUrl(resource, revision).includes(`/blob/${revision}/`));
    assert.throws(() => learningUrl({ path: '../foo.md' }, revision));
  });
  await test('refresh loads additions, changed articles and removals with immutable URLs', async () => {
    let raw = tree([entry(path)]); let body = '第一版'; const urls = [];
    const storage = store(); const service = new LearningService(storage, async url => { urls.push(url); return url.includes('/git/trees/') ? JSON.stringify(raw) : body; });
    await service.catalog(); assert.equal((await service.article(path)).value.text, '第一版');
    raw = tree([entry(path, nextSha), entry('交易体系/新文章.md')]); body = '更新内容';
    assert.equal((await service.catalog(true)).value.items.length, 2); assert.equal((await service.article(path)).value.text, '更新内容');
    assert(urls.some(url => url.includes(`/trading-mastery/${revision}/`)));
    raw = tree([entry('交易体系/新文章.md')]); await service.catalog(true); await assert.rejects(service.article(path)); service.dispose();
  });
  await test('cached articles survive restarts and offline refresh reports old timestamps', async () => {
    const storage = store(); let now = 1000;
    const service = new LearningService(storage, async url => url.includes('/git/trees/') ? JSON.stringify(tree([entry(path)])) : '养家心法', () => now);
    await service.catalog(); await service.article(path); service.dispose(); now += 7 * 3600000;
    const offline = new LearningService(storage, async () => { throw new Error('网络中断'); }, () => now);
    const result = await offline.catalog(true); assert.equal(result.stale, true); assert.equal(result.value.fetchedAt, new Date(1000).toISOString());
    assert.equal((await offline.article(path)).value.text, '养家心法');
    const article = await offline.article(path, true); assert.equal(article.stale, true); assert(article.error.includes('网络中断')); offline.dispose();
  });
  await test('failed first sync and truncated updates do not replace usable data', async () => {
    let raw = tree([entry(path)]); const service = new LearningService(store(), async () => JSON.stringify(raw));
    await service.catalog(); raw = { ...raw, truncated: true }; assert.equal((await service.catalog(true)).stale, true); service.dispose();
    const empty = new LearningService(store(), async () => { throw new Error('offline'); }); await assert.rejects(empty.catalog(), /offline/); empty.dispose();
  });
  await test('simultaneous catalog and article requests share a download', async () => {
    let calls = 0; const service = new LearningService(store(), async url => { calls++; return url.includes('/git/trees/') ? JSON.stringify(tree([entry(path)])) : '内容'; });
    await Promise.all([service.catalog(true), service.catalog(true)]); assert.equal(calls, 1);
    await Promise.all([service.article(path, true), service.article(path, true)]); assert.equal(calls, 2); service.dispose();
  });
  await test('bounded article cache and storage failures retain usable content', async () => {
    const entries = Array.from({ length: 15 }, (_, i) => entry(`交易体系/${i}.md`)); const storage = store();
    const service = new LearningService(storage, async url => url.includes('/git/trees/') ? JSON.stringify(tree(entries)) : '文');
    await service.catalog(); for (const item of entries) await service.article(item.path);
    assert.equal(storage.value.articles.length, 12); await assert.rejects(service.article('../secret.md')); service.dispose();
    const failing = new LearningService({ read: async () => undefined, write: async () => { throw new Error('disk full'); } }, async () => JSON.stringify(tree(entries)));
    const result = await failing.catalog(); assert.equal(result.stale, false); assert(result.error.includes('缓存保存失败')); failing.dispose();
  });
  await test('HTTPS transport preserves multibyte UTF-8 across buffer boundaries', async () => {
    const https = require('https'), { EventEmitter } = require('events'); const original = https.get;
    https.get = (_url, _options, receive) => {
      const req = new EventEmitter(); req.destroy = error => req.emit('error', error);
      process.nextTick(() => { const res = new EventEmitter(); res.statusCode = 200; receive(res); const bytes = Buffer.from('养家心法'); res.emit('data', bytes.slice(0, 2)); res.emit('data', bytes.slice(2)); res.emit('end'); });
      return req;
    };
    try { assert.equal(await fetchLearningText('https://example.test', new AbortController().signal), '养家心法'); } finally { https.get = original; }
  });
  await test('first-load API failure uses bundled metadata, reads articles and recovers after cooldown', async () => {
    const bundled = parseLearningTree(tree([entry(path)]), 0); const storage = store(); let now = 1000, calls = 0, offline = true;
    const transport = async url => {
      if (!url.includes('/git/trees/')) return '内置目录对应文章';
      calls++; if (offline) throw new LearningHTTPError('GitHub 请求过于频繁（HTTP 429）', 61000);
      return JSON.stringify(tree([entry(path), entry('交易体系/新增.md')]));
    };
    const service = new LearningService(storage, transport, () => now, bundled);
    const fallback = await service.catalog(true); assert.equal(fallback.source, 'bundled'); assert.equal(fallback.stale, true); assert.equal(fallback.value.fetchedAt, bundled.fetchedAt);
    assert(fallback.error.includes('非最新同步')); assert.equal((await service.article(path)).value.text, '内置目录对应文章');
    await service.catalog(true); assert.equal(calls, 1); // Manual refresh also respects GitHub's retry window.
    offline = false; now = 62000; const fresh = await service.catalog(true); assert.equal(calls, 2); assert.equal(fresh.source, 'github'); assert.equal(fresh.stale, false); assert.equal(fresh.value.items.length, 2);
    service.dispose();
  });
  await test('bundled-catalog articles persist even when no remote catalog was ever available', async () => {
    const bundled = parseLearningTree(tree([entry(path)]), 0); const storage = store();
    const service = new LearningService(storage, async url => { if (url.includes('/git/trees/')) throw new Error('offline'); return '保存的文章'; }, () => 1000, bundled);
    await service.catalog(); await service.article(path); service.dispose();
    assert.equal(storage.value.catalog, undefined);
    const restarted = new LearningService(storage, async () => { throw new Error('offline'); }, () => 2000, bundled);
    assert.equal((await restarted.catalog()).source, 'bundled'); assert.equal((await restarted.article(path)).value.text, '保存的文章'); restarted.dispose();
  });
  await test('HTTP errors distinguish denial, exhausted quota and throttling with retry times', async () => {
    const https = require('https'), { EventEmitter } = require('events'); const original = https.get;
    try {
      for (const sample of [
        { status: 403, headers: {}, message: '拒绝访问' },
        { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 3600) }, message: '额度已用完' },
        { status: 429, headers: { 'retry-after': '120' }, message: '请求过于频繁' },
      ]) {
        https.get = (_url, _options, receive) => {
          const req = new EventEmitter(); req.destroy = error => req.emit('error', error);
          process.nextTick(() => { const res = new EventEmitter(); res.statusCode = sample.status; res.headers = sample.headers; res.resume = () => {}; receive(res); }); return req;
        };
        await assert.rejects(fetchLearningText('https://example.test', new AbortController().signal), error => error instanceof LearningHTTPError && error.message.includes(sample.message) && error.retryAt > Date.now() + 59000);
      }
    } finally { https.get = original; }
  });
  await test('GitHub credentials are sent only to the intended repository API', async () => {
    const https = require('https'), { EventEmitter } = require('events'); const original = https.get; const seen = [];
    https.get = (url, options, receive) => {
      seen.push({ url, headers: options.headers }); const req = new EventEmitter(); req.destroy = error => req.emit('error', error);
      process.nextTick(() => { const res = new EventEmitter(); res.statusCode = 200; receive(res); res.emit('data', Buffer.from('ok')); res.emit('end'); }); return req;
    };
    const urls = ['https://api.github.com/repos/zhouqinglong520/trading-mastery/git/trees/main', 'https://raw.githubusercontent.com/zhouqinglong520/trading-mastery/main/a.md', 'https://zhouqinglong520.github.io/trading-mastery/', 'https://api.github.com/repos/someone/other/git/trees/main', 'https://api.github.com.evil.test/repos/zhouqinglong520/trading-mastery/'];
    try { for (const url of urls) await fetchLearningText(url, new AbortController().signal, 'test-only-token'); }
    finally { https.get = original; }
    assert.equal(seen[0].headers.Authorization, 'Bearer test-only-token'); seen.slice(1).forEach(request => assert.equal(request.headers.Authorization, undefined));
  });
  if (process.argv.includes('--live')) await test('live repository sync and first article load', async () => {
    const service = new LearningService(store()); const catalog = await service.catalog(true);
    const first = catalog.value.items.find(item => item.kind === 'md'); const article = await service.article(first.path);
    assert(article.value.text.length > 100); assert(!article.value.text.includes('\uFFFD')); console.log(`Live: ${catalog.value.items.length} resources; ${first.path}; ${article.value.text.length} chars`); service.dispose();
  });
  console.log(`${count}/${count} learning tests passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
