import { useCallback, useEffect, useRef } from 'react';
import { postMessage } from '@/utils/common';
let serial = 0;
export function useLearningClient() {
  const pending = useRef(new Map<string, { finish: (error?: string, result?: any) => void }>());
  useEffect(() => {
    const requests = pending.current;
    const receive = (event: MessageEvent) => {
      if (event.source && event.source !== window) return;
      if (event.data?.command !== 'learningResult') return;
      const { id, error, result } = event.data.data || {};
      requests.get(id)?.finish(error, result);
    };
    window.addEventListener('message', receive);
    return () => {
      window.removeEventListener('message', receive);
      requests.forEach(request => request.finish('页面已关闭'));
    };
  }, []);
  return useCallback(<T,>(command: string, data: object = {}, timeoutMs = 45000): Promise<T> => {
    const id = `learning-${++serial}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish('请求超时，请重试'), timeoutMs);
      const finish = (error?: string, result?: T) => {
        if (!pending.current.delete(id)) return;
        clearTimeout(timer);
        if (error) reject(new Error(error)); else resolve(result!);
      };
      pending.current.set(id, { finish });
      try { postMessage(command, { ...data, id }); } catch (error) { finish((error as Error).message); }
    });
  }, []);
}
