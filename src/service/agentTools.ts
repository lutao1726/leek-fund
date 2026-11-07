import StockService from '../explorer/stockService';
import { AgentToolName } from '../shared/agent';
import { equityCode } from '../shared/portfolio';
import { calculateExposure } from '../shared/research';
import { LeekFundConfig } from '../shared/leekConfig';
import { portfolio } from './portfolio';
import { marketData } from './marketData';
import { ResearchData, throwIfCancelled } from './researchData';
import { AgentToolDefinition } from './agentModels';

const parameters = (properties: object = {}) => ({ type: 'object', properties, additionalProperties: false });
const codeProperty = { code: { type: 'string', description: '完整股票代码，如 sh600519、sz000001、bj920085、hk00700、usr_aapl；板块使用 BK0475' } };
export const agentToolDefinitions: AgentToolDefinition[] = [
  { name: 'watchlist', description: '读取本机自选与已缓存行情，含原始报价时间；不是实时重新报价。', parameters: parameters() },
  { name: 'portfolio', description: '读取未清仓持仓与分币种市值和集中度；缺报价不伪造。', parameters: parameters() },
  { name: 'quote', description: '按完整代码读取个股报价及 A 股公司资料。', parameters: parameters(codeProperty) },
  { name: 'history', description: '按完整股票代码读取近三个月日线，包含来源与最近交易日。', parameters: parameters(codeProperty) },
  { name: 'news', description: '近期选股宝快讯样本，最多30条，可能为缓存；不代表全部公告。', parameters: parameters() },
  { name: 'sectors', description: '行业与概念涨跌、净流入排名，各取前十；成分可能重叠。', parameters: parameters() },
  { name: 'board', description: '读取 BK 板块报价和前100只按涨幅排列的成分股。', parameters: parameters(codeProperty) },
  { name: 'changes', description: '读取最近100条个股异动；源可能没有交易日期。', parameters: parameters() },
];
export class AgentTools {
  private data = new ResearchData();
  constructor(private stocks: StockService) {}
  private quotes() { return this.stocks.stockList.map(item => ({ code: item.info.code, name: item.info.name, price: item.info.price, yestclose: item.info.yestclose, percent: item.info.percent, time: item.info.time, industry: item.info.industry })); }
  codeFrom(prompt: string): string | undefined {
    const board = /\bBK\d{4}\b/.exec(prompt)?.[0]; if (board) return board;
    const full = /\b(?:sh\d{6}|sz\d{6}|bj\d{6}|hk\d{5}|usr_[a-z][a-z0-9._-]{0,15})\b/i.exec(prompt)?.[0].toLowerCase();
    if (full) return full;
    const digits = /\b\d{6}\b/.exec(prompt)?.[0];
    if (digits) return (/^6/.test(digits) ? 'sh' : /^(0|3)/.test(digits) ? 'sz' : /^(4|8|92)/.test(digits) ? 'bj' : '') + digits;
    const names = this.quotes().filter(quote => quote.name && prompt.includes(quote.name));
    return names.length === 1 ? names[0].code : undefined;
  }
  async execute(name: AgentToolName, input: unknown, signal: AbortSignal): Promise<unknown> {
    throwIfCancelled(signal);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'code')) throw new Error('工具参数格式不正确');
    const code = (input as { code?: string }).code;
    if (['quote', 'history', 'board'].includes(name) && (typeof code !== 'string' || code.length > 30)) throw new Error('请提供完整股票或板块代码');
    const capturedAt = new Date().toISOString(); const quotes = this.quotes();
    switch (name) {
      case 'watchlist': {
        const codes: string[] = LeekFundConfig.getConfig('leek-fund.stocks', []);
        return { capturedAt, source: '本机自选与行情缓存', total: codes.length, items: codes.slice(0, 100).map(code => quotes.find(quote => quote.code === code) || { code, missingQuote: true }), truncated: codes.length > 100 };
      }
      case 'portfolio': {
        const positions = portfolio.read().filter(item => !item.isSellOut);
        if (positions.length > 100) throw new Error('持仓超过100只，请使用资产页查看完整数据');
        return { capturedAt, source: '本机成本账本与缓存行情', positions, quotes: quotes.filter(quote => positions.some(item => item.code === quote.code)), exposure: calculateExposure(positions, quotes, new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })) };
      }
      case 'quote': {
        if (!equityCode.test(code!)) throw new Error('股票代码不正确');
        if (/^(sh|sz|bj)\d{6}$/.test(code!)) return marketData.profile(code!, signal);
        const quote = quotes.find(item => item.code === code);
        if (!quote) throw new Error('本机尚无该港美股报价，请先加入自选并刷新');
        return { capturedAt, source: '插件行情缓存', quote };
      }
      case 'history': if (!equityCode.test(code!)) throw new Error('股票代码不正确'); return this.data.history(code!, '3m', signal);
      case 'news': {
        const news = await this.data.news(signal);
        return { source: '选股宝最近100条中的前30条；缓存可能过期', fetchedAt: news.fetchedAt, stale: !news.available,
          items: news.items.slice(0, 30).map(item => ({ title: String(item.title || '').slice(0, 500), summary: String(item.summary || '').replace(/<[^>]*>/g, '').slice(0, 600), publishedAt: item.created_at, url: item.id ? `https://xuangubao.cn/article/${encodeURIComponent(item.id)}` : undefined })) };
      }
      case 'sectors': {
        const overview = await marketData.overview(signal);
        const rank = (items: typeof overview.data.industry) => ({ rising: items.filter(item => item.percent !== undefined).sort((a, b) => b.percent! - a.percent!).slice(0, 10), falling: items.filter(item => item.percent !== undefined).sort((a, b) => a.percent! - b.percent!).slice(0, 10), inflow: items.filter(item => item.netInflow !== undefined).sort((a, b) => b.netInflow! - a.netInflow!).slice(0, 10) });
        return { ...overview, data: { industry: rank(overview.data.industry), concept: rank(overview.data.concept), errors: overview.data.errors, partial: overview.data.partial }, source: '东方财富板块行情；仅展示各排名前十，成分可重叠' };
      }
      case 'board': return { quote: await marketData.boardQuote(code!, signal), constituents: await marketData.members(code!, 1, signal), source: '东方财富；仅成分股第一页' };
      case 'changes': return marketData.changes('all', undefined, 1, signal);
      default: throw new Error('不支持的只读工具');
    }
  }
}
