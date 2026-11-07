type Reply = { sessionId: string; success: boolean; response: any };
type Pending = { finish: (success: boolean, value: any) => void };

/** Owns every callback/timer until a reply, cancellation, timeout, or page close. */
export class RequestBridge {
  private pending = new Map<string, Pending>();
  constructor(private send: (command: string, data: any) => void) {}

  get size() { return this.pending.size; }

  request(sessionId: string, data: object, timeout: number, signal?: AbortSignal): Promise<any> {
    if (signal?.aborted) return Promise.reject(new Error('请求已取消'));
    if (this.pending.size >= 32) return Promise.reject(new Error('请求过多，请稍后重试'));
    return new Promise((resolve, reject) => {
      const cancel = () => this.cancel(sessionId, '请求已取消');
      const timer = setTimeout(() => {
        this.cancel(sessionId, '请求超时，请稍后重试');
      }, timeout);
      const finish = (success: boolean, value: any) => {
        if (!this.pending.delete(sessionId)) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        if (success) resolve(value); else reject(value);
      };
      this.pending.set(sessionId, { finish });
      signal?.addEventListener('abort', cancel, { once: true });
      try { this.send('fetch', { ...data, sessionId }); }
      catch (error) { finish(false, error); }
    });
  }

  receive(reply: Reply) { this.pending.get(reply.sessionId)?.finish(reply.success, reply.response); }

  private cancel(id: string, reason: string) {
    try { this.send('cancelFetch', id); } catch { /* The page bridge may already be gone. */ }
    this.pending.get(id)?.finish(false, new Error(reason));
  }

  dispose() {
    for (const id of Array.from(this.pending.keys())) this.cancel(id, '页面已关闭');
  }
}
