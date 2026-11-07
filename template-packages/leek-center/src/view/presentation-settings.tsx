import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Popconfirm, Select, Space, Spin, Switch, Tabs, Tag, Typography, message } from 'antd';
import type { DisplayPreferences } from '../../../../src/shared/presentation';
import { postMessage } from '@/utils/common';

type HookStatus = { enabled: boolean; targets: { provider: string; configured: boolean }[] };
const labels: Record<string, string> = { wecom: '企业微信', dingtalk: '钉钉', feishu: '飞书 / Lark' };
const preview = (template: string, data: Record<string, string>) => template.replace(/\$\{(\w+)\}/g, (raw, key) => data[key] ?? raw);
const variables = (names: string[]) => '变量：' + names.map(name => '${' + name + '}').join(' ');
const sidebarViews = [
  { key: 'sidebarStockEnabled', id: 'stock', label: 'Stock（股票）' },
  { key: 'sidebarNewsEnabled', id: 'news', label: 'XueQiu News（雪球资讯）' },
  { key: 'sidebarBinanceEnabled', id: 'binance', label: 'Binance（币安）' },
  { key: 'sidebarForexEnabled', id: 'forex', label: 'Forex（外汇）' },
  { key: 'sidebarSettingsEnabled', id: 'settings', label: 'Settings（设置）' },
  { key: 'sidebarAgentEnabled', id: 'agent', label: 'LeekAgent（AI 助手）' },
] as const;

