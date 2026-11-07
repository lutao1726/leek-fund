import { get } from 'https';
import { assertBoard, assertStock, BoardKind, BoardOverview, CHANGE_TYPES, MarketPage, MarketResult, MarketStock, marketNumber, marketTime, parseBoard, parseChanges, parseStock, SectorBoard, StockChange, StockProfile, StockScope, vendorRows } from '../shared/market';

export type MarketTransport = (url: string, signal: AbortSignal) => Promise<any>;
const PAGE_SIZE = 100;
const fields = 'f2,f3,f6,f8,f12,f13,f14,f20,f22,f62,f104,f105,f124,f128';
const aborted = () => new Error('市场数据请求已取消');
export const fetchMarketJSON: MarketTransport = (url, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(aborted()); return; }
  let settled = false; let timer: NodeJS.Timeout;
  const finish = (error?: Error, data?: any) => {
    if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', cancel);
    if (error) reject(error); else resolve(data);
  };
  const request = get(url, { headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' }, timeout: 12000 }, response => {
    if (response.statusCode !== 200) { response.resume(); finish(new Error(`行情源返回 HTTP ${response.statusCode}`)); return; }
    let body = ''; response.setEncoding('utf8');
    response.on('data', chunk => { body += chunk; if (body.length > 2 * 1024 * 1024) request.destroy(new Error('行情响应超过大小限制')); });
    response.on('aborted', () => finish(new Error('行情响应中断')));
    response.on('error', error => finish(error));
    response.on('end', () => { try { finish(undefined, JSON.parse(body)); } catch { finish(new Error('行情源未返回有效 JSON')); } });
  });
  const cancel = () => request.destroy(aborted());
  signal.addEventListener('abort', cancel, { once: true });
  timer = setTimeout(() => request.destroy(new Error('行情请求超时')), 12000);
  request.on('timeout', () => request.destroy(new Error('行情请求超时')));
  request.on('error', error => finish(error));
});

