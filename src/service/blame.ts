import { CodeLens, DecorationRangeBehavior, Disposable, EventEmitter, languages, MarkdownString, Position, Range, TextDocument, TextEditor, ThemeColor, window } from 'vscode';
import StockService from '../explorer/stockService';
import { LeekFundConfig } from '../shared/leekConfig';
import { events } from '../shared/utils';
import { portfolio } from './portfolio';
import { plainText } from '../shared/presentation';

/** Native decorations only: never modifies file contents, Git history or GitLens settings. */
export class BlameQuotes implements Disposable {
  private decoration = window.createTextEditorDecorationType({ after: { margin: '0 0 0 2em', color: new ThemeColor('descriptionForeground') }, rangeBehavior: DecorationRangeBehavior.ClosedClosed });
  private changed = new EventEmitter<void>();
  private disposables: Disposable[] = [];
  private timer?: NodeJS.Timeout;
  private index = 0;
  private stopped = false;
  constructor(private stocks: StockService) {
    this.disposables.push(window.onDidChangeActiveTextEditor(() => this.draw()), window.onDidChangeTextEditorSelection(() => this.draw()),
      languages.registerCodeLensProvider({ scheme: 'file' }, { onDidChangeCodeLenses: this.changed.event, provideCodeLenses: document => this.lenses(document) }));
    events.on('stockListUpdate', this.update);
    events.on('onDidChangeConfiguration', this.configure);
    this.configure();
  }
  private enabled() { return !this.stopped && !!LeekFundConfig.getConfig('leek-fund.blameEnabled', false); }
  private eligible() {
    if (!LeekFundConfig.getConfig('leek-fund.blameOnlyHoldings', true)) {
      const codes: string[] = LeekFundConfig.getConfig('leek-fund.stocks', []);
      return this.stocks.stockList.filter(item => codes.includes(item.info.code));
    }
    const codes = new Set(portfolio.read().filter(item => !item.isSellOut).map(item => item.code));
    return this.stocks.stockList.filter(item => codes.has(item.info.code));
  }
  private label(item: ReturnType<BlameQuotes['eligible']>[number]) {
    const author = plainText(LeekFundConfig.getConfig('leek-fund.blameAuthor', 'You')).replace(/[\r\n]/g, ' ').slice(0, 40);
    const info = item.info;
    return `${author}, just now • ${plainText(info.name)} ${info.price || '—'} (${info.percent || '—'}%)`.replace(/[\r\n]/g, ' ').slice(0, 180);
  }
  private configure = () => {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.enabled()) {
      const seconds = Math.max(3, Math.min(300, Number(LeekFundConfig.getConfig('leek-fund.blameRotateSeconds', 10)) || 10));
      this.timer = setInterval(() => { this.index++; this.draw(); }, seconds * 1000);
    }
    this.update();
  };
  private update = () => { this.changed.fire(); this.draw(); };
  private lenses(document: TextDocument): CodeLens[] {
    if (!this.enabled()) return [];
    const count = Math.max(0, Math.min(10, Number(LeekFundConfig.getConfig('leek-fund.blameCodeLensCount', 3)) || 0));
    return this.eligible().slice(0, Math.min(count, document.lineCount)).map((item, index) =>
      new CodeLens(new Range(index, 0, index, 0), { command: 'leek-fund.openQuoteByCode', title: this.label(item), arguments: [item.info.code] }));
  }
  private draw() {
    for (const editor of window.visibleTextEditors) editor.setDecorations(this.decoration, []);
    const editor: TextEditor | undefined = window.activeTextEditor;
    if (!this.enabled() || !editor || editor.document.uri.scheme !== 'file') return;
    const items = this.eligible();
    if (!items.length) return;
    const item = items[this.index % items.length];
    const line = Math.min(editor.selection.active.line, editor.document.lineCount - 1);
    const end: Position = editor.document.lineAt(line).range.end;
    const hover = new MarkdownString();
    hover.appendText(`${item.info.name} ${item.info.code}\n现价 ${item.info.price || '—'} · 涨跌幅 ${item.info.percent || '—'}%\n报价时间 ${item.info.time || '未知'}\n点击文件顶部行情可打开走势。`);
    editor.setDecorations(this.decoration, [{ range: new Range(end, end), hoverMessage: hover, renderOptions: { after: { contentText: this.label(item) } } }]);
  }
  dispose() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    events.off('stockListUpdate', this.update); events.off('onDidChangeConfiguration', this.configure);
    for (const editor of window.visibleTextEditors) editor.setDecorations(this.decoration, []);
    this.disposables.forEach(item => item.dispose()); this.decoration.dispose(); this.changed.dispose();
  }
}
