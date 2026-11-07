import { calculatePortfolio, Currency, currencyOf, equityCode, Position, PortfolioTotal } from './portfolio';
import { calculateExposure, CurrencyExposure, ResearchJob, ResearchStatus, researchActive } from './research';
import { normalizeNews, plainText } from './presentation';
import { numericAmount } from './watchlist';

export interface SummaryQuote {
  code: string; name: string; price?: string | number; percent?: string | number;
  amount?: string | number; yestclose?: string | number; time?: string; industry?: string;
}
export interface SummaryNewsInput { content: string; source?: { type: string; data: any; time: number }; receivedAt?: number }
export interface SummaryReport {
  jobId: string; at: string; ageDays: number; old: boolean; summary: string; partial: boolean;
}
export interface SummaryAttempt { jobId: string; status: ResearchStatus; stage: string; at: string }
export interface SummaryRow {
  code: string; name: string; watched: boolean; held: boolean; equity: boolean;
  currency: Currency | 'unknown'; price?: number; percent?: number; turnover?: number;
  quoteTime?: string; quoteDate?: string; industry?: string; latestReport?: SummaryReport; latestAttempt?: SummaryAttempt;
}
export interface SummaryNews {
  id: string; source: 'xgb' | 'jin10'; text: string; time: number; date?: string; receivedAt?: number;
  matches: { code: string; name: string; held: boolean; reason: string }[];
}
export interface SummaryCurrency extends PortfolioTotal {
  exposure?: CurrencyExposure;
  dates: string[];
  dailyLabel: string;
}
export interface DailySummarySnapshot {
  date: string; generatedAt: string;
  counts: { watched: number; held: number; quoted: number; missing: number; moving: number; researched: number; activeResearch: number };
  rows: SummaryRow[]; currencies: SummaryCurrency[];
  news: { items: SummaryNews[]; cached: number; matched: number; today: number; updatedAt?: string };
  latestInspection?: { jobId: string; at: string; status: ResearchStatus; summary: string };
  quoteDates: string[]; notes: string[];
}

/** Calendar dates are anchored to Shanghai, independent of the host's timezone. */
export function summaryDate(value: number | Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function summaryQuoteDate(value?: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})(?:[ T]|\d{6}|$)/);
  if (!match) return undefined;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : undefined;
}
function number(value: unknown, positive = false): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const input = typeof value === 'string' ? value.trim().replace(/%$/, '') : value;
  if (input === '') return undefined;
  const numeric = Number(input);
  return Number.isFinite(numeric) && (!positive || numeric > 0) ? numeric : undefined;
}
function reportFor(code: string, jobs: readonly ResearchJob[], now: number): { latestReport?: SummaryReport; latestAttempt?: SummaryAttempt } {
  let latestReport: SummaryReport | undefined;
  let latestAttempt: SummaryAttempt | undefined;
  for (const job of jobs) {
    const stock = job.stocks.find(item => item.code.toLowerCase() === code);
    if (!stock && !job.request.stocks.some(item => item.code.toLowerCase() === code)) continue;
    if (!latestAttempt || job.createdAt > latestAttempt.at) latestAttempt = { jobId: job.id, status: job.status, stage: job.stage, at: job.createdAt };
    if (!stock?.report) continue;
    const at = stock.evidence?.capturedAt || job.createdAt;
    const time = Date.parse(at);
    if (!Number.isFinite(time) || time > now || (latestReport && at <= latestReport.at)) continue;
    const ageDays = Math.max(0, Math.floor((Date.parse(summaryDate(now)) - Date.parse(summaryDate(time))) / 86400000));
    latestReport = { jobId: job.id, at, ageDays, old: ageDays >= 7, summary: stock.report.summary.slice(0, 1000),
      partial: job.status !== 'completed' || !!stock.error };
  }
  return { latestReport, latestAttempt };
}
function codeToken(text: string, token: string) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(text);
}

