import type { DailySummarySnapshot, SummaryNews, SummaryRow } from '../../../../src/shared/dailySummary';

export function filterSummaryRows(rows: SummaryRow[], options: { scope: string; search: string; sort: string; currency: string; moving: boolean }) {
  const search = options.search.trim().toLowerCase();
  return rows.filter(row => (options.scope !== 'held' || row.held) && (options.scope !== 'watched' || row.watched) &&
    (!search || `${row.code} ${row.name} ${row.industry || ''}`.toLowerCase().includes(search)) &&
    (!options.moving || (row.percent !== undefined && Math.abs(row.percent) >= 3)) &&
    (options.sort !== 'turnover' || row.currency === options.currency)).sort((a, b) => {
      const value = (row: SummaryRow) => options.sort === 'turnover' ? row.turnover : options.sort === 'absolute' && row.percent !== undefined ? Math.abs(row.percent) : row.percent;
      const left = value(a), right = value(b);
      if (left === undefined) return right === undefined ? a.code.localeCompare(b.code) : 1;
      if (right === undefined) return -1;
      return (options.sort === 'down' ? left - right : right - left) || a.code.localeCompare(b.code);
    });
}
export function filterSummaryNews(snapshot: DailySummarySnapshot, scope: string, heldOnly: boolean): SummaryNews[] {
  const day = Date.parse(snapshot.date);
  return snapshot.news.items.filter(item => (!heldOnly || item.matches.some(match => match.held)) &&
    (scope === 'all' || (item.date && (scope === 'today' ? item.date === snapshot.date : day - Date.parse(item.date) >= 0 && day - Date.parse(item.date) < 3 * 86400000))));
}
