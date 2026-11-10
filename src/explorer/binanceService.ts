/*
 * @Author: John Trump
 * @Date: 2020-12-04 13:37:38
 * @LastEditors: John Trump
 * @LastEditTime: 2021-01-26 23:14:24
 */

import Axios from 'axios';
import { ExtensionContext } from 'vscode';
import globalState from '../globalState';
import { LeekTreeItem } from '../shared/leekTreeItem';
import { FundInfo, SortType, TreeItemType } from '../shared/typed';
import { LeekFundConfig } from '../shared/leekConfig';
import { binanceCode } from '../shared/binance';
import { binanceQuotes } from './binanceQuotes';
import { readPositions } from '../shared/portfolio';
import { events, randHeader, sortData } from '../shared/utils';
import { LeekService } from './leekService';

export default class BinanceService extends LeekService {
  private context: ExtensionContext;
  private requestVersion = 0;
  private parisUrl = 'https://data-api.binance.vision/api/v3/exchangeInfo';
  private ticker24hrUrl = 'https://data-api.binance.vision/api/v3/ticker/24hr';
  constructor(context: ExtensionContext) {
    super();
    this.context = context;
  }

  /** 获取支持的交易对 */
  async getParis(): Promise<string[]> {
    const res: any = await Axios.get(this.parisUrl, {
      headers: randHeader(),
      timeout: 10000,
    }).catch((err) => {
      globalState.telemetry.sendEvent('error: binanceService', {
        url: this.parisUrl,
        error: err,
      });
    });
    if (res && res.data) {
      return res.data.symbols?.map((i: any) => `${i.baseAsset}_${i.quoteAsset}`);
    }
    return [''];
  }

  async _fetchPairData(symbolsWithSplit: string[]): Promise<{ data: any, symbol: string }[]> {
    const symbols = JSON.stringify(symbolsWithSplit.map(sws => sws.split('_').join('')));
    return await Axios.get<{ data: any[] }>(this.ticker24hrUrl, {
      params: { symbols },
      headers: randHeader(),
      timeout: 10000,
    }).then(res => symbolsWithSplit.map(symbol => {
      const target = (res.data as any).find((data: any) => data.symbol === symbol.split('_').join(''));
      return ({ data: target, symbol });
    })).catch((err) => {
      globalState.telemetry.sendEvent('error: binanceService', {
        url: this.ticker24hrUrl,
        error: err,
      });
      // One delisted/invalid pair must not hide quotes for every other holding.
      if (symbolsWithSplit.length > 1 && err.response?.data?.code === -1121) {
        return Promise.all(symbolsWithSplit.map(symbol => this._fetchPairData([symbol]).then(rows => rows[0]).catch(() => ({ data: null, symbol }))));
      }
      return Promise.reject(symbolsWithSplit.map(symbol => ({ data: null, symbol })));
    });
  }

  async getData(codes: string[], order: SortType): Promise<LeekTreeItem[]> {
    const version = ++this.requestVersion;
    codes = Array.from(new Set<string>([...codes, ...readPositions(LeekFundConfig.getConfig('leek-fund.stockPrice', {})).map(row => row.code), ...LeekFundConfig.getConfig('leek-fund.statusBarStock', [])])).filter(code => binanceCode.test(code));
    const pairList: Array<LeekTreeItem> = [];
    if (!codes.length) { binanceQuotes.items = []; events.emit('binanceListUpdate'); return []; }

    // 20个请求的权重最低
    let splitFetch = [];
    while (codes.length > 20) {
      splitFetch.push(codes.splice(0, 20));
    }
    splitFetch.push(codes);
    const promises = splitFetch.map(splitCodes => this._fetchPairData(splitCodes));
    /* Shim for Promise.allSettled */
    if (!Promise.allSettled) {
      // @ts-ignore
      Promise.allSettled = (promises: Promise<any>[]) => {
        let wrappedPromises = promises.map((p) =>
          Promise.resolve(p).then(
            (val) => ({ status: 'fulfilled', value: val }),
            (err) => ({ status: 'rejected', reason: err })
          )
        );
        return Promise.all(wrappedPromises);
      };
    }

    const results = await Promise.allSettled(promises);
    for (const splitRes of results) {
      // @ts-ignore
      const { status, value, reason } = splitRes;
      for (const item of (value || reason)) {
        if (status === 'fulfilled' && item.data) {
          const {
            data,
            symbol,
          } = item;
          const obj: FundInfo = {
            id: symbol,
            code: symbol,
            name: symbol,
            price: data.lastPrice, // 现价
            open: data.openPrice, // 今开
            yestclose: data.openPrice, // 滚动24小时起始价格
            time: Number.isFinite(data.closeTime) ? new Date(data.closeTime).toISOString() : undefined,
            volume: data.volume, // 24h成交量
            amount: data.quoteVolume, // 24h成交额
            percent: data.priceChangePercent, // 百分比
            updown: data.priceChange, // 涨跌
            high: data.highPrice, // 最高
            low: data.lowPrice, // 最低
            showLabel: this.showLabel,
            _itemType: TreeItemType.BINANCE,
          };
          pairList.push(new LeekTreeItem(obj, this.context));
        } else {
          // handle status === 'rejected'
          const { symbol } = item;
          const obj: FundInfo = {
            id: symbol,
            code: symbol,
            percent: '0',
            name: symbol + '网络错误',
            showLabel: this.showLabel,
            _itemType: TreeItemType.BINANCE,
          };
          pairList.push(new LeekTreeItem(obj, this.context));
        }
      }

    }
    if (version === this.requestVersion) {
      binanceQuotes.items = pairList;
      events.emit('binanceListUpdate');
    }
    return sortData(pairList, order);
  }
}
