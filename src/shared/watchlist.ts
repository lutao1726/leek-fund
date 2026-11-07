/** Persisted watchlist data. Independent of VS Code so migrations can be tested. */
export interface StockGroup {
  id: string;
  name: string;
  codes: string[];
}

export interface StockGroups {
  version: 1;
  groups: StockGroup[];
}

export const DEFAULT_GROUP = 'default';

export function normalizeGroups(value: unknown, stocks: string[]): StockGroups {
  const codes = Array.from(new Set(stocks));
  const allowed = new Set(codes);
  const used = new Set<string>();
  const ids = new Set<string>();
  const raw = value as Partial<StockGroups> | undefined;
  const groups: StockGroup[] = [];
  if (raw && raw.version === 1 && Array.isArray(raw.groups)) {
    for (const group of raw.groups) {
      if (!group || typeof group.id !== 'string' || !group.id || ids.has(group.id) ||
          typeof group.name !== 'string' || !group.name.trim() || !Array.isArray(group.codes)) continue;
      ids.add(group.id);
      groups.push({ id: group.id, name: group.name.trim(), codes: group.codes.filter(code => {
        if (!allowed.has(code) || used.has(code)) return false;
        used.add(code);
        return true;
      }) });
    }
  }
  let fallback = groups.find(group => group.id === DEFAULT_GROUP);
  if (!fallback) {
    fallback = { id: DEFAULT_GROUP, name: '默认分组', codes: [] };
    groups.unshift(fallback);
  }
  fallback.codes.push(...codes.filter(code => !used.has(code)));
  return { version: 1, groups };
}

export function moveStocks(book: StockGroups, codes: string[], targetId: string, before?: string): StockGroups {
  if (!book.groups.some(group => group.id === targetId)) throw new Error('目标分组不存在');
  const moving = Array.from(new Set(codes));
  const existing = new Set(book.groups.reduce<string[]>((all, group) => all.concat(group.codes), []));
  if (moving.some(code => !existing.has(code))) throw new Error('自选已变更，请刷新后重试');
  if (before && moving.includes(before)) return book;
  const groups = book.groups.map(group => ({ ...group, codes: group.codes.filter(code => !moving.includes(code)) }));
  const target = groups.find(group => group.id === targetId)!;
  const index = before ? target.codes.indexOf(before) : -1;
  target.codes.splice(index < 0 ? target.codes.length : index, 0, ...moving);
  return { version: 1, groups };
}

export function deleteGroup(book: StockGroups, id: string): StockGroups {
  if (id === DEFAULT_GROUP) throw new Error('默认分组不能删除');
  const removed = book.groups.find(group => group.id === id);
  if (!removed) return book;
  return { version: 1, groups: book.groups.filter(group => group.id !== id).map(group =>
    group.id === DEFAULT_GROUP ? { ...group, codes: [...group.codes, ...removed.codes] } : group) };
}

/** Display strings may contain 万/亿; unknown values always sort last. */
export function numericAmount(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const match = value.replace(/,/g, '').trim().match(/^(-?\d+(?:\.\d+)?)(万|亿)?$/);
  if (!match) return undefined;
  return Number(match[1]) * (match[2] === '亿' ? 1e8 : match[2] === '万' ? 1e4 : 1);
}

export function sortQuotes<T extends { info: { percent?: unknown; amount?: unknown } }>(items: T[], order: number): T[] {
  if (![1, -1, 3, -3].includes(order)) return items.slice();
  const amount = Math.abs(order) === 3;
  return items.slice().sort((a, b) => {
    const av = numericAmount(amount ? a.info.amount : a.info.percent);
    const bv = numericAmount(amount ? b.info.amount : b.info.percent);
    if (av === undefined) return bv === undefined ? 0 : 1;
    if (bv === undefined) return -1;
    return (av - bv) * (order > 0 ? 1 : -1);
  });
}
