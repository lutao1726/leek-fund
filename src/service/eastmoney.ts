import axios, { CancelToken, CancelTokenSource } from 'axios';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { Socket } from 'net';
import { get } from 'https';

export type DashboardData = Record<string, unknown>;
type MarketRow = { f14: string; f174: number | string };
const DASHBOARD_ORIGIN = 'https://view.le5le.com';
const DATA_PATH = '/api/stock/data';
const excludedNames = ['深成', '昨日涨停', '沪股通', 'MSCI中国', '央国企改革', '标准普尔', '创业板综', '富时罗素', '深股通', '融资融券', 'S300', '沪深'];
const coordinates: Record<string, number[]> = {
  北京: [116.405285, 39.904989], 天津: [117.190182, 39.125596], 河北: [114.502461, 38.045474],
  山西: [112.549248, 37.857014], 内蒙古: [111.670801, 40.818311], 辽宁: [123.429096, 41.796767],
  吉林: [125.3245, 43.886841], 黑龙江: [126.642464, 45.756967], 上海: [121.472644, 31.231706],
  江苏: [118.767413, 32.041544], 浙江: [120.153576, 30.287459], 安徽: [117.283042, 31.86119],
  福建: [119.306239, 26.075302], 江西: [115.892151, 28.676493], 山东: [117.000923, 36.675807],
  河南: [113.665412, 34.757975], 湖北: [114.298572, 30.584355], 湖南: [112.982279, 28.19409],
  广东: [113.280637, 23.125178], 广西: [108.320004, 22.82402], 海南: [110.33119, 20.031971],
  重庆: [106.504962, 29.533155], 四川: [104.065735, 30.659462], 贵州: [106.713478, 26.578343],
  云南: [102.712251, 25.040609], 西藏: [91.132212, 29.660361], 陕西: [108.948024, 34.263161],
  甘肃: [103.823557, 36.058039], 青海: [101.778916, 36.623178], 宁夏: [106.278179, 38.46637],
  新疆: [87.617733, 43.792818], 台湾: [121.509062, 25.044332],
};

