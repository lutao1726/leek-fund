export interface DisplayPreferences {
  hideStatusBar: boolean;
  hideStatusBarStock: boolean;
  hideStatusBarIcon: boolean;
  statusBarStock: string[];
  statusBarFormat: string;
  statusBarProfitFormat: string;
  riseColor: string;
  fallColor: string;
  iconType: string;
  showEarnings: boolean;
  stockHeldTipShow: boolean;
  stockRemindSwitch: boolean;
  bossMode: boolean;
  newsPanelEnabled: boolean;
  sidebarStockEnabled: boolean;
  sidebarNewsEnabled: boolean;
  sidebarBinanceEnabled: boolean;
  sidebarForexEnabled: boolean;
  sidebarSettingsEnabled: boolean;
  sidebarAgentEnabled: boolean;
  blameEnabled: boolean;
  blameOnlyHoldings: boolean;
  blameAuthor: string;
  blameRotateSeconds: number;
  blameCodeLensCount: number;
}

export const DISPLAY_DEFAULTS: DisplayPreferences = {
  hideStatusBar: false, hideStatusBarStock: false, hideStatusBarIcon: false,
  statusBarStock: ['sh000001'], statusBarFormat: '「${name}」${price} ${icon}（${percent}）',
  statusBarProfitFormat: '${currency} ${profit} | ${todayProfit}', riseColor: 'white', fallColor: '#C9AD06',
  iconType: 'arrow', showEarnings: true, stockHeldTipShow: false, stockRemindSwitch: true,
  bossMode: false, newsPanelEnabled: true, blameEnabled: false, blameOnlyHoldings: true,
  sidebarStockEnabled: true, sidebarNewsEnabled: true, sidebarBinanceEnabled: true,
  sidebarForexEnabled: true, sidebarSettingsEnabled: true, sidebarAgentEnabled: true,
  blameAuthor: 'You', blameRotateSeconds: 10, blameCodeLensCount: 3,
};

export function validatePreferences(input: unknown): DisplayPreferences {
  if (!input || typeof input !== 'object') throw new Error('设置格式不正确');
  const data = input as DisplayPreferences;
  const result = { ...DISPLAY_DEFAULTS };
  for (const key of Object.keys(DISPLAY_DEFAULTS) as (keyof DisplayPreferences)[]) {
    if (typeof DISPLAY_DEFAULTS[key] === 'boolean') {
      if (typeof data[key] !== 'boolean') throw new Error(`设置项 ${key} 必须为开关值`);
      (result as any)[key] = data[key];
    }
  }
  if (!Array.isArray(data.statusBarStock) || data.statusBarStock.length > 8 || data.statusBarStock.some(code => typeof code !== 'string' || !/^[a-zA-Z0-9_.]+$/.test(code))) throw new Error('状态栏最多选择 8 个有效标的');
  result.statusBarStock = Array.from(new Set(data.statusBarStock));
  for (const key of ['statusBarFormat', 'statusBarProfitFormat', 'blameAuthor'] as const) {
    const value = data[key];
    if (typeof value !== 'string' || !value.trim() || value.length > (key === 'blameAuthor' ? 40 : 250) || /[\r\n]/.test(value)) throw new Error('显示模板和作者名须为单行文本，长度不超过限制');
    result[key] = value;
  }
  for (const key of ['riseColor', 'fallColor'] as const) {
    if (typeof data[key] !== 'string' || !/^(#[\da-f]{3,4}|#[\da-f]{6}(?:[\da-f]{2})?|red|green|white|black|yellow|blue|gray|grey|orange)$/i.test(data[key])) throw new Error('颜色须为常用颜色名或十六进制色值');
    result[key] = data[key];
  }
  if (!['arrow', 'arrow1', 'food1', 'food2', 'food3', 'iconfood', 'none'].includes(data.iconType)) throw new Error('不支持的涨跌图标');
  result.iconType = data.iconType;
  if (!Number.isInteger(data.blameRotateSeconds) || data.blameRotateSeconds < 3 || data.blameRotateSeconds > 300) throw new Error('轮播间隔须为 3～300 秒');
  if (!Number.isInteger(data.blameCodeLensCount) || data.blameCodeLensCount < 0 || data.blameCodeLensCount > 5) throw new Error('顶部行情数量须为 0～5');
  result.blameRotateSeconds = data.blameRotateSeconds;
  result.blameCodeLensCount = data.blameCodeLensCount;
  return result;
}

export function plainText(value: unknown): string {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
}

export interface NewsEntry { id: string; source: 'jin10' | 'xgb'; text: string; time: number; important: boolean }
export function normalizeNews(content: string, source: any): NewsEntry | undefined {
  if (!['jin10', 'xgb'].includes(source?.type)) return undefined;
  const raw = source.data || {};
  const text = plainText(content).slice(0, 12000);
  if (!text) return undefined;
  return { id: `${source.type}:${raw.id ?? text}`, source: source.type, text,
    time: Number.isFinite(source.time) ? source.time : 0, important: source.type === 'jin10' ? Number(raw.important) === 1 : Number(raw.level) > 0 };
}

export function renderProfitLabel(template: string, data: { currency: string; profit: number; todayProfit: number; marketValue: number; cost: number }): string {
  return template.replace(/\$\{(currency|profit|todayProfit|marketValue|cost)\}/g, (_, key: keyof typeof data) =>
    typeof data[key] === 'number' ? (data[key] as number).toFixed(2) : String(data[key]));
}
