import { commands, window, workspace } from 'vscode';
import { binanceQuotes } from '../explorer/binanceQuotes';
import globalState from '../globalState';
import { addPosition, calculatePortfolio, importPortfolio, Position, PositionMap, readPositions, validatePosition } from '../shared/portfolio';
import { events, formatDate } from '../shared/utils';
import StockService from '../explorer/stockService';
import { LeekFundConfig } from '../shared/leekConfig';

export class PortfolioService {
  private pending: Promise<unknown> = Promise.resolve();
  private snapshots = new WeakMap<StockService, { quotes: unknown; crypto: unknown; positions: string; day: string; result: ReturnType<typeof calculatePortfolio> }>();

  read(): Position[] {
    return readPositions(LeekFundConfig.getConfig('leek-fund.stockPrice', {}));
  }

  snapshot(stockService: StockService) {
    const raw = LeekFundConfig.getConfig('leek-fund.stockPrice', {});
    const positions = JSON.stringify(raw);
    const day = formatDate(new Date());
    const cached = this.snapshots.get(stockService);
    if (cached && cached.quotes === stockService.stockList && cached.crypto === binanceQuotes.items && cached.positions === positions && cached.day === day) return cached.result;
    const result = calculatePortfolio(readPositions(raw), [...stockService.stockList, ...binanceQuotes.items].map(item => item.info), day);
    this.snapshots.set(stockService, { quotes: stockService.stockList, crypto: binanceQuotes.items, positions, day, result });
    return result;
  }

  private change(fn: (map: PositionMap) => void): Promise<void> {
    const task = this.pending.then(async () => {
      const config = workspace.getConfiguration('leek-fund', null);
      const map: PositionMap = { ...LeekFundConfig.getConfig('leek-fund.stockPrice', {}) };
      fn(map);
      await config.update('stockPrice', map, true);
      globalState.stockPrice = map;
      events.emit('portfolioChanged');
      await commands.executeCommand('leek-fund.refreshStock');
    });
    this.pending = task.catch(() => {});
    return task;
  }

  save(input: unknown): Promise<void> {
    const position = validatePosition(input);
    return this.change(map => { const { code, ...data } = position; map[code] = data; });
  }

  remove(code: string): Promise<void> { return this.change(map => { delete map[code]; }); }

  add(code: string, amount: number, price: number): Promise<void> {
    return this.change(map => {
      const old = this.read().find(position => position.code === code);
      if (!old) throw new Error('持仓已不存在');
      const { code: positionCode, ...data } = addPosition(old, amount, price);
      map[positionCode] = data;
    });
  }

  close(code: string, exitPrice: number): Promise<void> {
    return this.change(map => {
      const old = this.read().find(position => position.code === code);
      if (!old) throw new Error('持仓已不存在');
      const { code: positionCode, ...data } = validatePosition({ ...old, todayUnitPrice: exitPrice, isSellOut: true, priceDate: formatDate(new Date()) });
      if (!Number.isFinite(exitPrice) || exitPrice <= 0) throw new Error('清仓成交价必须大于 0');
      map[positionCode] = data;
    });
  }

  async export(): Promise<void> {
    const uri = await window.showSaveDialog({ defaultUri: undefined, filters: { '持仓账本 JSON': ['json'] }, saveLabel: '导出账本' });
    if (!uri) return;
    const data = { version: 1, exportedAt: new Date().toISOString(), positions: this.read() };
    await workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(data, null, 2), 'utf8'));
    window.showInformationMessage('持仓账本已导出');
  }

  async import(): Promise<void> {
    const uris = await window.showOpenDialog({ canSelectMany: false, filters: { '持仓账本 JSON': ['json'] }, openLabel: '导入账本' });
    if (!uris?.length) return;
    const stat = await workspace.fs.stat(uris[0]);
    if (stat.size > 5 * 1024 * 1024) throw new Error('账本文件不能超过 5 MB');
    const rows = importPortfolio(JSON.parse(Buffer.from(await workspace.fs.readFile(uris[0])).toString('utf8')));
    const choice = await window.showWarningMessage(`导入 ${rows.length} 条持仓：同代码记录将覆盖，其余现有持仓保留。`, { modal: true }, '合并导入');
    if (choice !== '合并导入') return;
    await this.change(map => { rows.forEach(({ code, ...data }) => { map[code] = data; }); });
    window.showInformationMessage('持仓账本已导入');
  }
}

export const portfolio = new PortfolioService();
