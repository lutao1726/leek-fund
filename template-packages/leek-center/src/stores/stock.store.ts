import type { LeekTreeItem } from '../../types/shim-background';
import { makeAutoObservable } from 'mobx';
import { postMessage } from '@/utils/common';
import debounce from 'lodash/debounce';

const postSaveStockRemind = debounce((data) => {
  postMessage('saveRemind', JSON.stringify(data));
}, 1000);

class StockStore {
  stocks: LeekTreeItem[] = [];
  stockPanelInfo: undefined | LeekTreeItem;
  stockRemind: undefined | StockRemindType;
  groups: { id: string; name: string; codes: string[] }[] = [];
  groupsEnabled = false;
  heldCodes: string[] = [];

  constructor() {
    this._saveStockRemind = debounce(this._saveStockRemind, 100);
    makeAutoObservable(this);
  }

  setStocks(stocks: LeekTreeItem[]) {
    const previous = new Map(this.stocks.map(stock => [stock.info.code, stock]));
    const next = stocks.map(stock => {
      const old = previous.get(stock.info.code);
      return old && JSON.stringify(old.info) === JSON.stringify(stock.info) ? old : stock;
    });
    if (next.length !== this.stocks.length || next.some((stock, index) => stock !== this.stocks[index])) this.stocks = next;
    if (!this.stockPanelInfo && stocks.length) {
      this.stockPanelInfo = stocks[0];
    }
    if (this.stockPanelInfo) {
      this.stocks.some((stock) => {
        if (stock.info.code === this.stockPanelInfo?.info.code) {
          this.stockPanelInfo = stock;
          return true;
        }
        return false
      });
    }
  }

  applyQuoteUpdates(data: { updates: LeekTreeItem[]; removed: string[]; order: string[] }) {
    const rows = new Map(this.stocks.map(stock => [stock.info.code, stock]));
    data.removed.forEach(code => rows.delete(code));
    data.updates.forEach(stock => rows.set(stock.info.code, stock));
    this.setStocks(data.order.map(code => rows.get(code)).filter((stock): stock is LeekTreeItem => !!stock));
  }

  setGroups(data: { groups: { id: string; name: string; codes: string[] }[]; enabled: boolean; heldCodes: string[] }) {
    this.groups = data.groups;
    this.groupsEnabled = data.enabled;
    this.heldCodes = data.heldCodes;
  }

  setStockPanelInfo(stock: LeekTreeItem) {
    this.stockPanelInfo = stock;
  }

  setStockRemind(remind: StockRemindType) {
    this.stockRemind = remind;
  }

  removeStockRemind(code: string, type: 'percent' | 'price', value: string | number) {
    let remind = this.stockRemind?.[code];
    if (!remind || !remind[type]) return;
    const index = remind[type].indexOf(value);
    if (index < 0) return;
    const newRemind = remind[type].slice(0);
    newRemind.splice(index, 1);
    remind[type] = newRemind;
    this._saveStockRemind();
  }

  addStockRemind(code: string, type: 'percent' | 'price', value: string | number) {
    console.log('code: ', code, type, value);
    if (!this.stockRemind) return;
    let remind = (this.stockRemind[code] = this.stockRemind[code] || { price: [], percent: [] });
    let remindTypeArr = remind[type];
    if (remindTypeArr.indexOf(value) < 0) {
      remindTypeArr.push(value);
      remind[type] = remindTypeArr.slice(0);
      this.stockRemind[code] = remind;
      this._saveStockRemind();
    }
  }

  private _saveStockRemind() {
    if (!this.stockRemind) return;
    const stockRemind = this.stockRemind;
    const newRemind: StockRemindType = {};
    Object.keys(this.stockRemind).forEach((code) => {
      if (!stockRemind[code].price.length && !stockRemind[code].percent.length) {
        return;
      }
      newRemind[code] = stockRemind[code];
    });

    this.stockRemind = newRemind;
    postSaveStockRemind(newRemind);
  }
}

export default new StockStore();
