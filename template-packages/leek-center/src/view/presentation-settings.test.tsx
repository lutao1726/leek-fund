import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PresentationSettings from './presentation-settings';
import { postMessage } from '@/utils/common';

jest.mock('@/utils/common', () => ({ postMessage: jest.fn() }));
const settings = {
  hideStatusBar: false, hideStatusBarStock: false, hideStatusBarIcon: false, statusBarStock: ['sh600519', 'hk00700'],
  statusBarFormat: '${name} ${price} ${percent}', statusBarProfitFormat: '${currency} ${profit}', riseColor: 'red', fallColor: 'green',
  iconType: 'arrow', showEarnings: true, stockHeldTipShow: false, stockRemindSwitch: true,
  showStockIndustry: false, groupStockByIndustry: false,
  bossMode: false, newsPanelEnabled: true, blameEnabled: false, blameOnlyHoldings: true, blameAuthor: 'You', blameRotateSeconds: 10, blameCodeLensCount: 3,
  sidebarStockEnabled: true, sidebarNewsEnabled: true, sidebarBinanceEnabled: true,
  sidebarForexEnabled: true, sidebarSettingsEnabled: true, sidebarAgentEnabled: true,
};
const emit = (command: string, data: any) => act(() => { window.dispatchEvent(new MessageEvent('message', { data: { command, data } })); });
const ready = () => emit('presentationSettings', { settings, stocks: [{ code: 'sh600519', name: '测试股票' }, { code: 'hk00700', name: '港股示例' }], webhook: { enabled: false, targets: [{ provider: 'wecom', configured: true }] } });
beforeAll(() => { Object.defineProperty(window, 'matchMedia', { writable: true, value: (query: string) => ({ matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) }); });
beforeEach(() => jest.clearAllMocks());

test('loads safe settings with live previews and without saved robot credentials', () => {
  render(<PresentationSettings />); expect(postMessage).toHaveBeenCalledWith('getPresentationSettings'); ready();
  expect(screen.getByText('示例股票 100.00 +1.23%')).toBeInTheDocument();
  expect(screen.getByText('CNY 1200.00')).toBeInTheDocument();
  expect(screen.queryByLabelText('选股宝手机号')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Webhook 地址')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Webhook 价格预警' }));
  expect(screen.queryByRole('button', { name: '保存显示设置' })).not.toBeInTheDocument();
  expect(screen.getByText('企业微信：已配置')).toBeInTheDocument();
  expect(screen.getByLabelText('Webhook 地址')).toHaveValue('');
});

test('saves the account separately and clears credential fields after success', async () => {
  render(<PresentationSettings />); ready();
  fireEvent.click(screen.getByRole('tab', { name: '选股宝账号配置' }));
  expect(screen.queryByRole('button', { name: '保存显示设置' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '清除选股宝账号' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('选股宝手机号'), { target: { value: '13800000000' } });
  fireEvent.change(screen.getByLabelText('选股宝密码'), { target: { value: 'test-only-password' } });
  expect(screen.getByLabelText('选股宝密码')).toHaveAttribute('type', 'password');
  fireEvent.click(screen.getByRole('button', { name: '保存选股宝账号' }));
  await waitFor(() => expect(postMessage).toHaveBeenCalledWith('saveXuanGuBaoAccount', { mobile: '13800000000', password: 'test-only-password' }));
  expect(postMessage).not.toHaveBeenCalledWith('savePresentationSettings', expect.anything());
  emit('xuanGuBaoAccountStatus', { configured: true });
  emit('presentationResult', { success: true, command: 'saveXuanGuBaoAccount' });
  expect(screen.getByLabelText('选股宝手机号')).toHaveValue('');
  expect(screen.getByLabelText('选股宝密码')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: '清除选股宝账号' }));
  fireEvent.click(await screen.findByRole('button', { name: '清 除' }));
  expect(postMessage).toHaveBeenCalledWith('clearXuanGuBaoAccount', {});
});

