import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Switch, useLocation } from 'react-router-dom';
import SectorBoards from './sector-boards';
import MarketCloudMap from './market-map';
import StockChanges from './stock-changes';
import { useMarketActions, useMarketQuery, useMarketState } from '@/services/market';

jest.mock('@/services/market', () => ({ useMarketActions: jest.fn(), useMarketQuery: jest.fn(), useMarketState: jest.fn() }));
const actions = jest.fn(); const refresh = jest.fn();
const board = { code: 'BK0475', name: '银行Ⅱ', kind: 'industry', price: 4485, percent: 1, marketCap: 1e12, netInflow: 8e8, turnoverRate: 1 };
const stock = { code: 'sh600519', name: '贵州茅台', price: 100, percent: 1, marketCap: 1e11 };
const snapshot = (data: any) => ({ result: { data, fetchedAt: '2026-11-07T00:00:00Z', asOf: '2026-11-06T07:00:00Z', stale: false }, error: '', loading: false, refresh });
function Location() { const location = useLocation(); return <div data-testid="location">{location.pathname}{location.search}</div>; }
const page = (path: string) => render(<MemoryRouter initialEntries={[path]}><Switch><Route path="/sector-boards/:bkCode?" component={SectorBoards} /><Route path="/market-map" component={MarketCloudMap} /><Route path="/stock-changes" component={StockChanges} /></Switch><Location /></MemoryRouter>);
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: (query: string) => ({ matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) });
  const computed = window.getComputedStyle; window.getComputedStyle = element => computed(element);
});
beforeEach(() => {
  jest.clearAllMocks();
  (useMarketActions as jest.Mock).mockReturnValue({ busy: [], error: '', act: actions });
  (useMarketState as jest.Mock).mockReturnValue({ visible: true, followedBoards: [], watchedCodes: [], changeTypes: [{ type: 8201, label: '火箭发射', direction: 'up' }, { type: 8204, label: '加速下跌', direction: 'down' }] });
  (useMarketQuery as jest.Mock).mockImplementation((action, params) => {
    if (action === 'overview') return snapshot({ industry: [board], concept: [{ ...board, code: 'BK0477', name: '酿酒概念', kind: 'concept' }], errors: [], partial: false });
    if (action === 'boardQuote') return snapshot(board);
    if (['members', 'universe', 'leaders'].includes(action)) return snapshot({ items: [stock], total: 1, page: 1, pageSize: 100 });
    if (action === 'profile') return snapshot({ code: params.code, name: '贵州茅台', company: '测试企业', description: '公开企业简介', industry: '食品饮料', concepts: ['酿酒概念'], quote: stock, errors: [] });
    if (action === 'changes') {
      const rows = [{ id: 'up', code: 'sh600519', name: '贵州茅台', direction: 'up', type: 8201, label: '火箭发射', time: '09:31:00' }, { id: 'down', code: 'sz000001', name: '测试股票', direction: 'down', type: 8204, label: '加速下跌', time: '09:32:00' }];
      return snapshot({ items: rows.filter(row => params.direction === 'all' || row.direction === params.direction), total: 2, page: 1, pageSize: 100 });
    }
    return { loading: false, error: '', refresh };
  });
});
test('boards can be followed, opened, and their constituents added to the existing watchlist', () => {
  page('/sector-boards');
  const row = screen.getByRole('row', { name: /银行Ⅱ.*BK0475/ });
  fireEvent.click(within(row).getByRole('button', { name: /关\s*注/ }));
  expect(actions).toHaveBeenCalledWith('follow', 'BK0475', true);
  fireEvent.click(within(row).getByRole('button', { name: /银行Ⅱ.*BK0475/ }));
  expect(screen.getByTestId('location')).toHaveTextContent('/sector-boards/BK0475');
  expect(screen.getByText('成分股')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '加入自选' }));
  expect(actions).toHaveBeenCalledWith('addStock', 'sh600519');
});
test('heatmap drills from board area to constituent stocks and back to the board table', () => {
  page('/market-map');
  fireEvent.click(screen.getByRole('button', { name: '银行Ⅱ +1.00%' }));
  expect(screen.getByTestId('location')).toHaveTextContent('/market-map?board=BK0475');
  expect(screen.getByText(/当前展示第 1 页/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '贵州茅台 +1.00%' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '板块行情' }));
  expect(screen.getByTestId('location')).toHaveTextContent('/sector-boards/BK0475');
});
test('anomaly direction filtering preserves unknown dates and exposes company/concept navigation', () => {
  page('/stock-changes');
  expect(screen.getAllByText(/交易日期未提供/).length).toBeGreaterThan(0);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '异动方向' }));
  fireEvent.click(screen.getByText('看跌类信号'));
  expect(useMarketQuery).toHaveBeenCalledWith('changes', expect.objectContaining({ direction: 'down', page: 1 }), 15000);
  expect(screen.queryByText('火箭发射')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '企业简介与概念' }));
  expect(screen.getByText('公开企业简介')).toBeInTheDocument();
  fireEvent.click(screen.getByText('酿酒概念'));
  expect(screen.getByTestId('location')).toHaveTextContent('/sector-boards?kind=concept&kw=');
});
