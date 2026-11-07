import { get } from 'https';
import { encodeLearningPath, LearningArticle, LearningCatalog, LearningResult, parseLearningTree } from '../shared/learning';

export interface LearningCache { catalog?: LearningCatalog; articles: LearningArticle[] }
export interface LearningStorage { read(): Promise<LearningCache | undefined>; write(value: LearningCache): Promise<void> }
export type LearningTransport = (url: string, signal: AbortSignal) => Promise<string>;
export class LearningHTTPError extends Error {
  constructor(message: string, public retryAt?: number) { super(message); this.name = 'LearningHTTPError'; }
}
export const fetchLearningText = (url: string, signal: AbortSignal, accessToken?: string): Promise<string> => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(new Error('请求已取消')); return; }
  const target = new URL(url);
  const authenticated = !!accessToken && target.origin === 'https://api.github.com' && !target.username && !target.password
    && target.pathname.startsWith('/repos/zhouqinglong520/trading-mastery/');
  const headers: Record<string, string> = { 'User-Agent': 'LeekFund-Learning', Accept: 'application/vnd.github+json', 'Cache-Control': 'no-cache' };
  if (authenticated) headers.Authorization = `Bearer ${accessToken}`;
  let done = false; let bytes = 0; const chunks: Buffer[] = [];
  const finish = (error?: Error, value?: string) => {
    if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', cancel);
    if (error) reject(error); else resolve(value!);
  };
  const request = get(url, { headers }, response => {
    if (response.statusCode !== 200) {
      response.resume();
      const status = response.statusCode;
      const exhausted = response.headers['x-ratelimit-remaining'] === '0';
      const now = Date.now(); const reset = Number(response.headers['x-ratelimit-reset']) * 1000;
      const delay = Number(response.headers['retry-after']) * 1000;
      const until = Math.min(now + 86400000, Math.max(now + 60000, exhausted && Number.isFinite(reset) ? reset : now + (Number.isFinite(delay) ? delay : 60000)));
      const reason = exhausted && (status === 403 || status === 429) ? `GitHub ${authenticated ? '已登录账号' : '匿名'} API 额度已用完（HTTP ${status}）`
        : status === 429 ? 'GitHub 请求过于频繁（HTTP 429）'
          : status === 401 ? 'GitHub 登录授权已失效（HTTP 401），请重新连接 GitHub 账号'
          : status === 403 ? 'GitHub 拒绝访问（HTTP 403），可能受到网络或代理限制' : `资料源返回 HTTP ${status}`;
      finish(new LearningHTTPError(reason, status === 403 || status === 429 ? until : undefined)); return;
    }
    response.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) request.destroy(new Error('资料超过 2 MB 阅读限制，请打开原文')); else chunks.push(chunk); });
    response.on('aborted', () => finish(new Error('资料下载中断')));
    response.on('error', error => finish(error));
    response.on('end', () => finish(undefined, Buffer.concat(chunks).toString('utf8')));
  });
  const cancel = () => request.destroy(new Error('请求已取消'));
  const timer = setTimeout(() => request.destroy(new Error('资料请求超时，请重试')), 20000);
  signal.addEventListener('abort', cancel, { once: true });
  request.on('error', error => finish(error));
});

