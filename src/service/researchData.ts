import axios, { AxiosRequestConfig } from 'axios';
import globalState from '../globalState';
import { ResearchQuote, ResearchSource, StockEvidence } from '../shared/research';

const timeout = 15000;
export function throwIfCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new Error('任务已取消');
}

// Axios 0.19 supports CancelToken; bridge the task's AbortSignal and release its listener.
async function cancellableGet(url: string, signal: AbortSignal, config: AxiosRequestConfig) {
  throwIfCancelled(signal);
  const source = axios.CancelToken.source();
  const abort = () => source.cancel('任务已取消');
  signal.addEventListener('abort', abort, { once: true });
  try { return await axios.get(url, { ...config, cancelToken: source.token }); }
  finally { signal.removeEventListener('abort', abort); }
}

/** Parse the vendor envelope, rather than sending JSONP/errors to the model as price evidence. */
export function parseDailyHistory(raw: unknown, code: string): string[][] {
  let parsed: any = raw;
  if (typeof raw === 'string') {
    let text = raw.trim().replace(/^[\w.]+\s*\(/, '').replace(/\)\s*;?$/, '');
    if (/^[\w.]+\s*=/.test(text)) text = text.substring(text.indexOf('=') + 1).replace(/;$/, '');
    try { parsed = JSON.parse(text); } catch { return []; }
  }
  let rows: unknown[] = [];
  if (Array.isArray(parsed)) {
    const response = parsed[0];
    // Sohu: date/open/close/change/change%/low/high/volume/amount/turnover.
    if (response?.status === 0 && Array.isArray(response.hq)) rows = response.hq.filter(Array.isArray)
      .map((row: unknown[]) => [row[0], row[1], row[2], row[6], row[5], row[7]]);
  } else {
    const data = parsed?.data?.[code];
    rows = data?.qfqday || data?.day || [];
  }
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is any[] => Array.isArray(row) && /^\d{4}-\d{2}-\d{2}$/.test(row[0]) &&
    row.slice(1, 5).length === 4 && row.slice(1, 5).every(value => Number.isFinite(Number(value)) && Number(value) > 0))
    .map(row => row.slice(0, 6).map(String)).sort((a, b) => a[0].localeCompare(b[0]));
}

export class ResearchData {
  async history(code: string, range: string, signal: AbortSignal): Promise<ResearchSource> {
    const fetchedAt = new Date().toISOString();
    const hkOrUs = /^(hk|usr_)/i.test(code);
    const title = hkOrUs ? '腾讯财经历史日线' : '搜狐财经历史日线';
    const source: ResearchSource = { id: 'S2', title, fetchedAt, status: 'missing', content: '' };
    try {
      const limits: Record<string, number> = { '1y': 250, '6m': 125, '3m': 66, '1m': 22, '1w': 5 };
      const limit = limits[range] || 66;
      let vendorCode = code.toLowerCase();
      if (hkOrUs) {
        vendorCode = vendorCode.replace(/^usr_/, 'us');
        source.url = `https://web.ifzq.gtimg.cn/appstock/app/${/^hk/i.test(code) ? 'hkfqkline' : 'usfqkline'}/get?param=${encodeURIComponent(vendorCode)},day,,,${limit},qfq`;
      } else {
        const start = new Date();
        start.setDate(start.getDate() - Math.ceil(limit * 1.8));
        source.url = `https://q.stock.sohu.com/hisHq?code=cn_${code.slice(2)}&start=${start.toISOString().slice(0, 10).replace(/-/g, '')}&end=${fetchedAt.slice(0, 10).replace(/-/g, '')}&stat=1&order=D&period=d&rt=json`;
      }
      const response = await cancellableGet(source.url, signal, { timeout, responseType: 'text' });
      const rows = parseDailyHistory(response.data, vendorCode).slice(-limit);
      if (rows.length) {
        source.status = 'available';
        source.asOf = rows[rows.length - 1][0];
        source.content = `日期,开盘,收盘,最高,最低,成交量\n${rows.map(row => row.join(',')).join('\n')}`;
      }
    } catch { /* Record missing evidence without manufacturing price history. */ }
    throwIfCancelled(signal);
    return source;
  }

