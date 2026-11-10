/*
 * @Author: John Trump
 * @Date: 2020-12-04 13:37:18
 * @LastEditors: John Trump
 * @LastEditTime: 2020-12-06 20:14:01
 */

import { Event, EventEmitter, TreeDataProvider, TreeItem } from 'vscode';
import { LeekFundConfig } from '../shared/leekConfig';
import { LeekTreeItem } from '../shared/leekTreeItem';
import BinanceService from './binanceService';
import { SortType } from '../shared/typed';

export class BinanceProvider implements TreeDataProvider<any> {
  private _onDidChangeTreeData: EventEmitter<any> = new EventEmitter<any>();
  private service: BinanceService;
  readonly onDidChangeTreeData: Event<any> = this._onDidChangeTreeData.event;
  private order: SortType = SortType.NORMAL;
  private items?: Promise<LeekTreeItem[]>;

  constructor(service: BinanceService) {
    this.service = service;
    this.order = LeekFundConfig.getConfig('leek-fund.binanceSort') || SortType.NORMAL;
  }

  getTreeItem(element: any): TreeItem | Thenable<TreeItem> {
    return element;
  }

  getChildren(): Promise<LeekTreeItem[]> {
    const paris = LeekFundConfig.getConfig('leek-fund.binance') || [];
    return this.items ||= this.service.getData([...paris], this.order).then(items => items.filter(item => paris.includes(item.info.code)));
  }

  getParent?() {
    return null;
  }

  /* Implement */
  /** Notify data change then refresh */
  refresh(): any {
    // this.service.getParis();
    this.items = undefined;
    void this.getChildren().then(() => this._onDidChangeTreeData.fire(undefined));
  }

  /** Modify order */
  changeOrder(): void {
    // leek-fund.binanceSort
    let order = this.order as number;
    order += 1;
    if (order > 1) {
      this.order = SortType.DESC;
    } else if (order === 1) {
      this.order = SortType.ASC;
    } else if (order === 0) {
      this.order = SortType.NORMAL;
    }
    LeekFundConfig.setConfig('leek-fund.binanceSort', this.order);
    this.refresh();
  }
}