export function buildDailySummary(input: {
  watched: string[]; positions: Position[]; quotes: SummaryQuote[]; jobs: readonly ResearchJob[];
  news: SummaryNewsInput[]; now?: number; researchError?: string;
}): DailySummarySnapshot {
  const now = input.now ?? Date.now();
  const date = summaryDate(now);
  const watched = new Set(input.watched.filter(code => typeof code === 'string').map(code => code.toLowerCase()));
  const positions = input.positions.map(position => ({ ...position, code: position.code.toLowerCase() }));
  const held = new Set(positions.filter(position => !position.isSellOut).map(position => position.code));
  const quotes = new Map(input.quotes.map(quote => [quote.code.toLowerCase(), { ...quote, code: quote.code.toLowerCase() }]));
  const names = new Map(positions.map(position => [position.code, position.name]));
  const codes = Array.from(new Set(Array.from(watched).concat(Array.from(held))));
  const rows: SummaryRow[] = codes.map(code => {
    const quote = quotes.get(code);
    const turnover = numericAmount(quote?.amount);
    const equity = equityCode.test(code);
    return { code, name: quote?.name || names.get(code) || code, watched: watched.has(code), held: held.has(code), equity,
      currency: equity ? currencyOf(code) : 'unknown', price: number(quote?.price, true), percent: number(quote?.percent),
      turnover: turnover !== undefined && turnover >= 0 ? turnover : undefined,
      quoteTime: quote?.time, quoteDate: summaryQuoteDate(quote?.time), industry: quote?.industry,
      ...reportFor(code, input.jobs, now) };
  });
  const quoteRows = Array.from(quotes.values());
  const portfolio = calculatePortfolio(positions, quoteRows, date);
  const exposure = calculateExposure(positions, quoteRows, date);
  const currencies = portfolio.totals.map(total => {
    const related = portfolio.rows.filter(row => row.currency === total.currency && !row.isSellOut);
    const dates = Array.from(new Set(related.map(row => summaryQuoteDate(row.quoteTime)).filter((day): day is string => !!day))).sort();
    const allDated = related.length > 0 && related.every(row => !!summaryQuoteDate(row.quoteTime));
    return { ...total, exposure: exposure.currencies.find(item => item.currency === total.currency), dates,
      dailyLabel: allDated && dates.length === 1 && dates[0] === date ? '今日估算盈亏' : '行情日估算盈亏' };
  });
  const bareCodes = new Map<string, number>();
  rows.forEach(row => {
    const bare = row.code.replace(/^(sh|sz|bj|hk|usr_)/, '');
    bareCodes.set(bare, (bareCodes.get(bare) || 0) + 1);
  });
  const news = new Map<string, SummaryNews>();
  let cached = 0;
  let received = 0;
  for (const raw of input.news.slice(0, 100)) {
    const normalized = normalizeNews(raw.content, raw.source);
    if (!normalized || !Number.isFinite(normalized.time) || normalized.time < 0 || normalized.time > now + 300000) continue;
    cached++;
    if (raw.receivedAt && Number.isFinite(raw.receivedAt) && raw.receivedAt <= now) received = Math.max(received, raw.receivedAt);
    const text = normalized.text.toLowerCase();
    const matches: SummaryNews['matches'] = [];
    for (const row of rows) {
      const bare = row.code.replace(/^(sh|sz|bj|hk|usr_)/, '');
      let reason = '';
      if (row.name !== row.code && row.name.length >= 2 && text.includes(row.name.toLowerCase())) reason = '名称匹配';
      else if (codeToken(text, row.code) || (bare.length >= 3 && bareCodes.get(bare) === 1 && codeToken(text, bare))) reason = '代码匹配';
      else if (row.industry && row.industry.trim().length >= 2 && !['其他', '未知', '综合'].includes(row.industry.trim()) && text.includes(row.industry.toLowerCase())) reason = '行业关键词';
      if (reason) matches.push({ code: row.code, name: row.name, held: row.held, reason });
    }
    if (!matches.length) continue;
    const item = { id: normalized.id, source: normalized.source, text: plainText(normalized.text).slice(0, 1800),
      time: normalized.time, date: normalized.time > 0 ? summaryDate(normalized.time) : undefined, receivedAt: raw.receivedAt, matches };
    // A replayed cache entry cannot move an article's publication time forward.
    if (!news.has(item.id) || news.get(item.id)!.time < item.time) news.set(item.id, item);
  }
  const items = Array.from(news.values()).sort((a, b) => Number(b.matches.some(match => match.held)) - Number(a.matches.some(match => match.held)) || b.time - a.time);
  const reportStocks = new Set(rows.filter(row => row.latestReport).map(row => row.code));
  const relevantJobs = input.jobs.filter(job => job.request.stocks.some(stock => codes.includes(stock.code.toLowerCase())));
  const inspection = relevantJobs.filter(job => job.kind === 'portfolio' && job.report).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const notes = ['涨跌与成交额来自已有行情；成交额榜按币种分别查看，不代表相对历史放量。',
    '相关快讯来自共享缓存最近100条，按名称、代码或行业关键词关联，不表示影响已确认；空列表不代表没有新闻。',
    '摘要使用上海日期，各市场行情日期可能不同；休市时保留最近行情，不将采集时间当作交易时间。'];
  if (input.researchError) notes.push(input.researchError);
  const missing = rows.filter(row => row.price === undefined).length;
  return { date, generatedAt: new Date(now).toISOString(), rows, currencies,
    counts: { watched: watched.size, held: held.size, quoted: rows.length - missing, missing,
      moving: rows.filter(row => row.percent !== undefined && Math.abs(row.percent) >= 3).length,
      researched: reportStocks.size, activeResearch: relevantJobs.filter(job => researchActive(job.status)).length },
    quoteDates: Array.from(new Set(rows.map(row => row.quoteDate).filter((day): day is string => !!day))).sort(),
    news: { items, cached, matched: items.length, today: items.filter(item => item.date === date).length,
      updatedAt: received ? new Date(received).toISOString() : undefined },
    latestInspection: inspection ? { jobId: inspection.id, at: inspection.createdAt, status: inspection.status, summary: inspection.report!.summary.slice(0, 1000) } : undefined,
    notes };
}
