export const marketMoney = (value?: number) => value === undefined ? '—' : Math.abs(value) >= 1e8 ? (value / 1e8).toFixed(2) + '亿' : Math.abs(value) >= 1e4 ? (value / 1e4).toFixed(2) + '万' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
export const marketPercent = (value?: number) => value === undefined ? '—' : (value > 0 ? '+' : '') + value.toFixed(2) + '%';
export const marketDate = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '来源未提供';
export const marketColor = (value?: number) => value === undefined ? 'var(--vscode-descriptionForeground, #777)' : value > 0 ? '#cf4148' : value < 0 ? '#21936f' : '#707780';

export interface MapTile { id: string; name: string; weight: number; percent?: number }
export interface TileRect extends MapTile { x: number; y: number; width: number; height: number }
/** Binary weighted treemap; no invented equal-size rectangles for missing capitalization. */
export function layoutMarketMap(values: MapTile[], width: number, height: number): TileRect[] {
  const items = values.filter(item => Number.isFinite(item.weight) && item.weight > 0).slice().sort((a, b) => b.weight - a.weight);
  if (!items.length || width <= 0 || height <= 0) return [];
  const max = items[0].weight; const result: TileRect[] = [];
  const split = (rows: MapTile[], x: number, y: number, w: number, h: number, depth: number) => {
    if (!rows.length) return;
    if (rows.length === 1) { result.push({ ...rows[0], x, y, width: w, height: h }); return; }
    const total = rows.reduce((sum, item) => sum + item.weight / max, 0);
    let at = 1; let left = rows[0].weight / max;
    while (at < rows.length - 1 && left + rows[at].weight / max / 2 < total / 2) { left += rows[at].weight / max; at++; }
    if (depth > 32) { at = Math.floor(rows.length / 2); left = rows.slice(0, at).reduce((sum, item) => sum + item.weight / max, 0); }
    const ratio = total > 0 ? left / total : at / rows.length;
    if (w >= h) { split(rows.slice(0, at), x, y, w * ratio, h, depth + 1); split(rows.slice(at), x + w * ratio, y, w * (1 - ratio), h, depth + 1); }
    else { split(rows.slice(0, at), x, y, w, h * ratio, depth + 1); split(rows.slice(at), x, y + h * ratio, w, h * (1 - ratio), depth + 1); }
  };
  split(items, 0, 0, width, height, 0); return result;
}
