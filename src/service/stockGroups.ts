import { randomBytes } from 'crypto';
import { workspace } from 'vscode';
import { DEFAULT_GROUP, deleteGroup, moveStocks, normalizeGroups, StockGroups } from '../shared/watchlist';
import { LeekFundConfig } from '../shared/leekConfig';

export class StockGroupsService {
  private pending: Promise<unknown> = Promise.resolve();

  read(): StockGroups {
    return normalizeGroups(LeekFundConfig.getConfig('leek-fund.stockGroups'), LeekFundConfig.getConfig('leek-fund.stocks', []));
  }

  update(change: (book: StockGroups) => StockGroups): Promise<void> {
    const task = this.pending.then(async () => {
      await workspace.getConfiguration('leek-fund', null).update('stockGroups', change(this.read()), true);
    });
    this.pending = task.catch(() => {});
    return task;
  }

  async add(name: string): Promise<void> {
    await this.update(book => {
      this.checkName(book, name);
      return { ...book, groups: [...book.groups, { id: randomBytes(8).toString('hex'), name: name.trim(), codes: [] }] };
    });
    await workspace.getConfiguration('leek-fund', null).update('useStockGroups', true, true);
  }

  rename(id: string, name: string): Promise<void> {
    return this.update(book => {
      this.checkName(book, name, id);
      return { ...book, groups: book.groups.map(group => group.id === id ? { ...group, name: name.trim() } : group) };
    });
  }

  remove(id: string): Promise<void> { return this.update(book => deleteGroup(book, id)); }

  move(codes: string[], id = DEFAULT_GROUP, before?: string): Promise<void> {
    return this.update(book => moveStocks(book, codes, id, before));
  }

  reorder(ids: string[], before?: string): Promise<void> {
    return this.update(book => {
      if (before && ids.includes(before)) return book;
      const moved = book.groups.filter(group => ids.includes(group.id));
      const rest = book.groups.filter(group => !ids.includes(group.id));
      const index = before ? rest.findIndex(group => group.id === before) : -1;
      rest.splice(index < 0 ? rest.length : index, 0, ...moved);
      return { ...book, groups: rest };
    });
  }

  private checkName(book: StockGroups, name: string, except?: string) {
    if (!name.trim() || name.trim().length > 40) throw new Error('分组名须为 1～40 个字符');
    if (book.groups.some(group => group.id !== except && group.name === name.trim())) throw new Error('分组名称已存在');
  }
}

export const stockGroups = new StockGroupsService();
