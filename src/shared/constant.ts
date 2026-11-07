/**
 * 默认模板格式
 */
export const DEFAULT_LABEL_FORMAT = {
  statusBarLabelFormat: '「${name}」${price} ${icon}（${percent}）',
  sidebarBinanceLabelFormat:
    '${icon|padRight|4}${percent|padRight|11}${price|padRight|15}「${name}」',
  sidebarStockLabelFormat:
    '${icon|padRight|4}${percent|padRight|11}${price|padRight|15}「${name}」',
  sidebarForexLabelFormat:
    '「${name}」  现汇：${spotBuyPrice|padRight|6} / ${spotSellPrice|padRight|6}  现钞：${cashBuyPrice|padRight|6} / ${cashSellPrice|padRight|6}',
};

/**
 * 提示语
 * TODO: 丰富模板
 */
export const TIPS_LOSE = [
  '今晚吃面🍜！',
  '关灯吃面🍜！',
  '稳住，我们能赢！',
  '在A股，稳住才会有收益！',
  '投资其实就是一次心态修炼，稳住心态长期投资都会有收益的！',
];
export const TIPS_WIN = ['喝汤吃肉！', '吃鸡腿🍗！', '好起来了！', '祝老板吃肉！'];
