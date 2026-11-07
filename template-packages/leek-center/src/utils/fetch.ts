import { uniqueAlphaNumericId } from './uuid';
import { postMessage } from './common';
import { AxiosRequestConfig, AxiosPromise } from 'axios';
import * as hexin from '@/libs/hexin-v';
import { RequestBridge } from './requestBridge';

const bridge = new RequestBridge(postMessage);
export const receiveFetchResponse = (reply: any) => bridge.receive(reply);
window.addEventListener('pagehide', () => bridge.dispose());
window.addEventListener('unload', () => bridge.dispose());

export default function fetch(
  option: AxiosRequestConfig & { sessionId?: string; signal?: AbortSignal }
): AxiosPromise<any> {
  option.headers = option.headers || {};

  option.headers['User-Agent'] =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.141 Safari/537.36';
  option.headers['Accept-Language'] = 'zh-CN,zh;q=0.9,en;q=0.8';

  const { signal, cancelToken, ...request } = option;
  const timeout = Math.min(30000, Math.max(1000, Number(option.timeout) || 15000));
  return bridge.request(uniqueAlphaNumericId(), { ...request, timeout }, timeout + 1000, signal) as AxiosPromise;

}

/**
 * 同花顺
 */
export function fetchHexin(option: AxiosRequestConfig) {
  if (!hexin.getHexinToken) {
    throw new Error('getHexinToken undefined');
  }
  option.headers = option.headers || {};
  option.headers['X-Requested-With'] = 'XMLHttpRequest';
  option.headers['hexin-v'] = hexin.getHexinToken();

  return fetch(option)
}
