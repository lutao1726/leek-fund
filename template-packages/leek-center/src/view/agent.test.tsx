import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import LeekAgent from './agent';
import { postMessage } from '@/utils/common';
jest.mock('@/utils/common', () => ({ postMessage: jest.fn() }));
const emit = (command: string, data: any) => act(() => { window.dispatchEvent(new MessageEvent('message', { data: { command, data } })); });
const snapshot = (status = 'completed') => ({ sessions: [{ id: 'one', title: '当前会话', updatedAt: '' }], selected: { id: 'one', title: '当前会话', updatedAt: '', messages: [{ id: 'answer', role: 'assistant', text: '原始文字 <script>不可执行</script>', status, model: '测试 IDE', stage: status === 'running' ? '正在生成' : '已完成', traces: [{ id: 'E1', tool: 'quote', at: '2026-11-06T07:00:00Z', content: '{"price":100,"quoteTime":"2026-11-06 15:00:00"}' }] }] }, models: [{ id: 'ide:test', name: '测试 IDE', source: 'ide' }], skills: [{ slash: 'explain', name: '个股解读', source: '内置', description: '核对资料' }] });
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }) });
  const style = window.getComputedStyle; window.getComputedStyle = element => style(element);
});
test('discovers models, fills Skills, retains failed input and clears only accepted text', () => {
  render(<LeekAgent />); expect(postMessage).toHaveBeenCalledWith('getAgent'); expect(postMessage).toHaveBeenCalledWith('agentModels'); emit('agentState', snapshot());
  fireEvent.click(screen.getByText('/explain · 个股解读'));
  const input = screen.getByLabelText('向 LeekAgent 提问'); expect(input).toHaveValue('/explain ');
  fireEvent.change(input, { target: { value: '/explain sh600519' } });
  fireEvent.click(screen.getByRole('button', { name: /发\s*送/ })); expect(postMessage).toHaveBeenCalledWith('agentSend', { text: '/explain sh600519', model: 'ide:test' });
  emit('agentError', '模型暂不可用'); expect(input).toHaveValue('/explain sh600519');
  emit('agentAccepted', { text: '/explain sh600519' }); expect(input).toHaveValue('');
});
test('shows source evidence safely, stops running streams and exports the selected session', () => {
  const { container } = render(<LeekAgent />); emit('agentState', snapshot('running'));
  expect(screen.getByText('原始文字 <script>不可执行</script>')).toBeInTheDocument(); expect(container.querySelector('script')).toBeNull();
  expect(screen.getByRole('button', { name: /发\s*送/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '停止生成' })); expect(postMessage).toHaveBeenCalledWith('agentStop');
  fireEvent.click(screen.getByText('数据工具与原始证据（1）')); expect(screen.getByText('E1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /导\s*出/ })); expect(postMessage).toHaveBeenCalledWith('agentExport');
});
