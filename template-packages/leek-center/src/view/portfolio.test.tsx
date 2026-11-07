import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Portfolio from './portfolio';
import { postMessage } from '@/utils/common';

jest.mock('@/utils/common', () => ({ postMessage: jest.fn() }));
jest.mock('@/stores', () => ({ __esModule: true, default: { stock: { stocks: [] } } }));
const emit = (command: string, data: any) => act(() => { window.dispatchEvent(new MessageEvent('message', { data: { command, data } })); });
const row = { code: 'sh600519', name: '测试股票', amount: 10, unitPrice: 100, currency: 'CNY', cost: 1000, marketValue: 1200, price: 120, profit: 200, profitPercent: 20, todayProfit: 100, quoteTime: '2026-11-07 15:00:00' };

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }) });
  const computedStyle = window.getComputedStyle;
  window.getComputedStyle = element => computedStyle(element);
});
beforeEach(() => jest.clearAllMocks());

test('loads the ledger and shows per-currency partial valuations', () => {
  render(<Portfolio />);
  expect(postMessage).toHaveBeenCalledWith('getPortfolio');
  emit('portfolioSnapshot', { rows: [row], totals: [{ currency: 'CNY', cost: 1000, marketValue: 1200, profit: 200, todayProfit: 100, missingQuotes: 1 }, { currency: 'USD', cost: 100, marketValue: 110, profit: 10, todayProfit: 5, missingQuotes: 0 }] });
  expect(screen.getByText('测试股票')).toBeInTheDocument();
  expect(screen.getByText('行情不完整')).toBeInTheDocument();
  expect(screen.getByText('USD 资产')).toBeInTheDocument();
});

test('saves through the bridge, retains form on error and closes on success', async () => {
  render(<Portfolio />);
  fireEvent.click(screen.getByText('新增持仓'));
  fireEvent.change(screen.getByLabelText('股票代码'), { target: { value: 'sh600519' } });
  fireEvent.change(screen.getByLabelText('股票名称'), { target: { value: '测试股票' } });
  fireEvent.change(screen.getByLabelText('持仓数量'), { target: { value: '10' } });
  fireEvent.change(screen.getByLabelText('平均成本价（股票原币种）'), { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(postMessage).toHaveBeenCalledWith('portfolioAction', { action: 'save', position: { code: 'sh600519', name: '测试股票', amount: 10, unitPrice: 100, isSellOut: false } }));
  emit('portfolioResult', { success: false, error: '保存失败，请重试' });
  expect(screen.getByLabelText('股票代码')).toHaveValue('sh600519');
  emit('portfolioResult', { success: true });
  await waitFor(() => expect(screen.queryByLabelText('股票代码')).not.toBeInTheDocument());
});

test('closing a position sends its execution price, not a zero quantity', async () => {
  render(<Portfolio />);
  emit('portfolioSnapshot', { rows: [row], totals: [] });
  fireEvent.click(screen.getByRole('button', { name: /清\s*仓/ }));
  fireEvent.change(screen.getByLabelText('清仓成交价'), { target: { value: '125' } });
  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(postMessage).toHaveBeenCalledWith('portfolioAction', { action: 'close', code: 'sh600519', amount: undefined, price: 125 }));
});
