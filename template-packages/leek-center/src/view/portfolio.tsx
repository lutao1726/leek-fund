import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import type { Position, PositionRow, PortfolioTotal } from '../../../../src/shared/portfolio';
import { postMessage } from '@/utils/common';
import state from '@/stores';

type Snapshot = { rows: PositionRow[]; totals: PortfolioTotal[]; cryptoCodes?: string[] };
type Dialog = { action: 'save' | 'add' | 'close'; position?: PositionRow };
const money = (value?: number) => value === undefined ? '—' : value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: value !== 0 && Math.abs(value) < 1 ? 8 : 2 });
const gain = (value?: number) => <span className={value === undefined ? '' : value > 0 ? 'red' : value < 0 ? 'green' : ''}>{money(value)}</span>;

export default function Portfolio() {
  const [snapshot, setSnapshot] = useState<Snapshot>({ rows: [], totals: [] });
  const [dialog, setDialog] = useState<Dialog>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form] = Form.useForm();

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.data?.command === 'portfolioSnapshot') setSnapshot(event.data.data);
      if (event.data?.command === 'portfolioResult') {
        setBusy(false);
        if (event.data.data.success) { setDialog(undefined); setError(''); }
        else { setError(event.data.data.error || '操作失败'); message.error(event.data.data.error || '操作失败'); }
      }
    };
    window.addEventListener('message', receive);
    postMessage('getPortfolio');
    return () => window.removeEventListener('message', receive);
  }, []);

  const act = (data: object) => { setBusy(true); setError(''); postMessage('portfolioAction', data); };
  const open = (action: Dialog['action'], position?: PositionRow) => {
    form.resetFields();
    form.setFieldsValue(action === 'save' ? { ...position, isSellOut: false } : { amount: undefined, price: position?.price });
    setDialog({ action, position });
  };
  const submit = async () => {
    const values = await form.validateFields();
    if (!dialog) return;
    if (dialog.action === 'save') {
      const position: Position = { code: values.code.trim(), name: values.name.trim(), amount: values.amount, unitPrice: values.unitPrice, isSellOut: false };
      act({ action: 'save', position });
    } else act({ action: dialog.action, code: dialog.position!.code, amount: values.amount, price: values.price });
  };

  const cryptoChoices = (snapshot.cryptoCodes || []).map(code => ({ value: code, label: `Binance ${code}` }));
  const columns = [
    { title: '资产', key: 'name', render: (_: unknown, row: PositionRow) => <><Typography.Text strong>{row.name}</Typography.Text><div style={{ opacity: 0.65 }}>{row.code} · {row.currency}</div></> },
    { title: '状态', key: 'status', render: (_: unknown, row: PositionRow) => <Tag color={row.isSellOut ? 'default' : 'blue'}>{row.isSellOut ? '已清仓' : '持仓中'}</Tag> },
    { title: '数量 / 成本价', key: 'cost', render: (_: unknown, row: PositionRow) => <>{row.amount}<div>{money(row.unitPrice)}</div></> },
    { title: '现价', key: 'price', render: (_: unknown, row: PositionRow) => <span title={row.quoteTime || '暂无行情时间'}>{money(row.price)}<div style={{ opacity: 0.6, fontSize: 11 }}>{row.quoteTime || '暂无行情'}</div></span> },
    { title: '市值', key: 'marketValue', render: (_: unknown, row: PositionRow) => money(row.marketValue) },
    { title: '浮动盈亏', key: 'profit', render: (_: unknown, row: PositionRow) => <>{gain(row.profit)}<div>{row.profitPercent === undefined ? '—' : row.profitPercent.toFixed(2) + '%'}</div></> },
    { title: '今日 / 24h 估算盈亏', key: 'today', render: (_: unknown, row: PositionRow) => gain(row.todayProfit) },
    { title: '操作', key: 'actions', render: (_: unknown, row: PositionRow) => <Space wrap>
      <Button size="small" disabled={busy} onClick={() => open('save', row)}>{row.isSellOut ? '重新建仓' : '编辑'}</Button>
      {!row.isSellOut && <><Button size="small" disabled={busy} onClick={() => open('add', row)}>加仓</Button><Button size="small" disabled={busy} onClick={() => open('close', row)}>清仓</Button></>}
      <Popconfirm title="删除这条持仓记录？自选标的将保留。" onConfirm={() => act({ action: 'delete', code: row.code })}><Button danger size="small" disabled={busy}>删除</Button></Popconfirm>
    </Space> },
  ];

  return <div style={{ padding: '24px', maxWidth: 1600, margin: '0 auto' }}>
    <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 18 }} wrap>
      <div><Typography.Title level={3} style={{ margin: 0 }}>资产管理</Typography.Title><Typography.Text type="secondary">本地股票与 Binance 现货持仓账本 · 按币种展示资产与盈亏</Typography.Text></div>
      <Space wrap><Button onClick={() => postMessage('executeCommand', 'leek-fund.inspectPortfolio')}>AI 持仓巡检</Button><Button type="primary" disabled={busy} onClick={() => open('save')}>新增持仓</Button><Button disabled={busy} onClick={() => act({ action: 'import' })}>导入 JSON</Button><Button disabled={busy} onClick={() => act({ action: 'export' })}>导出 JSON</Button><Button disabled={busy} onClick={() => postMessage('executeCommand', 'leek-fund.refreshStock')}>刷新行情</Button></Space>
    </Space>
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
    <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>{snapshot.totals.map(total => <Col xs={24} lg={8} key={total.currency}><Card title={<>{total.currency} 资产{(total.missingQuotes > 0 || total.missingDailyQuotes > 0) && <Tag color="orange" style={{ marginLeft: 8 }}>行情不完整</Tag>}</>}>
      <Statistic title="持仓市值" value={total.marketValue} precision={2} />
      <Row gutter={12} style={{ marginTop: 16 }}><Col span={12}><div>浮动盈亏</div>{gain(total.profit)}</Col><Col span={12}><div>今日 / 24h 估算盈亏</div>{gain(total.todayProfit)}</Col></Row>
      <Typography.Text type="secondary">持仓成本 {money(total.cost)}{total.missingQuotes > 0 ? ` · ${total.missingQuotes} 条持仓缺少报价，估值仅含已有报价部分` : ''}{total.missingDailyQuotes > 0 ? ` · ${total.missingDailyQuotes} 条今日盈亏暂不可估算` : ''}</Typography.Text>
    </Card></Col>)}</Row>
    <Alert type="info" showIcon message="不同计价币种分别统计，不直接相加。虚拟币按交易对计价，24h 盈亏使用滚动24小时价格估算。盈亏按当前持仓数量估算，当日加减仓、费用和汇率变化可能与券商账单不同。" style={{ marginBottom: 16 }} />
    <Table rowKey="code" dataSource={snapshot.rows} columns={columns} scroll={{ x: 1100 }} pagination={{ pageSize: 20, hideOnSinglePage: true }} locale={{ emptyText: <Empty description="暂无持仓，新增一条记录开始管理资产" /> }} />
    <Modal visible={!!dialog} title={dialog?.action === 'save' ? (dialog.position ? '编辑持仓' : '新增持仓') : dialog?.action === 'add' ? `加仓 · ${dialog.position?.name}` : `清仓 · ${dialog?.position?.name}`} onCancel={() => !busy && setDialog(undefined)} onOk={() => { submit().catch(() => {}); }} confirmLoading={busy} cancelButtonProps={{ disabled: busy }} okText="保存" cancelText="取消" destroyOnClose>
      <Form form={form} layout="vertical" preserve={false}>
        {dialog?.action === 'save' ? <>
          {!dialog.position && <Form.Item label="从现有自选填入"><Select allowClear showSearch placeholder="也可以直接填写下面的代码和名称" optionFilterProp="label" options={[...cryptoChoices, ...state.stock.stocks.filter(stock => /^(sh|sz|bj|hk|usr_)/.test(stock.info.code)).map(stock => ({ value: stock.info.code, label: `${stock.info.name} ${stock.info.code}` }))]} onChange={code => { const item = state.stock.stocks.find(stock => stock.info.code === code); form.setFieldsValue({ code, name: item?.info.name || code }); }} /></Form.Item>}
          <Form.Item name="code" label="资产代码" rules={[{ required: true, whitespace: true }]}><Input disabled={!!dialog.position} placeholder="sh600519 / hk00700 / usr_aapl / BTC_USDT" /></Form.Item>
          <Form.Item name="name" label="资产名称" rules={[{ required: true, whitespace: true, max: 100 }]}><Input /></Form.Item>
          <Form.Item name="amount" label="持仓数量" rules={[{ required: true, type: 'number', min: 0.00000001 }]}><InputNumber style={{ width: '100%' }} min={0.00000001} /></Form.Item>
          <Form.Item name="unitPrice" label="平均成本价（股票原币种 / 交易对计价币）" rules={[{ required: true, type: 'number', min: 0.00000001 }]}><InputNumber style={{ width: '100%' }} min={0.00000001} /></Form.Item>
        </> : <>
          {dialog?.action === 'add' && <Form.Item name="amount" label="加仓数量" rules={[{ required: true, type: 'number', min: 0.00000001 }]}><InputNumber min={0.00000001} style={{ width: '100%' }} /></Form.Item>}
          <Form.Item name="price" label={dialog?.action === 'add' ? '加仓成交价（保存后重算平均成本）' : '清仓成交价'} rules={[{ required: true, type: 'number', min: 0.00000001 }]}><InputNumber min={0.00000001} style={{ width: '100%' }} /></Form.Item>
        </>}
      </Form>
    </Modal>
  </div>;
}
