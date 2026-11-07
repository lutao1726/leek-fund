import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Learning from './learning';
import LearningMarkdown from '@/components/learning-markdown';
import { postMessage } from '@/utils/common';
jest.mock('@/utils/common', () => ({ postMessage: jest.fn() }));
const first = { path: '交易体系/体系.md', title: '体系', category: '交易体系', topic: '交易体系', kind: 'md', sha: 'b'.repeat(40), size: 10 };
const second = { ...first, path: '游资心法/养家/学习笔记.md', title: '学习笔记', category: '游资心法', topic: '养家' };
const visual = { ...first, path: '可视化/周期.html', title: '周期', category: '可视化', topic: '可视化', kind: 'html' };
const catalog = { value: { revision: 'a'.repeat(40), fetchedAt: '2026-11-07T00:00:00Z', items: [first, second, visual] }, stale: false };
const last = (command: string) => (postMessage as jest.Mock).mock.calls.filter(call => call[0] === command).pop()![1];
const reply = async (command: string, result?: any, error?: string) => {
  const id = last(command).id;
  await act(async () => { window.dispatchEvent(new MessageEvent('message', { data: { command: 'learningResult', data: { id, result, error } } })); });
};
const article = (item = first, text = '正文内容') => ({ value: { path: item.path, sha: item.sha, fetchedAt: '2026-11-07T00:00:00Z', text }, stale: false });
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }) });
  const computed = window.getComputedStyle; window.getComputedStyle = element => computed(element);
});
beforeEach(() => jest.clearAllMocks());
test('loads the catalog then reads an article; refresh fetches both again', async () => {
  render(<Learning />); expect(postMessage).toHaveBeenCalledWith('learningCatalog', expect.objectContaining({ force: false }));
  await reply('learningCatalog', catalog); await reply('learningArticle', article()); expect(screen.getByText('正文内容')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /刷新内容/ })); expect(last('learningCatalog').force).toBe(true);
  await reply('learningCatalog', catalog); expect(last('learningArticle').force).toBe(true);
  await reply('learningArticle', article(first, '最新正文')); expect(screen.getByText('最新正文')).toBeInTheDocument();
});
test('refresh failures retain the displayed article and allow retry', async () => {
  render(<Learning />); await reply('learningCatalog', catalog); await reply('learningArticle', article());
  fireEvent.click(screen.getByRole('button', { name: /刷新内容/ })); await reply('learningCatalog', undefined, '网络失败');
  expect(screen.getByText('网络失败')).toBeInTheDocument(); expect(screen.getByText('正文内容')).toBeInTheDocument();
});
test('bundled fallback is explicitly labeled and remains readable on first-load failure', async () => {
  render(<Learning />);
  await reply('learningCatalog', { ...catalog, stale: true, source: 'bundled', error: '远程同步失败，显示插件内置目录（非最新同步）' });
  expect(screen.getByText('内置目录')).toBeInTheDocument(); expect(screen.getByText(/内置目录时间/)).toBeInTheDocument();
  expect(screen.queryByText(/上次同步/)).not.toBeInTheDocument();
  await reply('learningArticle', article()); expect(screen.getByText('正文内容')).toBeInTheDocument();
});
test('searches topics and loads the visual homepage inside the learning column', async () => {
  render(<Learning />); await reply('learningCatalog', catalog); await reply('learningArticle', article());
  fireEvent.change(screen.getByLabelText('搜索学习资料'), { target: { value: '周期' } });
  expect(screen.queryByRole('button', { name: /学习笔记/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /周期/ }));
  fireEvent.click(screen.getByRole('button', { name: '打开可视化' }));
  expect(screen.getByTitle('交易大师可视化学习站点')).toHaveAttribute('src', 'https://zhouqinglong520.github.io/trading-mastery/');
  const previous = screen.getByTitle('交易大师可视化学习站点'); fireEvent.click(screen.getByRole('button', { name: /刷新页面/ }));
  expect(screen.getByTitle('交易大师可视化学习站点')).not.toBe(previous);
  fireEvent.click(screen.getByRole('button', { name: /浏览器打开/ })); expect(last('learningOpen')).toMatchObject({ visual: true });
  expect(last('learningOpen').path).toBeUndefined();
  await reply('learningOpen'); expect((postMessage as jest.Mock).mock.calls.filter(call => call[0] === 'learningArticle')).toHaveLength(1);
});
test('visual homepage remains accessible when the catalog cannot load', async () => {
  render(<Learning />); await reply('learningCatalog', undefined, '目录请求失败');
  fireEvent.click(screen.getByRole('tab', { name: '可视化学习' }));
  expect(screen.getByTitle('交易大师可视化学习站点')).toHaveAttribute('src', 'https://zhouqinglong520.github.io/trading-mastery/');
});
test('connects the local GitHub account, displays its name and refreshes the catalog', async () => {
  render(<Learning />); await reply('learningCatalog', catalog); await reply('learningArticle', article());
  fireEvent.click(screen.getByRole('button', { name: /使用 GitHub 账号/ })); expect(last('learningConnectGitHub').force).toBe(true);
  await act(async () => { window.dispatchEvent(new MessageEvent('message', { data: { command: 'learningAuthState', data: { account: 'local-user' } } })); });
  await reply('learningConnectGitHub', catalog); await reply('learningArticle', article());
  expect(screen.getByText('同步账号：local-user（VSCode GitHub）')).toBeInTheDocument(); expect(screen.getByRole('button', { name: /切换 GitHub 账号/ })).toBeInTheDocument();
});
test('cancelling GitHub authorization keeps the existing article visible', async () => {
  render(<Learning />); await reply('learningCatalog', catalog); await reply('learningArticle', article());
  fireEvent.click(screen.getByRole('button', { name: /使用 GitHub 账号/ })); await reply('learningConnectGitHub', undefined, '未获得 GitHub 账号授权');
  expect(screen.getByText('正文内容')).toBeInTheDocument(); expect(screen.getByText('未获得 GitHub 账号授权')).toBeInTheDocument();
});
test('late responses cannot replace a newly selected article', async () => {
  render(<Learning />); await reply('learningCatalog', catalog); const oldId = last('learningArticle').id;
  fireEvent.click(screen.getByRole('button', { name: /学习笔记/ })); await reply('learningArticle', article(second, '养家文章'));
  await act(async () => { window.dispatchEvent(new MessageEvent('message', { data: { command: 'learningResult', data: { id: oldId, result: article(first, '过期文章') } } })); });
  expect(screen.getByText('养家文章')).toBeInTheDocument(); expect(screen.queryByText('过期文章')).not.toBeInTheDocument();
});
test('Markdown renders headings and tables while keeping scripts and dangerous links inert', () => {
  const view = render(<LearningMarkdown text={'# 标题\n\n**重点**\n\n| 列 | 值 |\n| --- | --- |\n| a | b |\n\n<script>alert(1)</script>\n[危险](javascript:alert)\n[来源](https://github.com)'} />);
  expect(screen.getByRole('heading', { name: '标题' })).toBeInTheDocument(); expect(screen.getByRole('table')).toBeInTheDocument();
  expect(view.container.querySelector('script')).toBeNull(); expect(view.container.querySelector('a[href^="javascript"]')).toBeNull();
  expect(screen.getByRole('link', { name: '来源' })).toHaveAttribute('rel', 'noopener noreferrer');
});
