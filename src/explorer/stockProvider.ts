import { CancellationToken, DataTransfer, DataTransferItem, Event, EventEmitter, TreeDataProvider, TreeDragAndDropController, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
// import { compact, flattenDeep, uniq } from 'lodash';

import { groupBy } from 'lodash';
import globalState from '../globalState';
import { LeekTreeItem } from '../shared/leekTreeItem';
import { defaultFundInfo, SortType, StockCategory } from '../shared/typed';
import { LeekFundConfig } from '../shared/leekConfig';
import StockService from './stockService';
import { stockGroups } from '../service/stockGroups';
import { DEFAULT_GROUP, sortQuotes } from '../shared/watchlist';
import { portfolio } from '../service/portfolio';

const GROUP_PREFIX = 'watch-group:';
const HELD_ID = 'watch-held';
const DRAG_TYPE = 'application/vnd.code.tree.leekfundview.stock';

export class StockProvider implements TreeDataProvider<LeekTreeItem>, TreeDragAndDropController<LeekTreeItem> {
  readonly dragMimeTypes = [DRAG_TYPE];
  readonly dropMimeTypes = [DRAG_TYPE];
  private parents = new Map<string, LeekTreeItem>();

  get customGroups(): boolean { return LeekFundConfig.getConfig('leek-fund.useStockGroups', false); }

  groupId(element?: LeekTreeItem): string | undefined {
    return element?.contextValue === 'stockGroup' ? element.id?.slice(GROUP_PREFIX.length) : undefined;
  }

  private groupNode(id: string, name: string, count: number, held = false): LeekTreeItem {
    return new LeekTreeItem({ ...defaultFundInfo, id: held ? HELD_ID : GROUP_PREFIX + id,
      name: `${name} (${count})`, contextValue: held ? 'holdingGroup' : 'stockGroup' }, undefined, true);
  }

  private customRoots(): LeekTreeItem[] {
    const book = stockGroups.read();
    const held = portfolio.read().filter(position => !position.isSellOut);
    const roots = book.groups.map(group => this.groupNode(group.id, group.name, group.codes.length));
    if (held.length) roots.unshift(this.groupNode('', '我的持仓', held.length, true));
    return roots;
  }

  private groupedChildren(element: LeekTreeItem): LeekTreeItem[] {
    const held = element.id === HELD_ID;
    const codes = held ? portfolio.read().filter(position => !position.isSellOut).map(position => position.code)
      : stockGroups.read().groups.find(group => group.id === this.groupId(element))?.codes || [];
    const quotesByCode = new Map(this.service.stockList.map(item => [item.info.code, item]));
    const rows = codes.map(code => {
      const source = quotesByCode.get(code);
      const info = source?.info || { ...defaultFundInfo, name: code, code, type: 'nodata', contextValue: 'nodata', showLabel: true };
      const item = new LeekTreeItem({ ...info, id: `${element.id}:${code}` }, globalState.context);
      this.parents.set(item.id!, element);
      return item;
    });
    return sortQuotes(rows, this.order);
  }

  async findByCode(code: string): Promise<LeekTreeItem | undefined> {
    const walk = async (parent?: LeekTreeItem): Promise<LeekTreeItem | undefined> => {
      for (const item of await this.getChildren(parent)) {
        if (!item.isCategory && item.info.code === code) return item;
        if (item.isCategory) { const found = await walk(item); if (found) return found; }
      }
      return undefined;
    };
    return walk();
  }

  handleDrag(source: readonly LeekTreeItem[], transfer: DataTransfer): void {
    if (!this.customGroups) return;
    transfer.set(DRAG_TYPE, new DataTransferItem(source.map(item => ({
      group: this.groupId(item), code: item.isCategory ? undefined : item.info.code,
    })).filter(item => item.group || item.code)));
  }

  async handleDrop(target: LeekTreeItem | undefined, transfer: DataTransfer, token: CancellationToken): Promise<void> {
    if (!this.customGroups || token.isCancellationRequested) return;
    const entries = transfer.get(DRAG_TYPE)?.value as { group?: string; code?: string }[] | undefined;
    if (!Array.isArray(entries) || !entries.length) return;
    try {
      const groups = entries.filter(entry => typeof entry.group === 'string').map(entry => entry.group!);
      const codes = entries.filter(entry => typeof entry.code === 'string').map(entry => entry.code!);
      if (groups.length && !codes.length) {
        if (target && target.contextValue !== 'stockGroup') return;
        await stockGroups.reorder(groups, this.groupId(target));
      } else if (codes.length && !groups.length) {
        if (target?.id === HELD_ID || (target && this.getParent(target)?.id === HELD_ID)) return;
        const parent = target && !target.isCategory ? this.getParent(target) : target;
        await stockGroups.move(codes, this.groupId(parent) || DEFAULT_GROUP, target && !target.isCategory ? target.info.code : undefined);
        await LeekFundConfig.setConfig('leek-fund.stockSort', SortType.NORMAL);
      }
      void this.refresh(false);
    } catch (error) { window.showErrorMessage(`拖拽失败：${(error as Error).message}`); }
  }

  async moveManual(code: string, offset: number): Promise<boolean> {
    if (!this.customGroups) return false;
    const group = stockGroups.read().groups.find(item => item.codes.includes(code));
    if (!group) return true;
    const index = group.codes.indexOf(code);
    const target = offset === 0 ? 0 : index + offset;
    if (target >= 0 && target < group.codes.length) {
      const codes = group.codes.filter(item => item !== code);
      await stockGroups.move([code], group.id, codes[target]);
      await LeekFundConfig.setConfig('leek-fund.stockSort', SortType.NORMAL);
      void this.refresh(false);
    }
    return true;
  }
  private _onDidChangeTreeData: EventEmitter<any> = new EventEmitter<any>();

  readonly onDidChangeTreeData: Event<any> = this._onDidChangeTreeData.event;

  private service: StockService;
  private order: SortType;
  private expandAStock: boolean;
  private expandHKStock: boolean;
  private expandUSStock: boolean;
  private expandCNFuture: boolean;
  private expandOverseaFuture: boolean;

  constructor(service: StockService) {
    this.service = service;
    this.order = LeekFundConfig.getConfig('leek-fund.stockSort') || SortType.NORMAL;
    this.expandAStock = LeekFundConfig.getConfig('leek-fund.expandAStock', true);
    this.expandHKStock = LeekFundConfig.getConfig('leek-fund.expandHKStock', false);
    this.expandUSStock = LeekFundConfig.getConfig('leek-fund.expandUSStock', false);
    this.expandCNFuture = LeekFundConfig.getConfig('leek-fund.expandCNFuture', false);
    this.expandOverseaFuture = LeekFundConfig.getConfig('leek-fund.expandOverseaFuture', false);
  }

  async refresh(fetchQuotes = true): Promise<void> {
    this.order = LeekFundConfig.getConfig('leek-fund.stockSort', SortType.NORMAL);
    if (fetchQuotes) await this.service.getData(LeekFundConfig.getConfig('leek-fund.stocks', []), this.order);
    else this.service.stockList = sortQuotes(this.service.stockList.map(item => new LeekTreeItem({ ...item.info }, globalState.context)), this.order);
    this._onDidChangeTreeData.fire(undefined);
  }

  getChildren(element?: LeekTreeItem | undefined): LeekTreeItem[] | Thenable<LeekTreeItem[]> {
    if (!element) {
      // Root view
      this.parents.clear();
      return this.customGroups ? this.customRoots() : this.getRootNodes();
    } else {
      if (this.customGroups) return this.groupedChildren(element);
      const watched: string[] = LeekFundConfig.getConfig('leek-fund.stocks', []);
      const resultPromise = Promise.resolve((this.service.stockList || []).filter(item => watched.includes(item.info.code)));
      const remember = (items: LeekTreeItem[]) => { items.forEach(item => this.parents.set(item.id!, element)); return items; };
      if (element.contextValue === 'industry') {
        return this.getIndustryStockNodes(resultPromise, element.id || '').then(remember);
      }
      switch (
        element.id // First-level
      ) {
        case StockCategory.A:
          if (LeekFundConfig.getConfig('leek-fund.groupStockByIndustry')) {
            return this.getAStockNodesGrouped(resultPromise).then(remember);
          }
          return this.getAStockNodes(resultPromise).then(remember);
        case StockCategory.HK:
          return this.getHkStockNodes(resultPromise).then(remember);
        case StockCategory.US:
          return this.getUsStockNodes(resultPromise).then(remember);
        case StockCategory.Future:
          return this.getFutureStockNodes(resultPromise).then(remember);
        case StockCategory.OverseaFuture:
          return this.getOverseaFutureStockNodes(resultPromise).then(remember);
        case StockCategory.NODATA:
          return this.getNoDataStockNodes(resultPromise).then(remember);
        default:
          return [];
        // return this.getChildrenNodesById(element.id);
      }
    }
  }

  getParent(element: LeekTreeItem): LeekTreeItem | undefined {
    return element ? this.parents.get(element.id!) : undefined;
  }

  getTreeItem(element: LeekTreeItem): TreeItem {
    if (!element.isCategory) {
      return element;
    } else {
      return {
        id: element.id,
        label: element.info.name,
        // tooltip: this.getSubCategoryTooltip(element),
        collapsibleState:
          element.contextValue === 'stockGroup' || element.id === HELD_ID ||
          (element.id === StockCategory.A && this.expandAStock) ||
          (element.id === StockCategory.HK && this.expandHKStock) ||
          (element.id === StockCategory.US && this.expandUSStock) ||
          (element.id === StockCategory.Future && this.expandCNFuture) ||
          (element.id === StockCategory.OverseaFuture && this.expandCNFuture)
            ? TreeItemCollapsibleState.Expanded
            : TreeItemCollapsibleState.Collapsed,
        // iconPath: this.parseIconPathFromProblemState(element),
          iconPath: element.iconPath,
        command: undefined,
        contextValue: element.contextValue,
      };
    }
  }

  getRootNodes(): LeekTreeItem[] {
    const nodes = [
      new LeekTreeItem(
        Object.assign({ contextValue: 'category' }, defaultFundInfo, {
          id: StockCategory.A,
          name: `${StockCategory.A}${
            globalState.aStockCount > 0 ? `(${globalState.aStockCount})` : ''
          }`,
        }),
        undefined,
        true
      ),
      new LeekTreeItem(
        Object.assign({ contextValue: 'category' }, defaultFundInfo, {
          id: StockCategory.HK,
          name: `${StockCategory.HK}${
            globalState.hkStockCount > 0 ? `(${globalState.hkStockCount})` : ''
          }`,
        }),
        undefined,
        true
      ),
      new LeekTreeItem(
        Object.assign({ contextValue: 'category' }, defaultFundInfo, {
          id: StockCategory.US,
          name: `${StockCategory.US}${
            globalState.usStockCount > 0 ? `(${globalState.usStockCount})` : ''
          }`,
        }),
        undefined,
        true
      ),
      new LeekTreeItem(
        Object.assign({ contextValue: 'category' }, defaultFundInfo, {
          id: StockCategory.Future,
          name: `${StockCategory.Future}${
            globalState.cnfStockCount > 0 ? `(${globalState.cnfStockCount})` : ''
          }`,
        }),
        undefined,
        true
      ),
      new LeekTreeItem(
        Object.assign({ contextValue: 'category' }, defaultFundInfo, {
          id: StockCategory.OverseaFuture,
          name: `${StockCategory.OverseaFuture}${
            globalState.hfStockCount > 0 ? `(${globalState.hfStockCount})` : ''
          }`,
        }),
        undefined,
        true
      ),
    ];
    // 显示接口不支持的股票，避免用户老问为什么添加了股票没反应
    if (globalState.noDataStockCount) {
      nodes.push(
        new LeekTreeItem(
          Object.assign({ contextValue: 'category' }, defaultFundInfo, {
            id: StockCategory.NODATA,
            name: `${StockCategory.NODATA}(${globalState.noDataStockCount})`,
          }),
          undefined,
          true
        )
      );
    }
    return nodes;
  }
  getAStockNodes(stocks: Promise<LeekTreeItem[]>): Promise<LeekTreeItem[]> {
    const aStocks: Promise<LeekTreeItem[]> = stocks.then((res: LeekTreeItem[]) => {
      const arr = res.filter((item: LeekTreeItem) => /^(sh|sz|bj)/.test(item.type || ''));
      return arr;
    });

    return aStocks;
  }
    async getAStockNodesGrouped(stocks: Promise<LeekTreeItem[]>): Promise<LeekTreeItem[]> {
    const stockList = await stocks;
    const aStocks = stockList.filter((item: LeekTreeItem) => /^(sh|sz|bj)/.test(item.type || ''));
    const grouped = groupBy(aStocks, (item) => {
      if (item.info.heldAmount && Number(item.info.heldAmount) > 0 && !item.info.isSellOut) {
        return '我的持仓';
      }
      return item.info.industry || '其他';
    });
    const groupKeys = Object.keys(grouped);
    const groups = groupKeys.map((key) => {
      const items = grouped[key];
      let totalPercent = 0;
      let count = 0;
      items.forEach((item) => {
        const percent = parseFloat(item.info.percent);
        if (!isNaN(percent)) {
          totalPercent += percent;
          count++;
        }
      });
      const avgPercent = count > 0 ? totalPercent / count : 0;
      return { key, items, avgPercent, count: items.length };
    });

    if (this.order === SortType.ASC) {
      groups.sort((a, b) => a.avgPercent - b.avgPercent);
    } else if (this.order === SortType.DESC) {
      groups.sort((a, b) => b.avgPercent - a.avgPercent);
    }

    // 将“我的持仓”置顶
    const heldGroupIndex = groups.findIndex((g) => g.key === '我的持仓');
    if (heldGroupIndex > -1) {
      const heldGroup = groups.splice(heldGroupIndex, 1)[0];
      groups.unshift(heldGroup);
    }

    const nodes = groups.map((group) => {
      const percentStr = group.avgPercent.toFixed(2);
      return new LeekTreeItem(
        Object.assign({ contextValue: 'industry' }, defaultFundInfo, {
          id: group.key,
          name: `${group.key} ${group.avgPercent >= 0 ? '+' : ''}${percentStr}%`,
          percent: percentStr,
        }),
        globalState.context,
        true
      );
    });
    return nodes;
  }

  async getIndustryStockNodes(
    stocks: Promise<LeekTreeItem[]>,
    industry: string
  ): Promise<LeekTreeItem[]> {
    const stockList = await stocks;
    const nodes = stockList.filter((item: LeekTreeItem) => {
      if (industry === '我的持仓') {
        return item.info.heldAmount && Number(item.info.heldAmount) > 0 && !item.info.isSellOut;
      }
      const isHeld = item.info.heldAmount && Number(item.info.heldAmount) > 0 && !item.info.isSellOut;
      return !isHeld && (item.info.industry || '其他') === industry;
    });
    return nodes;
  }
  getHkStockNodes(stocks: Promise<LeekTreeItem[]>): Promise<LeekTreeItem[]> {
    return stocks.then((res: LeekTreeItem[]) =>
      res.filter((item: LeekTreeItem) => /^(hk)/.test(item.type || ''))
    );
  }
  getUsStockNodes(stocks: Promise<LeekTreeItem[]>): Promise<LeekTreeItem[]> {
    return stocks.then((res: LeekTreeItem[]) =>
      res.filter((item: LeekTreeItem) => /^(usr_)/.test(item.type || ''))
    );
  }
  getFutureStockNodes(stocks: Promise<LeekTreeItem[]>): Promise<LeekTreeItem[]> {
    return stocks.then((res: LeekTreeItem[]) =>
      res.filter((item: LeekTreeItem) => /^(nf_)/.test(item.type || ''))
    );
  }
  getOverseaFutureStockNodes(stocks: Promise<LeekTreeItem[]>): Promise<LeekTreeItem[]> {
    return stocks.then((res: LeekTreeItem[]) =>
      res.filter((item: LeekTreeItem) => /^(hf_)/.test(item.type || ''))
    );
  }
  getNoDataStockNodes(stocks: Promise<LeekTreeItem[]>): Promise<LeekTreeItem[]> {
    return stocks.then((res: LeekTreeItem[]) => {
      return res.filter((item: LeekTreeItem) => {
        return /^(nodata)/.test(item.type || '');
      });
    });
  }

  changeOrder(): void {
    let order = this.order as number;
    order += 1;
    if (order > 1) {
      this.order = SortType.DESC;
    } else if (order === 1) {
      this.order = SortType.ASC;
    } else if (order === 0) {
      this.order = SortType.NORMAL;
    }
    LeekFundConfig.setConfig('leek-fund.stockSort', this.order);
    void this.refresh(false);
  }
}