function fetchMarket(type: number, cancelToken: CancelToken): Promise<MarketRow[]> {
  return new Promise((resolve, reject) => {
    cancelToken.throwIfRequested();
    let settled = false;
    let timeout: NodeJS.Timeout;
    const finish = (error?: Error, rows?: MarketRow[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(rows || []);
    };
    const url = `https://data.eastmoney.com/dataapi/bkzj/getbkzj?key=f174&code=m%3A90%2Bt%3A${type}`;
    const request = get(url, { timeout: 10000 }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        finish(new Error(`资金流接口返回 ${response.statusCode}`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('error', error => finish(error));
      response.on('end', () => {
        try {
          const rows = JSON.parse(body)?.data?.diff;
          if (!Array.isArray(rows)) throw new Error('资金流数据格式异常');
          finish(undefined, rows.filter((row: MarketRow) => row && typeof row.f14 === 'string' &&
            (typeof row.f174 === 'number' || (typeof row.f174 === 'string' && row.f174.trim() !== '')) &&
            Number.isFinite(Number(row.f174))));
        } catch (error) {
          finish(error instanceof Error ? error : new Error('资金流数据解析失败'));
        }
      });
    });
    const abort = () => request.destroy(new Error('资金流请求已取消或超时'));
    timeout = setTimeout(abort, 10000);
    request.on('timeout', abort);
    request.on('error', error => finish(error));
    cancelToken.promise.then(() => { if (!settled) abort(); });
  });
}

function chartData(rows: MarketRow[], prefix: string, fixedPadding?: number): DashboardData {
  const values = rows.map(row => Number((Number(row.f174) / 100000000).toFixed(2)));
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 0;
  const padding = fixedPadding ?? (Math.max(Math.abs(minimum), Math.abs(maximum)) / 4 || 1);
  return {
    [`${prefix}_xAxis`]: rows.map(row => row.f14),
    [`${prefix}_seriesData`]: values,
    [`${prefix}_min`]: Math.floor(minimum - padding),
    [`${prefix}_max`]: Math.ceil(maximum + padding),
  };
}

export async function fetchDashboardData(cancelToken: CancelToken): Promise<DashboardData> {
  const [regions, concepts, industries] = await Promise.all([1, 3, 2].map(type => fetchMarket(type, cancelToken)));
  const rank = (rows: MarketRow[]) => rows.filter(row => !excludedNames.some(name => row.f14.includes(name)))
    .sort((a, b) => Number(b.f174) - Number(a.f174));
  const rankedConcepts = rank(concepts);
  return {
    ...chartData(regions, 'bk', 50),
    ...chartData(rankedConcepts.slice(0, 10), 'gn_top'),
    ...chartData(rankedConcepts.slice(-6), 'gn_bottom'),
    ...chartData(rank(industries).slice(0, 10), 'hy_top'),
    map_echarts_data: regions.filter(row => coordinates[row.f14.replace(/板块$/, '')]).map(row => ({
      label: row.f14,
      name: Number((Number(row.f174) / 100000000).toFixed(2)),
      value: coordinates[row.f14.replace(/板块$/, '')],
    })),
  };
}

export class EastMoneyDataServer {
  private server?: Server;
  private readonly owners = new Set<object>();
  private readonly sockets = new Set<Socket>();
  private lifecycle: Promise<void> = Promise.resolve();
  private pending?: Promise<DashboardData>;
  private cancelSource?: CancelTokenSource;
  private cache?: { data: DashboardData; expiresAt: number };
  private generation = 0;
  private readonly port: number;
  private readonly cacheMs: number;
  private readonly load: (token: CancelToken) => Promise<DashboardData>;

  constructor(options: { port?: number; cacheMs?: number; load?: (token: CancelToken) => Promise<DashboardData> } = {}) {
    // The embedded le5le dashboard subscribes to localhost:17100.
    this.port = options.port ?? 17100;
    this.cacheMs = options.cacheMs ?? 5000;
    this.load = options.load ?? fetchDashboardData;
  }

  get url(): string | undefined {
    const address = this.server?.address();
    return address && typeof address !== 'string' ? `http://127.0.0.1:${address.port}${DATA_PATH}` : undefined;
  }

  acquire(owner: object): Promise<void> {
    this.owners.add(owner);
    return this.enqueue(async () => {
      if (!this.owners.has(owner)) return;
      try {
        await this.start();
      } catch (error) {
        this.owners.delete(owner);
        throw error;
      }
    });
  }

  release(owner: object): Promise<void> {
    this.owners.delete(owner);
    return this.enqueue(async () => {
      if (this.owners.size === 0) await this.stop();
    });
  }

  dispose(): Promise<void> {
    this.owners.clear();
    return this.enqueue(() => this.stop());
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const result = this.lifecycle.then(task);
    this.lifecycle = result.catch(() => {});
    return result;
  }

  private async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((request, response) => { void this.respond(request, response); });
    server.on('connection', socket => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException) => {
          const message = error.code === 'EADDRINUSE' ? `资金大屏端口 ${this.port} 已被占用，请关闭其他插件窗口后重试` : `资金大屏服务启动失败：${error.message}`;
          reject(new Error(message));
        };
        server.once('error', onError);
        server.listen(this.port, '127.0.0.1', () => {
          server.off('error', onError);
          server.on('error', error => console.error('资金大屏服务错误', error));
          resolve();
        });
      });
      this.server = server;
    } catch (error) {
      server.close();
      throw error;
    }
  }

  private async stop(): Promise<void> {
    this.generation++;
    this.cache = undefined;
    this.pending = undefined;
    this.cancelSource?.cancel('资金大屏已关闭');
    this.cancelSource = undefined;
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>(resolve => {
      server.close(() => resolve());
      this.sockets.forEach(socket => socket.destroy());
      this.sockets.clear();
    });
  }

  private data(): Promise<DashboardData> {
    if (this.cache && this.cache.expiresAt > Date.now()) return Promise.resolve(this.cache.data);
    if (this.pending) return this.pending;
    const generation = this.generation;
    const source = axios.CancelToken.source();
    this.cancelSource = source;
    const pending = Promise.resolve().then(() => this.load(source.token)).then(data => {
      if (this.generation === generation) this.cache = { data, expiresAt: Date.now() + this.cacheMs };
      return data;
    }).catch(error => {
      source.cancel('资金流请求失败');
      throw error;
    }).finally(() => {
      if (this.pending === pending) {
        this.pending = undefined;
        this.cancelSource = undefined;
      }
    });
    this.pending = pending;
    return pending;
  }

  private async respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const origin = request.headers.origin;
    if (origin && origin !== DASHBOARD_ORIGIN) {
      response.writeHead(403).end();
      return;
    }
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
    response.setHeader('Cache-Control', 'no-store');
    if (request.url?.split('?')[0] !== DATA_PATH) {
      response.writeHead(404).end();
      return;
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET, OPTIONS');
      response.writeHead(405).end();
      return;
    }
    try {
      const data = await this.data();
      if (!response.destroyed) {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(data));
      }
    } catch (error) {
      if (!response.destroyed) {
        response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: '资金流数据暂不可用，请稍后重试' }));
      }
    }
  }
}

export const eastMoneyDataServer = new EastMoneyDataServer();
