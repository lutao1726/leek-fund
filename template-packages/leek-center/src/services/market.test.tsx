import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MarketClient, marketClient, useMarketQuery } from './market';
import { postMessage } from '@/utils/common';
jest.mock('@/utils/common', () => ({ postMessage: jest.fn() }));
const emit = (command: string, data: any) => act(() => { window.dispatchEvent(new MessageEvent('message', { data: { command, data } })); });
const state = (visible: boolean) => ({ visible, watchedCodes: [], followedBoards: [], changeTypes: [] });
const value = (name: string) => ({ data: { name }, fetchedAt: '2026-11-07T00:00:00Z', stale: false });
const calls = () => (postMessage as jest.Mock).mock.calls.filter(([command]) => command === 'marketRequest').map(([, data]) => data);
function Probe({ page = 1 }: { page?: number }) { const query = useMarketQuery<{ name: string }>('members', { code: 'BK0475', page }, 1000); return <div>{query.result?.data.name || 'empty'}{query.error}</div>; }
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); marketClient.state = state(true); });
afterEach(() => { act(() => { window.dispatchEvent(new Event('pagehide')); }); jest.useRealTimers(); });

test('request replacement settles the old promise and ignores obsolete replies', async () => {
  const send = jest.fn(); const client = new MarketClient(send); const controller = new AbortController();
  const first = client.request('members', {}, 'same', controller.signal);
  const firstError = expect(first).rejects.toThrow('更新操作替代');
  const oldId = send.mock.calls.find(([command]) => command === 'marketRequest')![1].id;
  const second = client.request('members', {}, 'same', controller.signal);
  const newId = send.mock.calls.filter(([command]) => command === 'marketRequest')[1][1].id;
  emit('marketReply', { id: oldId, success: true, value: 'old' });
  emit('marketReply', { id: newId, success: true, value: 'new' });
  await firstError; await expect(second).resolves.toBe('new'); expect(jest.getTimerCount()).toBe(0); client.dispose();
});
test('cancellation settles callbacks even when a closing bridge throws', async () => {
  const send = jest.fn((command: string) => { if (command === 'cancelMarket') throw new Error('closed'); });
  const client = new MarketClient(send); const controller = new AbortController();
  const result = client.request('members', {}, 'query', controller.signal); const rejected = expect(result).rejects.toThrow('取消');
  controller.abort(); await rejected; expect(jest.getTimerCount()).toBe(0); client.dispose();
});
test('query polling never overlaps and stops while the editor panel is hidden', async () => {
  const view = render(<Probe />); expect(calls().length).toBe(1);
  act(() => { jest.advanceTimersByTime(5000); }); expect(calls().length).toBe(1);
  await act(async () => { emit('marketReply', { id: calls()[0].id, success: true, value: value('first') }); await Promise.resolve(); });
  expect(screen.getByText('first')).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(1001); }); expect(calls().length).toBe(2);
  await act(async () => { emit('marketState', state(false)); await Promise.resolve(); });
  act(() => { jest.advanceTimersByTime(60000); }); expect(calls().length).toBe(2);
  await act(async () => { emit('marketState', state(true)); await Promise.resolve(); });
  expect(calls().length).toBe(3);
  await act(async () => { view.unmount(); await Promise.resolve(); });
  expect(postMessage).toHaveBeenCalledWith('cancelMarket', calls()[2].id);
  act(() => { jest.advanceTimersByTime(60000); }); expect(calls().length).toBe(3);
});
test('switching constituent pages cannot paint the previous page response', async () => {
  const view = render(<Probe page={1} />); const oldId = calls()[0].id;
  view.rerender(<Probe page={2} />); const current = calls()[calls().length - 1];
  expect(current.params.page).toBe(2);
  await act(async () => { emit('marketReply', { id: oldId, success: true, value: value('old-page') }); emit('marketReply', { id: current.id, success: true, value: value('new-page') }); await Promise.resolve(); });
  expect(screen.queryByText('old-page')).not.toBeInTheDocument(); expect(screen.getByText('new-page')).toBeInTheDocument(); view.unmount();
});