interface LoadValue<T> { data: T; asOf?: string; stale?: boolean; error?: string }
interface Pending { controller: AbortController; clients: Set<symbol>; promise: Promise<MarketResult<any>> }
export class MarketDataService {
  private cache = new Map<string, { snapshot: MarketResult<any>; expires: number }>();
  private pending = new Map<string, Pending>();
  private disposed = false;
  constructor(private transport: MarketTransport = fetchMarketJSON, private clock = () => Date.now()) {}
  initialize() { this.disposed = false; }
  get activeRequests() { return this.pending.size; }
  private url(path: string, params: Record<string, string | number>, host = 'push2.eastmoney.com') {
    const url = new URL(`https://${host}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return url.toString();
  }
  private async list(fs: string, page: number, fid: string, signal: AbortSignal) {
    const raw = await this.transport(this.url('/api/qt/clist/get', { pn: page, pz: PAGE_SIZE, po: 1, np: 1, fltt: 2, invt: 2, fid, fs, fields }), signal);
    return vendorRows(raw);
  }
  private page(value: number) { if (!Number.isInteger(value) || value < 1 || value > 200) throw new Error('页码须为 1～200'); return value; }
  private latest(items: { quoteTime?: string }[]) { return items.map(item => item.quoteTime).filter((time): time is string => !!time).sort().pop(); }

  private read<T>(key: string, ttl: number, load: (signal: AbortSignal) => Promise<LoadValue<T>>, signal: AbortSignal, force = false): Promise<MarketResult<T>> {
    if (this.disposed || signal.aborted) return Promise.reject(aborted());
    const cached = this.cache.get(key);
    if (!force && cached && cached.expires > this.clock()) {
      this.cache.delete(key); this.cache.set(key, cached);
      return Promise.resolve(cached.snapshot);
    }
    let pending = this.pending.get(key);
    if (!pending) {
      const controller = new AbortController();
      const entry: Pending = { controller, clients: new Set(), promise: undefined as any };
      entry.promise = Promise.resolve().then(() => load(controller.signal)).then(value => {
        if (controller.signal.aborted || this.disposed) throw aborted();
        const snapshot: MarketResult<T> = { ...value, fetchedAt: new Date(this.clock()).toISOString(), stale: !!value.stale };
        this.cache.delete(key); this.cache.set(key, { snapshot, expires: this.clock() + (snapshot.stale ? Math.min(ttl, 5000) : ttl) });
        while (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
        return snapshot;
      }).catch(error => {
        if (controller.signal.aborted || this.disposed) throw aborted();
        if (cached) return { ...cached.snapshot, stale: true, error: (error as Error).message };
        throw error;
      }).finally(() => { if (this.pending.get(key) === entry) this.pending.delete(key); });
      // Clients below own rejection handlers, including cancellations during startup.
      entry.promise.catch(() => {});
      this.pending.set(key, entry); pending = entry;
    }
    const current = pending;
    return new Promise((resolve, reject) => {
      const owner = Symbol(); let done = false;
      current.clients.add(owner);
      const detach = () => { current.clients.delete(owner); signal.removeEventListener('abort', cancel); };
      const cancel = () => {
        if (done) return; done = true; detach(); reject(aborted());
        if (!current.clients.size) { if (this.pending.get(key) === current) this.pending.delete(key); current.controller.abort(); }
      };
      signal.addEventListener('abort', cancel, { once: true });
      current.promise.then(value => { if (!done) { done = true; detach(); resolve(value); } }, error => { if (!done) { done = true; detach(); reject(error); } });
      if (signal.aborted) cancel();
    });
  }

  boards(kind: BoardKind, signal: AbortSignal, force = false) {
    if (!['industry', 'concept'].includes(kind)) throw new Error('不支持的板块类型');
    return this.read<MarketPage<SectorBoard>>('boards:' + kind, 60000, async token => {
      const items: SectorBoard[] = []; const seen = new Set<string>(); let total = 0; let dropped = false;
      for (let page = 1; page <= 20; page++) {
        const result = await this.list(`m:90+t:${kind === 'industry' ? 2 : 3}+f:!50`, page, 'f3', token);
        total = result.total;
        for (const raw of result.rows) {
          const board = parseBoard(raw, kind);
          if (!board) { dropped = true; continue; }
          if (seen.has(board.code)) { dropped = true; continue; }
          seen.add(board.code); items.push(board);
        }
        if (page * PAGE_SIZE >= total) break;
      }
      if (total && !items.length) throw new Error('板块记录无法识别');
      return { data: { items, total, page: 1, pageSize: items.length, partial: dropped || items.length < total }, asOf: this.latest(items) };
    }, signal, force);
  }
  overview(signal: AbortSignal, force = false) {
    return this.read<BoardOverview>('overview', 60000, async token => {
      const results = await Promise.allSettled([this.boards('industry', token, force), this.boards('concept', token, force)]);
      const errors: string[] = []; const groups: SectorBoard[][] = []; let partial = false;
      for (let i = 0; i < results.length; i++) {
        const result = results[i]; const label = i === 0 ? '行业' : '概念';
        if (result.status === 'fulfilled') {
          groups.push(result.value.data.items); partial = partial || !!result.value.data.partial;
          if (result.value.stale) errors.push(label + '：' + (result.value.error || '使用缓存数据'));
        } else { groups.push([]); errors.push(label + '：' + (result.reason as Error).message); }
      }
      if (!groups.some(items => items.length) && errors.length) throw new Error(errors.join('；'));
      return { data: { industry: groups[0], concept: groups[1], errors, partial: partial || errors.length > 0 }, asOf: this.latest(groups.flat()), stale: errors.length > 0, error: errors.join('；') || undefined };
    }, signal, force);
  }
  members(board: string, page: number, signal: AbortSignal, force = false) {
    assertBoard(board); this.page(page);
    return this.stocksPage(`members:${board}:${page}`, `b:${board}+f:!50`, page, 'f3', signal, force);
  }
  leaders(page: number, signal: AbortSignal, force = false) {
    this.page(page);
    return this.stocksPage('leaders:' + page, 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048', page, 'f3', signal, force);
  }
  universe(scope: StockScope, page: number, signal: AbortSignal, force = false) {
    this.page(page);
    const markets = { all: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048', star: 'm:1+t:23', chinext: 'm:0+t:80' };
    if (!Object.prototype.hasOwnProperty.call(markets, scope)) throw new Error('不支持的市场范围');
    return this.stocksPage(`universe:${scope}:${page}`, markets[scope], page, 'f20', signal, force);
  }
  private stocksPage(key: string, fs: string, page: number, fid: string, signal: AbortSignal, force: boolean) {
    return this.read<MarketPage<MarketStock>>(key, 15000, async token => {
      const result = await this.list(fs, page, fid, token);
      const items = result.rows.map(parseStock).filter((row): row is MarketStock => !!row);
      if (result.rows.length && !items.length) throw new Error('个股记录无法识别');
      return { data: { items, total: result.total, page, pageSize: PAGE_SIZE, partial: items.length < result.rows.length }, asOf: this.latest(items) };
    }, signal, force);
  }
  boardQuote(board: string, signal: AbortSignal, force = false) {
    assertBoard(board);
    return this.read<Omit<SectorBoard, 'kind'>>('quote:' + board, 15000, async token => {
      // List/ulist fields share the same units; stock/get uses a different field dictionary.
      const response = await this.transport(this.url('/api/qt/ulist.np/get', { secids: '90.' + board, fltt: 2, fields }), token);
      const raw = vendorRows(response).rows.find(row => row.f12 === board);
      if (!raw) throw new Error('板块代码与报价不匹配');
      const data = { code: board, name: String(raw.f14 || board), price: marketNumber(raw.f2), percent: marketNumber(raw.f3), marketCap: marketNumber(raw.f20), turnoverRate: marketNumber(raw.f8), netInflow: marketNumber(raw.f62), quoteTime: marketTime(raw.f124) };
      return { data, asOf: data.quoteTime };
    }, signal, force);
  }
  private async quote(secid: string, signal: AbortSignal) {
    const raw = await this.transport(this.url('/api/qt/stock/get', { secid, fltt: 2, fields: 'f43,f57,f58,f62,f86,f100,f116,f127,f129,f168,f170' }), signal);
    if (raw?.rc !== 0 || !raw.data || typeof raw.data.f57 !== 'string') throw new Error('报价数据不可用');
    return raw.data;
  }
  changes(direction: 'all' | 'up' | 'down', type: number | undefined, page: number, signal: AbortSignal, force = false) {
    this.page(page);
    if (!['all', 'up', 'down'].includes(direction) || (type !== undefined && !CHANGE_TYPES[type])) throw new Error('异动筛选条件不正确');
    const types = Object.keys(CHANGE_TYPES).map(Number).filter(id => (type === undefined || id === type) && (direction === 'all' || CHANGE_TYPES[id].direction === direction));
    return this.read<MarketPage<StockChange>>(`changes:${direction}:${type || 'all'}:${page}`, 15000, async token => {
      if (!types.length) return { data: { items: [], total: 0, page, pageSize: PAGE_SIZE } };
      // This endpoint splits the raw query before decoding; escaped commas select only its first type.
      const url = this.url('/getAllStockChanges', { type: types.join(','), pageindex: page - 1, pagesize: PAGE_SIZE, ut: '7eea3edcaed734bea9cbfc24409ed989', dpt: 'wzchanges' }, 'push2ex.eastmoney.com').replace(/%2C/gi, ',');
      const raw = await this.transport(url, token);
      return { data: parseChanges(raw, page) };
    }, signal, force);
  }
  profile(code: string, signal: AbortSignal, force = false) {
    assertStock(code);
    return this.read<StockProfile>('profile:' + code, 15000, async token => {
      const digits = code.slice(2); const market = code.slice(0, 2);
      const secucode = digits + '.' + market.toUpperCase();
      const url = this.url('/securities/api/data/v1/get', { reportName: 'RPT_F10_ORG_BASICINFO', columns: 'SECURITY_NAME_ABBR,ORG_NAME,ORG_PROFILE,ORG_PROFIE,MAIN_BUSINESS,EM2016,BLGAINIAN', filter: `(SECUCODE="${secucode}")`, pageSize: 1, pageNumber: 1 }, 'datacenter.eastmoney.com');
      const results = await Promise.allSettled([this.quote((market === 'sh' ? '1.' : '0.') + digits, token), this.transport(url, token)]);
      const errors: string[] = []; let quote: MarketStock | undefined; let company: any;
      const q = results[0]; const c = results[1];
      if (q.status === 'fulfilled' && q.value.f57 === digits) {
        const raw = q.value;
        quote = { code, name: String(raw.f58), price: marketNumber(raw.f43), percent: marketNumber(raw.f170), marketCap: marketNumber(raw.f116), turnoverRate: marketNumber(raw.f168), quoteTime: marketTime(raw.f86) };
      } else errors.push('个股报价暂不可用');
      if (c.status === 'fulfilled' && c.value?.success === true && Array.isArray(c.value.result?.data) && c.value.result.data.length) company = c.value.result.data[0];
      else errors.push('企业简介暂不可用');
      if (!quote && !company) throw new Error(errors.join('；'));
      const text = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 6000) : undefined;
      const concepts = Array.from(new Set(String(company?.BLGAINIAN || (q.status === 'fulfilled' ? q.value.f129 || '' : '')).split(',').map(name => name.trim()).filter(Boolean))).slice(0, 60);
      const data: StockProfile = { code, name: quote?.name || text(company?.SECURITY_NAME_ABBR) || code, company: text(company?.ORG_NAME), description: text(company?.ORG_PROFIE) || text(company?.ORG_PROFILE), mainBusiness: text(company?.MAIN_BUSINESS), industry: text(company?.EM2016) || (q.status === 'fulfilled' ? text(q.value.f127) : undefined), concepts, quote, errors };
      return { data, asOf: quote?.quoteTime, stale: errors.length > 0, error: errors.join('；') || undefined };
    }, signal, force);
  }
  dispose() { this.disposed = true; this.pending.forEach(entry => entry.controller.abort()); this.pending.clear(); this.cache.clear(); }
}
export const marketData = new MarketDataService();