export class LearningService {
  private cache: LearningCache = { articles: [] };
  private ready: Promise<void>;
  private syncing?: Promise<LearningResult<LearningCatalog>>;
  private articles = new Map<string, Promise<LearningResult<LearningArticle>>>();
  private controller = new AbortController();
  private writes = Promise.resolve();
  private catalogFailure?: { until: number; error: Error };
  private requestIdentity = 'anonymous';
  constructor(private storage: LearningStorage, private transport = fetchLearningText, private clock = () => Date.now(), private bundled?: LearningCatalog) {
    this.ready = storage.read().then(value => {
      if (value && Array.isArray(value.articles)) this.cache = { catalog: Array.isArray(value.catalog?.items) ? value.catalog : undefined, articles: value.articles };
    }).catch(() => {});
  }
  private async persist() {
    const value = { catalog: this.cache.catalog, articles: [...this.cache.articles] };
    const write = this.writes.then(() => this.storage.write(value));
    this.writes = write.catch(() => {});
    try { await write; return undefined; } catch { return '本次内容已加载，但本地缓存保存失败'; }
  }
  async catalog(force = false): Promise<LearningResult<LearningCatalog>> {
    await this.ready;
    if (this.syncing) return this.syncing;
    if (this.catalogFailure && this.catalogFailure.until > this.clock()) return this.fallback(this.catalogFailure.error);
    if (!force && this.cache.catalog && this.clock() - Date.parse(this.cache.catalog.fetchedAt) < 6 * 3600000) return { value: this.cache.catalog, stale: false, source: 'cache' };
    this.syncing = (async () => {
      try {
        const text = await this.transport('https://api.github.com/repos/zhouqinglong520/trading-mastery/git/trees/main?recursive=1', this.controller.signal);
        const value = parseLearningTree(JSON.parse(text), this.clock());
        this.catalogFailure = undefined;
        this.cache.catalog = value;
        this.cache.articles = this.cache.articles.filter(article => value.items.some(item => item.path === article.path && item.sha === article.sha));
        return { value, stale: false, source: 'github' as const, error: await this.persist() };
      } catch (error) {
        const failure = error instanceof Error ? error : new Error('资料同步失败');
        this.catalogFailure = { until: failure instanceof LearningHTTPError && failure.retryAt ? failure.retryAt : this.clock() + 60000, error: failure };
        return this.fallback(failure);
      } finally { this.syncing = undefined; }
    })();
    return this.syncing;
  }
  async useIdentity(identity: string) {
    if (identity === this.requestIdentity) return;
    // Let an earlier request settle before clearing only that identity's retry window.
    if (this.syncing) await this.syncing.catch(() => {});
    this.requestIdentity = identity;
    this.catalogFailure = undefined;
  }
  private fallback(error: Error): LearningResult<LearningCatalog> {
    const value = this.cache.catalog || this.bundled;
    const retry = this.catalogFailure && this.catalogFailure.until > this.clock()
      ? `；${Math.max(1, Math.ceil((this.catalogFailure.until - this.clock()) / 60000))} 分钟后可重试远程同步` : '';
    if (!value) throw new Error(`${error.message}${retry}`);
    const source = this.cache.catalog ? 'cache' : 'bundled';
    return { value, stale: true, source, error: `远程同步失败，显示${source === 'bundled' ? '插件内置目录（非最新同步）' : '上次缓存'}：${error.message}${retry}` };
  }
  async article(path: string, force = false): Promise<LearningResult<LearningArticle>> {
    await this.ready;
    const catalog = this.cache.catalog || this.bundled;
    const item = catalog?.items.find(item => item.path === path);
    if (!item || !catalog || item.kind !== 'md') throw new Error('请选择目录中的 Markdown 文章');
    if (item.size > 2 * 1024 * 1024) throw new Error('资料超过 2 MB 阅读限制，请打开原文');
    const key = `${path}:${item.sha}`;
    const pending = this.articles.get(key); if (pending) return pending;
    const cached = this.cache.articles.find(article => article.path === path && article.sha === item.sha);
    if (cached && !force) return { value: cached, stale: false };
    const task = (async () => {
      try {
        const text = await this.transport(`https://raw.githubusercontent.com/zhouqinglong520/trading-mastery/${catalog.revision}/${encodeLearningPath(path)}`, this.controller.signal);
        const value = { path, sha: item.sha, text, fetchedAt: new Date(this.clock()).toISOString() };
        this.cache.articles = [value, ...this.cache.articles.filter(article => article.path !== path)].slice(0, 12);
        while (this.cache.articles.length > 1 && this.cache.articles.reduce((sum, article) => sum + Buffer.byteLength(article.text), 0) > 4 * 1024 * 1024) this.cache.articles.pop();
        return { value, stale: false, error: await this.persist() };
      } catch (error) {
        if (!cached) throw error;
        return { value: cached, stale: true, error: `文章刷新失败，显示上次缓存：${(error as Error).message}` };
      } finally { this.articles.delete(key); }
    })();
    this.articles.set(key, task); return task;
  }
  dispose() { this.controller.abort(); }
}
