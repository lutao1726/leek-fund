/** Stock ledger uses the existing stockPrice setting as its single source of truth. */
export type Currency = 'CNY' | 'HKD' | 'USD';
export interface Position {
  code: string;
  name: string;
  amount: number;
  unitPrice: number;
  todayUnitPrice?: number;
  isSellOut?: boolean;
  priceDate?: string;
}
export type PositionMap = Record<string, Omit<Position, 'code'>>;
export interface Quote {
  code: string;
  name: string;
  price?: string | number;
  yestclose?: string | number;
  time?: string;
}
export interface PositionRow extends Position {
  currency: Currency;
  price?: number;
  quoteTime?: string;
  cost: number;
  marketValue?: number;
  profit?: number;
  profitPercent?: number;
  todayProfit?: number;
}
export interface PortfolioTotal {
  currency: Currency;
  cost: number;
  marketValue: number;
  profit: number;
  todayProfit: number;
  missingQuotes: number;
  missingDailyQuotes: number;
}

export const equityCode = /^(?:(?:sh|sz|bj)\d{6}|hk\d{5}|usr_[a-z0-9._-]+)$/i;

export function currencyOf(code: string): Currency {
  return /^hk/i.test(code) ? 'HKD' : /^usr_/i.test(code) ? 'USD' : 'CNY';
}

function positive(value: unknown): number | undefined {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

export function validatePosition(input: unknown): Position {
  if (!input || typeof input !== 'object') throw new Error('持仓格式不正确');
  const row = input as Position;
  if (typeof row.code !== 'string' || !equityCode.test(row.code)) throw new Error('请输入带市场前缀的股票代码，如 sh600519、hk00700、usr_aapl');
  if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 100) throw new Error('请输入股票名称（最多100字符）');
  if (positive(row.amount) === undefined || positive(row.unitPrice) === undefined) throw new Error('数量和成本价必须是大于 0 的有限数值');
  if (!Number.isFinite(Number(row.amount) * Number(row.unitPrice))) throw new Error('持仓金额超出可计算范围');
  if (row.isSellOut !== undefined && typeof row.isSellOut !== 'boolean') throw new Error('清仓状态必须为布尔值');
  if (row.todayUnitPrice !== undefined && row.todayUnitPrice !== 0 && positive(row.todayUnitPrice) === undefined) throw new Error('当日成交价必须大于 0');
  if (row.priceDate !== undefined && (typeof row.priceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.priceDate))) throw new Error('日期格式须为 YYYY-MM-DD');
  return {
    code: row.code, name: row.name.trim(), amount: Number(row.amount), unitPrice: Number(row.unitPrice),
    todayUnitPrice: row.todayUnitPrice ? Number(row.todayUnitPrice) : undefined,
    isSellOut: row.isSellOut === true, priceDate: row.priceDate,
  };
}

/** Legacy entries with no position are placeholders, and are intentionally ignored. */
export function readPositions(value: unknown): Position[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const rows: Position[] = [];
  for (const [code, data] of Object.entries(value as Record<string, unknown>)) {
    try {
      const raw = data as Record<string, unknown>;
      const priceDate = typeof raw.priceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.priceDate) ? raw.priceDate : undefined;
      rows.push(validatePosition({ ...raw, code, priceDate }));
    } catch { /* Invalid legacy entries remain in settings, but do not enter totals. */ }
  }
  return rows;
}

export function calculatePortfolio(positions: Position[], quotes: Quote[], today: string) {
  const quoteMap = new Map(quotes.map(quote => [quote.code, quote]));
  const rows: PositionRow[] = positions.map(position => {
    const quote = quoteMap.get(position.code);
    const price = positive(quote?.price);
    const previous = positive(quote?.yestclose);
    const dayPrice = position.priceDate === today ? positive(position.todayUnitPrice) : undefined;
    const closed = position.isSellOut === true;
    const cost = closed ? 0 : position.amount * position.unitPrice;
    const marketValue = closed ? 0 : price === undefined ? undefined : position.amount * price;
    const profit = closed ? 0 : marketValue === undefined ? undefined : marketValue - cost;
    const todayProfit = closed
      ? position.priceDate === today ? dayPrice !== undefined && previous !== undefined ? position.amount * (dayPrice - previous) : undefined : 0
      : price !== undefined && (dayPrice !== undefined || previous !== undefined)
        ? position.amount * (price - (dayPrice ?? previous!)) : undefined;
    return { ...position, currency: currencyOf(position.code), price, quoteTime: quote?.time,
      cost, marketValue, profit, todayProfit, profitPercent: profit === undefined || !cost ? undefined : profit / cost * 100 };
  });
  const totals: PortfolioTotal[] = (['CNY', 'HKD', 'USD'] as Currency[]).filter(currency => rows.some(row => row.currency === currency)).map(currency => {
    const items = rows.filter(row => row.currency === currency);
    return { currency, cost: items.reduce((sum, row) => sum + row.cost, 0),
      marketValue: items.reduce((sum, row) => sum + (row.marketValue ?? 0), 0),
      profit: items.reduce((sum, row) => sum + (row.profit ?? 0), 0),
      todayProfit: items.reduce((sum, row) => sum + (row.todayProfit ?? 0), 0),
      missingQuotes: items.filter(row => !row.isSellOut && row.marketValue === undefined).length,
      missingDailyQuotes: items.filter(row => row.todayProfit === undefined).length };
  });
  return { rows, totals };
}

export function addPosition(position: Position, amount: number, price: number): Position {
  if (positive(amount) === undefined || positive(price) === undefined) throw new Error('加仓数量和价格必须大于 0');
  if (position.isSellOut) throw new Error('清仓持仓请通过编辑重新建仓');
  const total = position.amount + amount;
  // A simple cost ledger has no intraday lot history. Clear the intraday override.
  return validatePosition({ ...position, amount: total, unitPrice: (position.amount * position.unitPrice + amount * price) / total, todayUnitPrice: undefined, priceDate: undefined });
}

export function importPortfolio(input: unknown): Position[] {
  const file = input as { version?: number; positions?: unknown[] };
  if (!file || file.version !== 1 || !Array.isArray(file.positions) || file.positions.length > 10000) throw new Error('请选择 version=1 的持仓账本 JSON');
  const positions = file.positions.map(validatePosition);
  if (new Set(positions.map(position => position.code.toLowerCase())).size !== positions.length) throw new Error('账本包含重复股票代码');
  return positions;
}
