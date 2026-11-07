import { useCallback, useEffect, useRef, useState } from 'react';
import { postMessage } from '@/utils/common';
import type { MarketResult } from '../../../../src/shared/market';

export interface MarketViewState { visible: boolean; followedBoards: string[]; watchedCodes: string[]; changeTypes: { type: number; label: string; direction: 'up' | 'down' }[] }
type Pending = { channel: string; finish: (error?: Error, value?: any) => void };
export class MarketClient {
  state: MarketViewState = { visible: true, followedBoards: [], watchedCodes: [], changeTypes: [] };
  private pending = new Map<string, Pending>();
  private listeners = new Set<() => void>();
  private serial = 0;
  constructor(private send = postMessage) {
    window.addEventListener('message', this.receive);
    window.addEventListener('pagehide', this.close);
  }
  private receive = (event: MessageEvent) => {
    const { command, data } = event.data || {};
    if (command === 'marketReply') this.pending.get(data.id)?.finish(data.success ? undefined : new Error(data.error || '行情请求失败'), data.value);
    if (command === 'marketState') {
      this.state = data;
      if (!data.visible) this.close();
      this.listeners.forEach(listener => listener());
    }
  };
  subscribe(listener: () => void) { const first = !this.listeners.size; this.listeners.add(listener); if (first) this.send('getMarketState'); return () => { this.listeners.delete(listener); }; }
  request<T>(action: string, params: object, channel: string, signal: AbortSignal, force = false): Promise<T> {
    if (signal.aborted || !this.state.visible) return Promise.reject(new Error('页面不可见或请求已取消'));
    for (const [id, item] of Array.from(this.pending)) if (item.channel === channel) this.cancel(id, '请求已被更新操作替代');
    if (this.pending.size >= 8) return Promise.reject(new Error('同时请求过多，请稍后重试'));
    const id = `market-${Date.now()}-${++this.serial}`;
    return new Promise((resolve, reject) => {
      const cancel = () => this.cancel(id, '请求已取消');
      const timer = setTimeout(() => this.cancel(id, '市场数据请求超时，请重试'), 45000);
      const finish = (error?: Error, value?: T) => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer); signal.removeEventListener('abort', cancel);
        if (error) reject(error); else resolve(value!);
      };
      this.pending.set(id, { channel, finish }); signal.addEventListener('abort', cancel, { once: true });
      try { this.send('marketRequest', { id, action, params, channel, force }); } catch (error) { finish(error as Error); }
    });
  }
  private cancel(id: string, reason: string) {
    try { this.send('cancelMarket', id); } catch { /* Bridge may already be gone. */ }
    const error = new Error(reason); if (!reason.includes('超时')) error.name = 'AbortError';
    this.pending.get(id)?.finish(error);
  }
  private close = () => { for (const id of Array.from(this.pending.keys())) this.cancel(id, '页面已关闭或隐藏'); };
  dispose() { this.close(); window.removeEventListener('message', this.receive); window.removeEventListener('pagehide', this.close); this.listeners.clear(); }
}
export const marketClient = new MarketClient();
let channelSerial = 0;
export function useMarketState() {
  const [state, setState] = useState(marketClient.state);
  useEffect(() => marketClient.subscribe(() => setState(marketClient.state)), []);
  return state;
}

export function useMarketQuery<T>(action: string, params: object, refreshMs: number, enabled = true) {
  const state = useMarketState();
  const [result, setResult] = useState<MarketResult<T>>();
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const channel = useRef(`query-${++channelSerial}`);
  const refreshRef = useRef<() => void>(() => {});
  const serialized = JSON.stringify(params); const previous = useRef('');
  useEffect(() => {
    const key = action + serialized;
    if (previous.current !== key) { previous.current = key; setResult(undefined); setError(''); }
    if (!enabled || !state.visible) { setLoading(false); refreshRef.current = () => {}; return; }
    let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined; let current: AbortController | undefined;
    const run = async (force = false) => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      current?.abort(); const controller = new AbortController(); current = controller;
      setLoading(true); setError('');
      try {
        const value = await marketClient.request<MarketResult<T>>(action, JSON.parse(serialized), channel.current, controller.signal, force);
        if (!stopped && current === controller) setResult(value);
      } catch (failure) { if (!stopped && !controller.signal.aborted && (failure as Error).name !== 'AbortError' && marketClient.state.visible) setError((failure as Error).message); }
      finally {
        if (!stopped && current === controller) { setLoading(false); if (refreshMs > 0) timer = setTimeout(() => { void run(); }, refreshMs); }
      }
    };
    refreshRef.current = () => { void run(true); }; void run();
    return () => { stopped = true; if (timer) clearTimeout(timer); current?.abort(); refreshRef.current = () => {}; };
  }, [action, serialized, refreshMs, enabled, state.visible]);
  const refresh = useCallback(() => refreshRef.current(), []);
  return { result, error, loading, refresh };
}

export function useMarketActions() {
  const [busy, setBusy] = useState<string[]>([]); const [error, setError] = useState('');
  const controllers = useRef(new Map<string, AbortController>()); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; const active = controllers.current; return () => { mounted.current = false; active.forEach(controller => controller.abort()); active.clear(); }; }, []);
  const act = async (action: 'follow' | 'addStock', code: string, follow?: boolean) => {
    const key = `${action}-${code}`;
    if (controllers.current.has(key)) return;
    const controller = new AbortController(); controllers.current.set(key, controller);
    setBusy(keys => [...keys, code]); setError('');
    try { await marketClient.request(action, { code, follow }, key, controller.signal); }
    catch (failure) { if (mounted.current && !controller.signal.aborted && (failure as Error).name !== 'AbortError') setError((failure as Error).message); }
    finally { controllers.current.delete(key); if (mounted.current) setBusy(keys => keys.filter(key => key !== code)); }
  };
  return { busy, error, act };
}
