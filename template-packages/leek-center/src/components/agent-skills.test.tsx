import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import AgentSkills from './agent-skills';
import { postMessage } from '@/utils/common';
import type { AgentState } from '../../../../src/shared/agent';
jest.mock('@/utils/common', () => ({ postMessage: jest.fn() }));
const emit = (command: string, data: any) => act(() => { window.dispatchEvent(new MessageEvent('message', { data: { command, data } })); });
const state: AgentState = { sessions: [], models: [], skills: [], skillCatalog: [
  { id: 'builtin-scan', name: '板块扫描', slash: 'scan', description: '内置板块热度', instruction: '', tools: ['sectors'], source: '内置', builtin: true, removable: false, enabled: true },
  { id: 'custom', name: '自定义复盘', slash: 'review', description: '导入的复盘流程', instruction: '', tools: ['news'], source: '用户', builtin: false, removable: true, enabled: false },
] };
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }) });
  const style = window.getComputedStyle; window.getComputedStyle = element => style(element);
});
test('searches installed and builtin Skills and persists explicit enable requests', () => {
  render(<AgentSkills state={state} onUse={() => {}} />); fireEvent.click(screen.getByText('Skills 管理'));
  expect(screen.getByText('1/2 个已启用')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('搜索 Skill'), { target: { value: '复盘' } }); expect(screen.queryByText('板块扫描')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /使\s*用/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('switch', { name: '启用 自定义复盘' })); expect(postMessage).toHaveBeenCalledWith('agentSkillToggle', { id: 'custom', enabled: true });
  emit('agentSkillResult', { success: false, error: '保存失败' }); expect(screen.getByText('保存失败')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: '启用 自定义复盘' })).not.toBeChecked();
});
test('imports directories, ZIPs and GitHub repositories and surfaces partial results', () => {
  render(<AgentSkills state={state} onUse={() => {}} />); fireEvent.click(screen.getByText('Skills 管理'));
  fireEvent.click(screen.getByText('导入目录')); expect(postMessage).toHaveBeenCalledWith('agentSkillDirectory', {});
  emit('agentSkillResult', { cancelled: true });
  fireEvent.click(screen.getByText('导入 ZIP')); expect(postMessage).toHaveBeenCalledWith('agentSkillZip', {});
  emit('agentSkillResult', { success: true, result: { installed: ['review'], skipped: ['invalid：格式错误'] } }); expect(screen.getByText(/跳过 1 个/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('GitHub Skill 仓库'), { target: { value: 'https://github.com/example/skills' } });
  fireEvent.click(screen.getByText('从 GitHub 安装')); expect(postMessage).toHaveBeenCalledWith('agentSkillGithub', { url: 'https://github.com/example/skills' });
});
test('previews escaped instructions, confirms uninstall, and uses only enabled Skills', () => {
  const use = jest.fn(); render(<AgentSkills state={state} onUse={use} />); fireEvent.click(screen.getByText('Skills 管理'));
  fireEvent.click(screen.getAllByText('查看正文')[1]); expect(postMessage).toHaveBeenCalledWith('agentSkillDetail', { id: 'custom' });
  emit('agentSkillDetail', { ...state.skillCatalog![1], instruction: '<script>原文资料</script>' });
  expect(screen.getByText('<script>原文资料</script>')).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('dialog', { name: '自定义复盘 · /review' })).getByRole('button', { name: /关\s*闭/ }));
  fireEvent.click(screen.getByRole('button', { name: /卸\s*载/ })); fireEvent.click(screen.getByRole('button', { name: '确认卸载' })); expect(postMessage).toHaveBeenCalledWith('agentSkillUninstall', { id: 'custom' });
  emit('agentSkillResult', { success: true }); fireEvent.click(screen.getAllByRole('button', { name: /使\s*用/ })[0]); expect(use).toHaveBeenCalledWith('scan');
});
