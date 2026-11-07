export type BoardKind = 'industry' | 'concept';
export type StockScope = 'all' | 'star' | 'chinext';
export interface MarketStock {
  code: string; name: string; price?: number; percent?: number; turnover?: number;
  marketCap?: number; netInflow?: number; turnoverRate?: number; quoteTime?: string;
}
export interface SectorBoard {
  code: string; name: string; kind: BoardKind; price?: number; percent?: number;
  turnoverRate?: number; marketCap?: number; netInflow?: number; speed?: number;
  rising?: number; falling?: number; leader?: string; quoteTime?: string;
}
export interface MarketPage<T> { items: T[]; total: number; page: number; pageSize: number; partial?: boolean }
export interface MarketResult<T> { data: T; fetchedAt: string; asOf?: string; stale: boolean; error?: string }
export interface BoardOverview { industry: SectorBoard[]; concept: SectorBoard[]; errors: string[]; partial: boolean }
export interface StockProfile {
  code: string; name: string; company?: string; description?: string; mainBusiness?: string;
  industry?: string; concepts: string[]; quote?: MarketStock; errors: string[];
}
export const CHANGE_TYPES: Record<number, { name: string; direction: 'up' | 'down' }> = {
  8201: { name: '火箭发射', direction: 'up' }, 8202: { name: '快速反弹', direction: 'up' },
  8193: { name: '大笔买入', direction: 'up' }, 4: { name: '封涨停板', direction: 'up' },
  32: { name: '打开跌停板', direction: 'up' }, 64: { name: '有大买盘', direction: 'up' },
  8207: { name: '竞价上涨', direction: 'up' }, 8209: { name: '高开5日线', direction: 'up' },
  8211: { name: '向上缺口', direction: 'up' }, 8213: { name: '60日新高', direction: 'up' },
  8215: { name: '60日大幅上涨', direction: 'up' }, 8204: { name: '加速下跌', direction: 'down' },
  8203: { name: '高台跳水', direction: 'down' }, 8194: { name: '大笔卖出', direction: 'down' },
  8: { name: '封跌停板', direction: 'down' }, 16: { name: '打开涨停板', direction: 'down' },
  128: { name: '有大卖盘', direction: 'down' }, 8208: { name: '竞价下跌', direction: 'down' },
  8210: { name: '低开5日线', direction: 'down' }, 8212: { name: '向下缺口', direction: 'down' },
  8214: { name: '60日新低', direction: 'down' }, 8216: { name: '60日大幅下跌', direction: 'down' },
};
export interface StockChange { id: string; code: string; name: string; type: number; label: string; direction: 'up' | 'down'; time: string; date?: string }

export function marketNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
export function marketTime(value: unknown): string | undefined {
  const number = marketNumber(value);
  if (!number || number < 1e9 || number > 1e11) return undefined;
  return new Date(number * 1000).toISOString();
}
export function assertBoard(value: unknown): string {
  if (typeof value !== 'string' || !/^BK\d{4}$/.test(value)) throw new Error('板块代码须为 BK 加 4 位数字');
  return value;
}
export function assertStock(value: unknown): string {
  if (typeof value !== 'string' || !/^(sh|sz|bj)\d{6}$/.test(value)) throw new Error('请选择有效 A 股代码');
  return value;
}
export function stockCode(value: unknown, market: unknown): string | undefined {
  const code = String(value ?? '');
  if (!/^\d{6}$/.test(code)) return undefined;
  if (marketNumber(market) === 1) return 'sh' + code;
  if (marketNumber(market) === 0) return (/^(4|8|92)/.test(code) ? 'bj' : 'sz') + code;
  return undefined;
}
export function parseStock(raw: any): MarketStock | undefined {
  const code = stockCode(raw?.f12, raw?.f13);
  if (!code || typeof raw.f14 !== 'string' || !raw.f14.trim()) return undefined;
  return { code, name: raw.f14, price: marketNumber(raw.f2), percent: marketNumber(raw.f3), turnover: marketNumber(raw.f6),
    marketCap: marketNumber(raw.f20), netInflow: marketNumber(raw.f62), turnoverRate: marketNumber(raw.f8), quoteTime: marketTime(raw.f124) };
}
export function parseBoard(raw: any, kind: BoardKind): SectorBoard | undefined {
  if (!raw || !/^BK\d{4}$/.test(raw.f12) || typeof raw.f14 !== 'string' || !raw.f14.trim()) return undefined;
  return { code: raw.f12, name: raw.f14, kind, price: marketNumber(raw.f2), percent: marketNumber(raw.f3),
    turnoverRate: marketNumber(raw.f8), marketCap: marketNumber(raw.f20), netInflow: marketNumber(raw.f62), speed: marketNumber(raw.f22),
    rising: marketNumber(raw.f104), falling: marketNumber(raw.f105), leader: typeof raw.f128 === 'string' && raw.f128 !== '-' ? raw.f128 : undefined,
    quoteTime: marketTime(raw.f124) };
}
export function vendorRows(raw: any): { rows: any[]; total: number } {
  if (raw?.rc !== 0 || !raw.data) throw new Error('行情源返回异常');
  const total = marketNumber(raw.data.total);
  if (total === undefined || total < 0 || !Number.isInteger(total)) throw new Error('行情分页总数异常');
  const diff = raw.data.diff;
  if (total === 0 && (diff === null || diff === undefined)) return { rows: [], total };
  const rows = Array.isArray(diff) ? diff : diff && typeof diff === 'object' ? Object.values(diff) : undefined;
  if (!rows) throw new Error('行情列表格式异常');
  if (total > 0 && rows.length === 0) throw new Error('行情列表不完整，请稍后重试');
  return { rows, total };
}
export function parseChanges(raw: any, page: number): MarketPage<StockChange> {
  if (raw?.rc === 0 && raw.data?.tc === 0 && (raw.data.allstock === null || raw.data.allstock === undefined)) return { items: [], total: 0, page, pageSize: 100 };
  if (raw?.rc !== 0 || !raw.data || !Number.isInteger(raw.data.tc) || raw.data.tc < 0 || !Array.isArray(raw.data.allstock)) throw new Error('异动数据格式异常');
  const dateValue = String(raw.data.date ?? raw.data.dt ?? '');
  const date = /^\d{8}$/.test(dateValue) ? dateValue.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue : undefined;
  const items: StockChange[] = []; const seen = new Set<string>();
  for (const row of raw.data.allstock) {
    if (!row || typeof row !== 'object') continue;
    const code = stockCode(row.c, row.m); const type = CHANGE_TYPES[row.t];
    const tm = String(row.tm).padStart(6, '0');
    if (!code || !type || !/^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(tm) || typeof row.n !== 'string') continue;
    const time = `${tm.slice(0, 2)}:${tm.slice(2, 4)}:${tm.slice(4, 6)}`;
    const id = `${date || 'undated'}:${code}:${row.t}:${time}:${String(row.i ?? '')}`;
    if (seen.has(id)) continue;
    seen.add(id); items.push({ id, code, name: row.n, type: Number(row.t), label: type.name, direction: type.direction, time, date });
  }
  if (raw.data.allstock.length && !items.length) throw new Error('异动记录无法识别');
  return { items, total: raw.data.tc, page, pageSize: 100, partial: items.length < raw.data.allstock.length };
}
