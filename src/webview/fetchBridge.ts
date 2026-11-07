import axios, { AxiosRequestConfig, CancelTokenSource } from 'axios';

export class FetchBridge {
  private pending = new Map<string, CancelTokenSource>();
  private disposed = false;
  constructor(private send: (data: object) => void) {}

  async request(input: AxiosRequestConfig & { sessionId: string }) {
    const { sessionId, ...options } = input;
    if (this.disposed || typeof sessionId !== 'string' || this.pending.has(sessionId)) return;
    if (this.pending.size >= 32) {
      this.send({ sessionId, success: false, response: { message: '请求过多，请稍后重试' } });
      return;
    }
    const source = axios.CancelToken.source();
    this.pending.set(sessionId, source);
    try {
      const timeout = Math.min(30000, Math.max(1000, Number(options.timeout) || 15000));
      const response = await axios({ ...options, timeout, cancelToken: source.token });
      if (!this.disposed && this.pending.has(sessionId)) {
        const { data, status, statusText, headers } = response;
        this.send({ sessionId, success: true, response: { data, status, statusText, headers } });
      }
    } catch (error) {
      if (!this.disposed && this.pending.has(sessionId)) {
        this.send({ sessionId, success: false, response: { message: (error as Error).message } });
      }
    } finally { this.pending.delete(sessionId); }
  }

  cancel(id: string) {
    const source = this.pending.get(id);
    this.pending.delete(id);
    source?.cancel('请求已取消');
  }

  dispose() {
    this.disposed = true;
    for (const id of this.pending.keys()) this.cancel(id);
  }
}
