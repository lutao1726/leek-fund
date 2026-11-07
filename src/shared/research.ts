import { calculatePortfolio, Currency, Position, Quote } from './portfolio';

export type ResearchStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted';
export interface ResearchBody {
  summary: string;
  support: string[];
  counter: string[];
  conditions: string[];
  invalidation: string[];
  limitations: string[];
}
export interface ResearchQuote extends Quote { industry?: string }
export interface ResearchSource {
  id: string;
  title: string;
  url?: string;
  asOf?: string;
  fetchedAt: string;
  status: 'available' | 'missing';
  content: string;
}
export interface StockEvidence {
  code: string;
  name: string;
  capturedAt: string;
  quote?: ResearchQuote;
  sources: ResearchSource[];
  limitations: string[];
}
export interface CurrencyExposure {
  currency: Currency;
  count: number;
  quotedCount: number;
  marketValue: number;
  complete: boolean;
  largestPercent?: number;
  topThreePercent?: number;
  industries: { name: string; percent: number }[];
}
export interface PortfolioExposure {
  currencies: CurrencyExposure[];
  missingQuotes: string[];
  unclassified: string[];
  notes: string[];
}
export interface StockResearch {
  code: string;
  name: string;
  evidence?: StockEvidence;
  report?: ResearchBody;
  error?: string;
}
export interface ResearchUsage {
  model: string;
  at: string;
  input?: number;
  output?: number;
  estimatedInput?: number;
  estimatedOutput?: number;
}
export interface ResearchJob {
  version: 1;
  id: string;
  kind: 'stock' | 'portfolio';
  title: string;
  status: ResearchStatus;
  stage: string;
  completed: number;
  total: number;
  createdAt: string;
  finishedAt?: string;
  model: string;
  range: string;
  request: { stocks: { code: string; name: string }[]; positions?: Position[]; quotes: ResearchQuote[] };
  stocks: StockResearch[];
  report?: ResearchBody;
  exposure?: PortfolioExposure;
  usage: ResearchUsage[];
  error?: string;
}
export type ResearchSummary = Omit<ResearchJob, 'request' | 'stocks' | 'report' | 'exposure'>;
export interface ResearchState { jobs: ResearchSummary[]; storageError?: string }
export const researchActive = (status: ResearchStatus) => status === 'queued' || status === 'running';

export function summarizeJob(job: ResearchJob): ResearchSummary {
  const { request, stocks, report, exposure, ...summary } = job;
  return summary;
}

/** Treat model output as data. A malformed report must never look like successful research. */
export function parseResearchBody(text: string): ResearchBody {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let body: any;
  try { body = JSON.parse(clean); } catch { throw new Error('模型未返回有效 JSON 报告，请重试或更换模型'); }
  if (!body || typeof body.summary !== 'string' || !body.summary.trim() || body.summary.length > 4000) {
    throw new Error('模型报告缺少有效的核心判断');
  }
  const result: ResearchBody = { summary: body.summary.trim(), support: [], counter: [], conditions: [], invalidation: [], limitations: [] };
  for (const key of ['support', 'counter', 'conditions', 'invalidation', 'limitations'] as const) {
    if (!Array.isArray(body[key]) || !body[key].length || body[key].length > 20 ||
      body[key].some((item: unknown) => typeof item !== 'string' || !item.trim() || item.length > 2000)) {
      throw new Error(`模型报告栏目 ${key} 格式不完整，请重试`);
    }
    result[key] = body[key].map((item: string) => item.trim());
  }
  return result;
}

export function calculateExposure(positions: Position[], quotes: ResearchQuote[], today: string): PortfolioExposure {
  const active = positions.filter(position => !position.isSellOut);
  const { rows, totals } = calculatePortfolio(active, quotes, today);
  const quoteMap = new Map(quotes.map(quote => [quote.code, quote]));
  const currencies = totals.map(total => {
    const items = rows.filter(row => row.currency === total.currency);
    const complete = total.missingQuotes === 0 && Number.isFinite(total.marketValue) && total.marketValue > 0;
    const values = items.map(row => row.marketValue || 0).sort((a, b) => b - a);
    const sectors = new Map<string, number>();
    items.forEach(row => {
      const name = quoteMap.get(row.code)?.industry?.trim() || '行业未知';
      sectors.set(name, (sectors.get(name) || 0) + (row.marketValue || 0));
    });
    return { currency: total.currency, count: items.length, quotedCount: items.length - total.missingQuotes,
      marketValue: total.marketValue, complete,
      largestPercent: complete ? values[0] / total.marketValue * 100 : undefined,
      topThreePercent: complete ? values.slice(0, 3).reduce((sum, value) => sum + value, 0) / total.marketValue * 100 : undefined,
      industries: complete ? Array.from(sectors, ([name, value]) => ({ name, percent: value / total.marketValue * 100 })).sort((a, b) => b.percent - a.percent) : [] };
  });
  return { currencies, missingQuotes: rows.filter(row => row.marketValue === undefined).map(row => row.code),
    unclassified: active.filter(row => !quoteMap.get(row.code)?.industry?.trim()).map(row => row.code),
    notes: ['占比仅指同币种股票持仓市值占比，不含现金，不代表全账户仓位。',
      '不同币种分别统计；缺少报价时不计算集中度，不将缺失风险视为零。',
      '行业来自行情字段；未接入完整题材映射与相关性测算，不能据此认定持仓已经充分分散。'] };
}

export function researchMarkdown(job: ResearchJob): string {
  const body = (report: ResearchBody) => [report.summary, ...([
    ['支持依据', report.support], ['反对依据', report.counter], ['后续观察条件', report.conditions],
    ['判断失效条件', report.invalidation], ['数据缺口与限制', report.limitations],
  ] as [string, string[]][]).map(([title, items]) => `### ${title}\n${items.map(item => `- ${item}`).join('\n')}`)].join('\n\n');
  return [`# ${job.title}`, `生成时间：${job.createdAt} · 模型：${job.model} · 状态：${job.status}`,
    job.report ? body(job.report) : '', ...job.stocks.map(stock => [
      `## ${stock.name} ${stock.code}`, stock.report ? body(stock.report) : stock.error || '尚未完成',
      ...(stock.evidence?.sources || []).map(source => `- [${source.id}] ${source.title} · ${source.status === 'available' ? '可用' : '缺失'} · 数据时间 ${source.asOf || '未提供'} · 采集时间 ${source.fetchedAt}${source.url ? ` · ${source.url}` : ''}`),
    ].join('\n\n'))].filter(Boolean).join('\n\n');
}
