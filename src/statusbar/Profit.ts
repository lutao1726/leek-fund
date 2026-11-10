/** 股票收益状态栏显示 */

import { StatusBarAlignment, StatusBarItem, window } from 'vscode';
import { LeekFundConfig } from '../shared/leekConfig';
import { events } from '../shared/utils';
import StockService from '../explorer/stockService';
import { portfolio } from '../service/portfolio';
import { DISPLAY_DEFAULTS, renderProfitLabel } from '../shared/presentation';

const PREFIX = '💰';

export class ProfitStatusBar {
  stockBarItem: StatusBarItem | undefined;
  isEnable: boolean = false;
  hideStatusBar: boolean = false;
  unsubscribe: Function = () => {};
  private lastData?: StockService;
  fallColor: string = 'green';
  riseColor: string = 'red';
  constructor() {
    this.init();
  }

  init() {
    this.isEnable = !!LeekFundConfig.getConfig('leek-fund.showEarnings');
    this.hideStatusBar = LeekFundConfig.getConfig('leek-fund.hideStatusBar');
    //如果显示收益 && 显示状态栏
    if (this.isEnable && !this.hideStatusBar) {
      this.riseColor = LeekFundConfig.getConfig('leek-fund.riseColor');
      this.fallColor = LeekFundConfig.getConfig('leek-fund.fallColor');
      this.stockBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 3);
      this.stockBarItem.text = `${PREFIX}  --`;
      this.stockBarItem.command = 'leek-fund.openPortfolio';
      this.stockBarItem.show();

      const profitStockUpdateListener = (data: StockService) => {
        this.updateStockBarItem(data);
      };
      events.on('updateBar:stock-profit-refresh', profitStockUpdateListener);
      const cryptoUpdate = () => { if (this.lastData) this.updateStockBarItem(this.lastData); };
      events.on('binanceListUpdate', cryptoUpdate);
      this.unsubscribe = () => {
        events.off('updateBar:stock-profit-refresh', profitStockUpdateListener);
        events.off('binanceListUpdate', cryptoUpdate);
      };
    }
  }

  reload() {
    this.riseColor = LeekFundConfig.getConfig('leek-fund.riseColor');
    this.fallColor = LeekFundConfig.getConfig('leek-fund.fallColor');
    const enable: boolean = !!LeekFundConfig.getConfig('leek-fund.showEarnings');
    const hideStatusBar: boolean = LeekFundConfig.getConfig('leek-fund.hideStatusBar');
    if (this.isEnable !== enable || this.hideStatusBar !== hideStatusBar) {
      this.isEnable = enable;
      this.hideStatusBar = hideStatusBar;
      //如果隐藏状态栏 || 隐藏收益
      if (hideStatusBar || !enable) {
        this.destroy();
      } else {
        this.init();
      }
    }
    if (this.lastData) this.updateStockBarItem(this.lastData);
  }

  updateStockBarItem(data: StockService) {
    this.lastData = data;
    if (!this.stockBarItem) return;
    const { rows, totals } = portfolio.snapshot(data);
    const money = (value: number | undefined) => value === undefined ? '暂无行情' : value.toFixed(2);
    const prefix = LeekFundConfig.getConfig('leek-fund.hideStatusBarIcon', false) ? '' : '💰 ';
    const template = LeekFundConfig.getConfig('leek-fund.statusBarProfitFormat', DISPLAY_DEFAULTS.statusBarProfitFormat);
    this.stockBarItem.text = totals.length ? prefix + totals.map(total =>
      renderProfitLabel(template, total) + (total.missingQuotes || total.missingDailyQuotes ? ' *' : '')
    ).join(' · ') : '💰 --';
    this.stockBarItem.tooltip = [
      '资产 · 浮动盈亏 | 今日/虚拟币24h估算盈亏（按币种统计）',
      ...totals.map(total => total.currency + ' 市值 ' + money(total.marketValue) + ' 成本 ' + money(total.cost) +
        (total.missingQuotes ? '（缺少 ' + total.missingQuotes + ' 条报价，估值不完整）' : '') + (total.missingDailyQuotes ? '（今日盈亏缺少 ' + total.missingDailyQuotes + ' 条数据）' : '')),
      ...rows.map(row => row.name + ' ' + row.currency + ' 浮动盈亏 ' + money(row.profit) + ' 今日估算 ' + money(row.todayProfit)),
      '点击打开资产管理中心。不同币种不相加；当日交易和费用可能造成估算偏差。',
    ].join('\n');
    this.stockBarItem.show();
  }

  destroy() {
    this.unsubscribe();
    this.unsubscribe = () => {};
    this.stockBarItem?.dispose();
    this.stockBarItem = undefined;
  }
}