export default function PresentationSettings() {
  const [form] = Form.useForm();
  const [hooksForm] = Form.useForm();
  const [accountForm] = Form.useForm();
  const [accountConfigured, setAccountConfigured] = useState(false);
  const [draft, setDraft] = useState<DisplayPreferences>();
  const [saved, setSaved] = useState<DisplayPreferences>();
  const [stocks, setStocks] = useState<{ code: string; name: string }[]>([]);
  const [hooks, setHooks] = useState<HookStatus>({ enabled: false, targets: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.data?.command === 'presentationSettings') {
        const data = event.data.data;
        setDraft(data.settings); setSaved(data.settings); setStocks(data.stocks); setHooks(data.webhook); form.setFieldsValue(data.settings);
        setAccountConfigured(data.xuanGuBao?.configured === true);
      }
      if (event.data?.command === 'xuanGuBaoAccountStatus') setAccountConfigured(event.data.data.configured === true);
      if (event.data?.command === 'webhookStatus') setHooks(event.data.data);
      if (event.data?.command === 'presentationChanged') {
        const bossMode = event.data.data.bossMode === true;
        form.setFieldsValue({ bossMode }); setDraft(current => current ? { ...current, bossMode } : current);
      }
      if (event.data?.command === 'presentationResult') {
        setBusy(false);
        if (event.data.data.command === 'saveXuanGuBaoAccount') accountForm.resetFields(['password']);
        if (event.data.data.success && ['saveXuanGuBaoAccount', 'clearXuanGuBaoAccount'].includes(event.data.data.command)) {
          accountForm.resetFields(); setError('');
          message.success(event.data.data.command === 'clearXuanGuBaoAccount' ? '选股宝账号已清除' : '选股宝账号已安全保存');
          return;
        }
        if (event.data.data.success) { setError(''); if (event.data.data.command === 'saveWebhook') hooksForm.resetFields(); message.success('设置已保存'); }
        else { setError(event.data.data.error || '保存失败'); message.error(event.data.data.error || '保存失败'); }
      }
    };
    window.addEventListener('message', receive); postMessage('getPresentationSettings');
    return () => window.removeEventListener('message', receive);
  }, [form, hooksForm, accountForm]);
  const send = (command: string, data: unknown) => { setBusy(true); setError(''); postMessage(command, data); };
  const save = async () => { await form.validateFields(); send('savePresentationSettings', form.getFieldsValue(true)); };
  const move = (from: string, to: string) => {
    if (!draft || !draft.statusBarStock.includes(from) || from === to) return;
    const codes = draft.statusBarStock.filter(code => code !== from);
    codes.splice(codes.indexOf(to), 0, from);
    form.setFieldsValue({ statusBarStock: codes }); setDraft({ ...draft, statusBarStock: codes });
  };
  const toggle = (name: keyof DisplayPreferences, label: string) => <Form.Item name={name} label={label} valuePropName="checked"><Switch disabled={busy} aria-label={label} /></Form.Item>;
  if (!draft) return <div style={{ padding: 32 }}><Spin /> 正在读取个性化设置…</div>;
  return <div style={{ padding: 24, maxWidth: 1080, margin: '0 auto' }}>
    <Space style={{ justifyContent: 'space-between', width: '100%', marginBottom: 16 }}><Typography.Title level={3} style={{ margin: 0 }}>个性化设置</Typography.Title><Button type="primary" loading={busy} onClick={() => { save().catch(() => {}); }}>保存显示设置</Button></Space>
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
    <Form form={form} layout="vertical" onValuesChange={(_, all) => setDraft({ ...draft, ...all })}>
      <Tabs defaultActiveKey="status">
        <Tabs.TabPane tab="状态栏" key="status">
          <Space size={36} wrap>{toggle('hideStatusBar', '隐藏整个状态栏')}{toggle('hideStatusBarStock', '隐藏股票行情')}{toggle('hideStatusBarIcon', '隐藏状态栏图标')}</Space>
          <Form.Item name="statusBarStock" label="状态栏标的（最多 8 个）" rules={[{ type: 'array', max: 8, message: '最多选择 8 个标的' }]}><Select mode="multiple" showSearch optionFilterProp="label" options={stocks.map(stock => ({ value: stock.code, label: `${stock.name} ${stock.code}` }))} /></Form.Item>
          <Space wrap style={{ marginBottom: 20 }}>{draft.statusBarStock.map((code, index, codes) => <span draggable key={code} onDragStart={event => event.dataTransfer.setData('text/plain', code)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); move(event.dataTransfer.getData('text/plain'), code); }} style={{ border: '1px solid var(--vscode-panel-border, #aaa)', padding: 6, cursor: 'grab' }}>
            {stocks.find(stock => stock.code === code)?.name || code}<Button size="small" aria-label={`${code}上移`} disabled={busy || index === 0} onClick={() => move(code, codes[index - 1])}>↑</Button><Button size="small" aria-label={`${code}下移`} disabled={busy || index === codes.length - 1} onClick={() => move(codes[index + 1], code)}>↓</Button>
          </span>)}</Space>
          <Form.Item name="statusBarFormat" label="报价显示模板" rules={[{ required: true, max: 250 }]} extra={variables(['name', 'code', 'price', 'percent', 'icon'])}><Input /></Form.Item>
          <Card size="small" title="报价预览" style={{ marginBottom: 16 }}>{preview(draft.statusBarFormat, { name: '示例股票', code: 'sh600519', price: '100.00', percent: '+1.23%', icon: draft.hideStatusBarIcon ? '' : '📈' })}</Card>
          <Form.Item name="statusBarProfitFormat" label="收益显示模板" rules={[{ required: true, max: 250 }]} extra={variables(['currency', 'profit', 'todayProfit', 'marketValue', 'cost'])}><Input /></Form.Item>
          <Card size="small" title="收益预览">{preview(draft.statusBarProfitFormat, { currency: 'CNY', profit: '1200.00', todayProfit: '300.00', marketValue: '10000.00', cost: '8800.00' })}</Card>
        </Tabs.TabPane>
        <Tabs.TabPane tab="颜色与图标" key="colors">
          <Form.Item name="riseColor" label="上涨文字颜色" extra="颜色名或十六进制，如 red、#f56c6c"><Input /></Form.Item>
          <Form.Item name="fallColor" label="下跌文字颜色"><Input /></Form.Item>
          <Space><span style={{ color: draft.riseColor }}>上涨 +1.23%</span><span style={{ color: draft.fallColor }}>下跌 -1.23%</span></Space>
          <Form.Item name="iconType" label="侧栏涨跌图标"><Select options={[['arrow','箭头 · 红涨绿跌'],['arrow1','箭头 · 绿涨红跌'],['food1','吃面 / 鸡腿'],['food2','烤韭菜 / 烤肉'],['food3','吃面 / 喝酒'],['iconfood','食物 Emoji'],['none','无图标']].map(([value, label]) => ({ value, label }))} /></Form.Item>
          {toggle('bossMode', '老板模式：淡化文字，走势图去色')}
        </Tabs.TabPane>
        <Tabs.TabPane tab="侧栏栏目" key="sidebar">
          <Alert type="info" showIcon message="管理侧栏右键菜单中的六个栏目" description="修改开关后点击右上角「保存显示设置」。关闭后隐藏栏目；开启后点击「打开」可显示被右键菜单隐藏的栏目。这里的开关与底部 News 独立。" style={{ marginBottom: 20 }} />
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {sidebarViews.map(view => <Space key={view.key} size={24} align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
              {toggle(view.key, view.label)}
              <Button disabled={busy || !saved?.[view.key] || !draft[view.key]} aria-label={`打开 ${view.label}`} onClick={() => postMessage('executeCommand', `leekFundView.${view.id}.focus`)}>打开</Button>
            </Space>)}
          </Space>
          <Typography.Paragraph type="secondary">隐藏 Settings 后，可从命令面板运行「LeekFund: 个性化设置」重新开启。开关表示栏目是否启用；右键菜单仍可单独控制已启用栏目的显示。</Typography.Paragraph>
        </Tabs.TabPane>
        <Tabs.TabPane tab="显示与提醒" key="display">
          <Space size={36} wrap>{toggle('showEarnings', '显示持仓收益')}{toggle('stockHeldTipShow', '持仓高亮')}{toggle('stockRemindSwitch', '启用价格预警')}{toggle('newsPanelEnabled', '启用底部 News')}</Space>
          <Button onClick={() => postMessage('executeCommand', 'leek-fund.flash-news-show')}>打开底部快讯面板</Button>
          <Typography.Title level={4}>编辑器 Blame 行情</Typography.Title>
          <Space size={36} wrap>{toggle('blameEnabled', '启用行尾行情旁注')}{toggle('blameOnlyHoldings', '仅展示未清仓持仓')}</Space>
          <Form.Item name="blameAuthor" label="显示作者名" rules={[{ required: true, max: 40 }]}><Input /></Form.Item>
          <Space size={36}><Form.Item name="blameRotateSeconds" label="行尾轮播间隔（秒）"><InputNumber min={3} max={300} /></Form.Item><Form.Item name="blameCodeLensCount" label="文件顶部行情数量"><InputNumber min={0} max={5} /></Form.Item></Space>
          <Card size="small" title="旁注预览">{draft.blameAuthor}, just now • 示例股票 100.00 (+1.23%)</Card>
        </Tabs.TabPane>
      </Tabs>
    </Form>
    <Card title="选股宝账号配置" style={{ marginTop: 24 }} extra={<Tag color={accountConfigured ? 'green' : 'default'}>{accountConfigured ? '已配置' : '未配置'}</Tag>}>
      <Typography.Paragraph>用于选股宝快讯登录。账号密码保存在编辑器安全存储中，已保存的凭据不会回显。此处单独保存，无需点击「保存显示设置」。</Typography.Paragraph>
      <Form form={accountForm} layout="vertical">
        <Form.Item name="mobile" label="选股宝手机号" rules={[{ required: true, message: '请输入手机号' }, { pattern: /^(?:\+\d{1,3})?\d{6,15}$/, message: '请输入有效手机号' }]} extra="国内号码可省略 +86，其他地区请填写国际格式"><Input autoComplete="off" placeholder="输入选股宝登录手机号" disabled={busy} /></Form.Item>
        <Form.Item name="password" label="选股宝密码" rules={[{ required: true, message: '请输入密码' }]}><Input.Password autoComplete="new-password" placeholder="输入密码；已保存的密码不会回显" disabled={busy} /></Form.Item>
        <Space>
          <Button type="primary" disabled={busy} onClick={() => { accountForm.validateFields().then(values => send('saveXuanGuBaoAccount', values)).catch(() => {}); }}>{accountConfigured ? '更换选股宝账号' : '保存选股宝账号'}</Button>
          <Popconfirm title="确认清除选股宝账号和登录缓存？" onConfirm={() => send('clearXuanGuBaoAccount', {})} okText="清除" cancelText="取消" disabled={busy || !accountConfigured}><Button danger disabled={busy || !accountConfigured}>清除选股宝账号</Button></Popconfirm>
        </Space>
      </Form>
    </Card>
    <Card title="Webhook 价格预警" style={{ marginTop: 24 }} extra={<Switch checked={hooks.enabled} disabled={busy} onChange={enabled => send('toggleWebhook', { enabled })} />}>
      <Alert type="info" message="预警在编辑器运行时生效。保存地址不会自动开启推送；启用后，触发的股票价格预警将发送到已配置的机器人。" style={{ marginBottom: 16 }} />
      <Space wrap style={{ marginBottom: 16 }}>{hooks.targets.map(target => <span key={target.provider}><Tag color={target.configured ? 'green' : 'default'}>{labels[target.provider]}：{target.configured ? '已配置' : '未配置'}</Tag>{target.configured && <Button size="small" disabled={busy} onClick={() => send('removeWebhook', { provider: target.provider })}>移除</Button>}</span>)}</Space>
      <Form form={hooksForm} layout="vertical">
        <Form.Item name="provider" label="机器人平台" rules={[{ required: true }]}><Select options={Object.entries(labels).map(([value, label]) => ({ value, label }))} /></Form.Item>
        <Form.Item name="url" label="Webhook 地址" rules={[{ required: true, type: 'url' }]}><Input.Password autoComplete="off" placeholder="填写完整 HTTPS 地址；已保存的地址不会回显" /></Form.Item>
        <Form.Item name="secret" label="签名密钥（钉钉 / 飞书启用加签时填写）"><Input.Password autoComplete="new-password" /></Form.Item>
        <Button disabled={busy} onClick={() => { hooksForm.validateFields().then(values => send('saveWebhook', values)).catch(() => {}); }}>保存机器人配置</Button>
      </Form>
      <Typography.Text type="secondary">地址与签名密钥保存在编辑器 SecretStorage，使用显示设置导出时不会包含这些信息。</Typography.Text>
    </Card>
  </div>;
}
