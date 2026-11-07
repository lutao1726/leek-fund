import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Research from './research';
import { postMessage } from '@/utils/common';

jest.mock('@/utils/common', () => ({ postMessage: jest.fn() }));
jest.mock('@/stores', () => ({ __esModule: true, default: { stock: { stocks: [] } } }));
const emit = (command: string, data: any) => act(() => { window.dispatchEvent(new MessageEvent('message', { data: { command, data } })); });
const report = { summary: '需要核对趋势延续', support: ['[S1] 行情证据'], counter: ['缺少财报'], conditions: ['核对下一交易日量价'], invalidation: ['结构失效则重审'], limitations: ['资料覆盖有限'] };
const summary = { version: 1, id: 'job1', kind: 'stock', title: '测试股票 · 个股研究', status: 'running', stage: '生成研究报告', completed: 0, total: 1, createdAt: '2026-11-06T07:00:00Z', model: 'test-model', range: '3m', usage: [] };
const mount = () => render(<MemoryRouter initialEntries={['/research?job=job1']}><Research /></MemoryRouter>);
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }) });
  const computedStyle = window.getComputedStyle;
  window.getComputedStyle = element => computedStyle(element);
});
beforeEach(() => jest.clearAllMocks());

test('loads history and selected detail; unmounting does not cancel extension jobs', () => {
  const view = mount();
  expect(postMessage).toHaveBeenCalledWith('getResearch');
  expect(postMessage).toHaveBeenCalledWith('selectResearch', { id: 'job1' });
  view.unmount();
  expect(postMessage).not.toHaveBeenCalledWith('cancelResearch', expect.anything());
});
test('starts portfolio inspection and shows configuration errors', () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: '一键持仓巡检' }));
  expect(postMessage).toHaveBeenCalledWith('startPortfolioResearch', undefined);
  emit('researchActionResult', { success: false, error: '请先配置模型' });
  expect(screen.getAllByText('请先配置模型').length).toBeGreaterThan(0);
});
test('shows structured report, source evidence and cancellation actions', () => {
  mount(); emit('researchState', { jobs: [summary] });
  emit('researchDetail', { ...summary, request: { stocks: [], quotes: [] }, stocks: [{ code: 'sh600519', name: '测试股票', report,
    evidence: { capturedAt: '2026-11-06T07:00:00Z', limitations: ['原始资料有限'], sources: [{ id: 'S1', title: '行情快照', status: 'available', content: '原始行情120', fetchedAt: '2026-11-06T07:00:00Z', asOf: '2026-11-06 15:00:00' }] } }] });
  expect(screen.getByText('需要核对趋势延续')).toBeInTheDocument();
  expect(screen.getByText('反对依据')).toBeInTheDocument();
  expect(screen.getByText('判断失效条件')).toBeInTheDocument();
  fireEvent.click(screen.getByText('原始证据、来源与时间'));
  expect(screen.getByText('原始行情120')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '取消任务' }));
  expect(postMessage).toHaveBeenCalledWith('cancelResearch', { id: 'job1' });
});
test('retains partial reports and offers retry and Markdown export', () => {
  mount(); const partial = { ...summary, status: 'partial', completed: 1, error: '部分数据缺失' };
  emit('researchState', { jobs: [partial] });
  emit('researchDetail', { ...partial, stocks: [{ code: 'sh600519', name: '测试股票', report }] });
  expect(screen.getByText('部分数据缺失')).toBeInTheDocument();
  expect(screen.getByText('需要核对趋势延续')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '导出 Markdown' }));
  expect(postMessage).toHaveBeenCalledWith('exportResearch', { id: 'job1' });
  fireEvent.click(screen.getByRole('button', { name: '按最新数据重新分析' }));
  expect(postMessage).toHaveBeenCalledWith('retryResearch', { id: 'job1' });
});