  async news(signal: AbortSignal): Promise<{ items: any[]; fetchedAt: string; available: boolean }> {
    try {
      throwIfCancelled(signal);
      const response = await cancellableGet('https://baoer-api.xuangubao.com.cn/api/v6/message/newsflash', signal, {
        params: { limit: 100, platform: 'pcweb' }, timeout,
        headers: { Referer: 'https://xuangubao.com.cn/' },
      });
      if (response.data?.code === 20000 && Array.isArray(response.data.data?.messages)) {
        return { items: response.data.data.messages, fetchedAt: new Date().toISOString(), available: true };
      }
    } catch { /* The snapshot below explicitly labels unavailable news. */ }
    throwIfCancelled(signal);
    const cached = globalState.xuanGuBaoNews;
    return { items: cached?.allDayMessages || [], fetchedAt: cached?.lastUpdate ? new Date(cached.lastUpdate).toISOString() : new Date().toISOString(), available: false };
  }

  async collect(stock: { code: string; name: string }, quote: ResearchQuote | undefined, range: string,
    signal: AbortSignal, news: Awaited<ReturnType<ResearchData['news']>>): Promise<StockEvidence> {
    throwIfCancelled(signal);
    const capturedAt = new Date().toISOString();
    const limitations: string[] = [];
    const sources: ResearchSource[] = [];
    const hasQuote = quote?.price !== undefined && Number.isFinite(Number(quote.price)) && Number(quote.price) > 0;
    sources.push({ id: 'S1', title: '插件行情快照', fetchedAt: capturedAt, asOf: quote?.time,
      status: hasQuote ? 'available' : 'missing', content: hasQuote ? JSON.stringify(quote) : '' });
    if (!hasQuote) limitations.push('当前没有有效行情报价，不可计算实时价格或仓位风险。');
    if (!quote?.time) limitations.push('行情未提供可核对的交易时间，不将采集时间当作行情时间。');
    const history = await this.history(stock.code, range, signal);
    sources.push(history);
    if (history.status === 'missing') limitations.push('历史日线不可用，不能推算技术形态、支撑价或历史收益。');
    else limitations.push('历史日线使用供应商返回口径，复权处理未独立核验；最近日线日期为 ' + history.asOf + '。');
    const code = stock.code.replace(/^(sh|sz|bj|hk|usr_)/i, '');
    const terms = [stock.name, code, quote?.industry].filter((term): term is string => !!term && term.length >= 2);
    const relevant = news.items.filter(item => {
      const text = `${item.title || ''} ${item.summary || ''} ${JSON.stringify(item.bkj_infos || [])}`;
      return terms.some(term => text.toLowerCase().includes(term.toLowerCase()));
    }).slice(0, 15);
    const contents = relevant.map(item => {
      const published = Number(item.created_at);
      return { title: String(item.title || '').slice(0, 500), summary: String(item.summary || '').replace(/<[^>]*>/g, '').slice(0, 800),
        publishedAt: Number.isFinite(published) && published > 0 && published < 8640000000000 ? new Date(published * 1000).toISOString() : undefined,
        url: item.id ? `https://xuangubao.cn/article/${encodeURIComponent(String(item.id))}` : undefined };
    });
    sources.push({ id: 'S3', title: '选股宝关键词关联快讯（最近100条内筛选）', url: 'https://xuangubao.com.cn/',
      fetchedAt: news.fetchedAt, asOf: contents.map(item => item.publishedAt || '').sort().pop() || undefined,
      status: contents.length ? 'available' : 'missing', content: contents.length ? JSON.stringify(contents) : '' });
    if (!news.available) limitations.push('快讯接口不可用，已有内容来自本机缓存，可能过期。');
    if (!contents.length) limitations.push('最近快讯样本中未发现关键词关联内容，不代表没有重要公告或新闻。');
    limitations.push('未接入完整公告、财报及题材关系；关键词关联不等于业务影响已确认。');
    return { ...stock, capturedAt, quote, sources, limitations };
  }
}
