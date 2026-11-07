type QuoteRow = { id?: string; info: { code: string; [key: string]: any } };

/** Compare transport data, so no VS Code tree metadata crosses the bridge. */
export class QuoteUpdates {
  private signatures = new Map<string, string>();
  private order: string[] = [];
  private initialized = false;

  next(rows: QuoteRow[], force = false) {
    const order = rows.map(row => row.info.code);
    const updates = rows.filter(row => force || this.signatures.get(row.info.code) !== JSON.stringify(row.info))
      .map(row => ({ id: row.id, info: row.info }));
    const present = new Set(order);
    const removed = this.order.filter(code => !present.has(code));
    const reordered = order.length !== this.order.length || order.some((code, index) => this.order[index] !== code);
    const full = force || !this.initialized;
    if (!full && !updates.length && !removed.length && !reordered) return undefined;
    this.signatures = new Map(rows.map(row => [row.info.code, JSON.stringify(row.info)]));
    this.order = order;
    this.initialized = true;
    return { full, updates, removed, order };
  }
}
