import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import DailySummary from './daily-summary';
import { postMessage } from '@/utils/common';
import { filterSummaryRows, filterSummaryNews } from '@/utils/dailySummary';
jest.mock('@/utils/common', () => ({ postMessage: jest.fn() }));
const emit = (command: string, data: any) => act(() => { window.dispatchEvent(new MessageEvent('message', { data: { command, data } })); });
const row = { code: 'sh600519', name: '测试股票', watched: true, held: true, equity: true, currency: 'CNY', price: 120, percent: -4, turnover: 10000, quoteDate: '2026-11-06', quoteTime: '2026-11-06 15:00:00', latestReport: { jobId: 'old', at: '2026-10-30T07:00:00Z', ageDays: 8, old: true, summary: '旧报告' } };
const snapshot: any = { date: '2026-11-07', generatedAt: '2026-11-07T00:00:00Z', rows: [row], currencies: [], counts: { watched: 1, held: 1, quoted: 1, missing: 0, moving: 1, researched: 1, activeResearch: 0 }, quoteDates: ['2026-11-06'], notes: [], news: { items: [], cached: 0, matched: 0, today: 0 } };
const mount = () => render(<MemoryRouter initialEntries={['/daily-summary']}><Route exact path="/daily-summary"><DailySummary /></Route><Route path="/research">已打开报告</Route></MemoryRouter>);
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }) });
  const computed = window.getComputedStyle; window.getComputedStyle = element => computed(element);
});
beforeEach(() => jest.clearAllMocks());
test('subscribes on mount and unsubscribes on exit', () => { const view = mount(); expect(postMessage).toHaveBeenCalledWith('startDailySummary'); view.unmount(); expect(postMessage).toHaveBeenCalledWith('stopDailySummary'); });
test('displays old quote date and opens stock details', () => { mount(); emit('dailySummarySnapshot', snapshot); expect(screen.getByText('历史报价')).toBeInTheDocument(); expect(screen.getByText('已满7个自然日')).toBeInTheDocument(); fireEvent.click(screen.getByText('测试股票')); expect(postMessage).toHaveBeenCalledWith('openDailySummaryStock', { code: row.code }); });
test('refresh failure preserves existing content', () => { mount(); emit('dailySummarySnapshot', snapshot); fireEvent.click(screen.getByRole('button', { name: '刷新行情' })); expect(postMessage).toHaveBeenCalledWith('refreshDailySummary'); emit('dailySummaryError', '刷新失败，保留缓存'); expect(screen.getByText('测试股票')).toBeInTheDocument(); expect(screen.getByText('刷新失败，保留缓存')).toBeInTheDocument(); });
test('existing report navigates to the research page', () => { mount(); emit('dailySummarySnapshot', snapshot); fireEvent.click(screen.getByRole('button', { name: '查看报告' })); expect(screen.getByText('已打开报告')).toBeInTheDocument(); });
test('searching removes nonmatching rows', () => { mount(); emit('dailySummarySnapshot', snapshot); fireEvent.change(screen.getByLabelText('搜索摘要标的'), { target: { value: '无关名称' } }); expect(screen.queryByText('测试股票')).not.toBeInTheDocument(); });
test('sorting keeps missing values last and turnover separates currency', () => {
  const rows: any[] = [row, { ...row, code: 'hk00700', currency: 'HKD', percent: 8, turnover: 100000 }, { ...row, code: 'sz000001', percent: undefined, turnover: undefined }];
  const options = { scope: 'all', search: '', sort: 'down', currency: 'CNY', moving: false };
  expect(filterSummaryRows(rows, options).map(item => item.code)).toEqual(['sh600519', 'hk00700', 'sz000001']);
  expect(filterSummaryRows(rows, { ...options, sort: 'turnover' }).map(item => item.code)).toEqual(['sh600519', 'sz000001']);
});
test('news date filters use publication date, with unknown dates only in all-cache view', () => {
  const value = { ...snapshot, news: { items: [{ id: 'today', date: '2026-11-07', matches: [{ held: true }] }, { id: 'old', date: '2026-11-06', matches: [{ held: false }] }, { id: 'unknown', matches: [] }] } };
  expect(filterSummaryNews(value as any, 'today', false).map(item => item.id)).toEqual(['today']);
  expect(filterSummaryNews(value as any, 'recent', false).map(item => item.id)).toEqual(['today', 'old']);
  expect(filterSummaryNews(value as any, 'all', true).map(item => item.id)).toEqual(['today']);
});