test('failed account saves clear the password and show an actionable error', () => {
  render(<PresentationSettings />); ready();
  fireEvent.click(screen.getByRole('tab', { name: '选股宝账号配置' }));
  fireEvent.change(screen.getByLabelText('选股宝密码'), { target: { value: 'test-only-password' } });
  emit('presentationResult', { success: false, command: 'saveXuanGuBaoAccount', error: '账号保存失败' });
  expect(screen.getByLabelText('选股宝密码')).toHaveValue('');
  expect(screen.getAllByText('账号保存失败').length).toBeGreaterThan(0);
});
test('reorders status symbols and saves the entire form including inactive-tab values', async () => {
  render(<PresentationSettings />); ready();
  fireEvent.click(screen.getByLabelText('hk00700上移'));
  fireEvent.change(screen.getByLabelText('报价显示模板'), { target: { value: '${code} ${price}' } });
  emit('webhookStatus', { enabled: true, targets: [{ provider: 'wecom', configured: true }] });
  emit('presentationChanged', { bossMode: true });
  fireEvent.click(screen.getByRole('button', { name: '保存显示设置' }));
  await waitFor(() => expect(postMessage).toHaveBeenCalledWith('savePresentationSettings', expect.objectContaining({ statusBarStock: ['hk00700', 'sh600519'], statusBarFormat: '${code} ${price}', bossMode: true, blameRotateSeconds: 10, newsPanelEnabled: true })));
});
test('enabling delivery is an explicit separate action and failed saves retain feedback', async () => {
  render(<PresentationSettings />); ready();
  fireEvent.click(screen.getByRole('tab', { name: 'Webhook 价格预警' }));
  fireEvent.click(screen.getByRole('switch', { name: '启用 Webhook 价格预警' }));
  expect(postMessage).toHaveBeenCalledWith('toggleWebhook', { enabled: true });
  emit('presentationResult', { success: false, error: '机器人配置不正确' });
  expect(screen.getAllByText('机器人配置不正确').length).toBeGreaterThan(0);
});

test('all six sidebar columns can be disabled and saved independently of bottom News', async () => {
  render(<PresentationSettings />); ready();
  fireEvent.click(screen.getByRole('tab', { name: '侧栏栏目' }));
  for (const label of ['Stock（股票）', 'XueQiu News（雪球资讯）', 'Binance（币安）', 'Forex（外汇）', 'Settings（设置）', 'LeekAgent（AI 助手）']) {
    fireEvent.click(screen.getByRole('switch', { name: label }));
    expect(screen.getByRole('button', { name: `打开 ${label}` })).toBeDisabled();
  }
  fireEvent.click(screen.getByRole('tab', { name: '显示与提醒' }));
  expect(screen.getByRole('switch', { name: '启用底部 News' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '保存显示设置' }));
  await waitFor(() => expect(postMessage).toHaveBeenCalledWith('savePresentationSettings', expect.objectContaining({
    sidebarStockEnabled: false, sidebarNewsEnabled: false, sidebarBinanceEnabled: false,
    sidebarForexEnabled: false, sidebarSettingsEnabled: false, sidebarAgentEnabled: false, newsPanelEnabled: true,
  })));
});

test('opening a sidebar column focuses its view and waits for an enabled setting to be saved', () => {
  render(<PresentationSettings />); ready();
  fireEvent.click(screen.getByRole('tab', { name: '侧栏栏目' }));
  fireEvent.click(screen.getByRole('button', { name: '打开 Binance（币安）' }));
  expect(postMessage).toHaveBeenCalledWith('executeCommand', 'leekFundView.binance.focus');
  emit('presentationSettings', { settings: { ...settings, sidebarSettingsEnabled: false }, stocks: [], webhook: { enabled: false, targets: [] } });
  fireEvent.click(screen.getByRole('switch', { name: 'Settings（设置）' }));
  expect(screen.getByRole('button', { name: '打开 Settings（设置）' })).toBeDisabled();
  ready();
  expect(screen.getByRole('button', { name: '打开 Settings（设置）' })).toBeEnabled();
});
