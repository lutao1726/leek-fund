import React, { useState } from 'react';
import { Alert, Button, Select, Space, Table, Tag, Typography } from 'antd';
import { useHistory } from 'react-router-dom';
import type { MarketPage, StockChange } from '../../../../src/shared/market';
import { useMarketActions, useMarketQuery, useMarketState } from '@/services/market';
import { MarketStatus, StockProfileModal } from '@/components/market/shared';

export default function StockChanges() {
  const history = useHistory(); const state = useMarketState(); const actions = useMarketActions();
  const [direction, setDirection] = useState<'all' | 'up' | 'down'>('all'); const [type, setType] = useState<number>();
  const [page, setPage] = useState(1); const [stock, setStock] = useState<string>();
  const query = useMarketQuery<MarketPage<StockChange>>('changes', { direction, type, page }, 15000);
  const data = query.result?.data;
  return <div style={{ padding: 24, maxWidth: 1500, margin: '0 auto' }}>
    <Space wrap style={{ width: '100%', justifyContent: 'space-between', marginBottom: 20 }}>
      <div><Typography.Title level={3} style={{ margin: 0 }}>个股异动</Typography.Title><Typography.Text type="secondary">A股盘面信号 · 东方财富公开数据</Typography.Text></div>
      <Space><Button onClick={() => history.push('/news')}>新闻快讯</Button><Button onClick={() => history.push('/sector-boards')}>板块行情</Button><Button loading={query.loading} onClick={query.refresh}>刷新</Button></Space>
    </Space>
    <Space wrap style={{ marginBottom: 16 }}>
      <Select aria-label="异动方向" value={direction} style={{ width: 180 }} onChange={value => { setDirection(value); setType(undefined); setPage(1); }} options={[{ value: 'all', label: '全部信号' }, { value: 'up', label: '看涨类信号' }, { value: 'down', label: '看跌类信号' }]} />
      <Select aria-label="异动类型" value={type} allowClear placeholder="全部异动类型" style={{ width: 210 }} onChange={value => { setType(value); setPage(1); }} options={(state.changeTypes || []).filter(item => direction === 'all' || item.direction === direction).map(item => ({ value: item.type, label: item.label }))} />
    </Space>
    <MarketStatus result={query.result} error={query.error || actions.error} />
    <Alert type="info" showIcon message="时间按来源显示；来源未提供交易日期时，不将采集日期视为交易日期。异动名称是供应商信号分类，不代表交易结论。" style={{ marginBottom: 16 }} />
    {data?.partial && <Alert type="warning" message="部分来源记录无法识别，列表仅展示已验证的 A 股记录。" />}
    <Table<StockChange> size="small" rowKey="id" loading={query.loading} dataSource={data?.items || []} scroll={{ x: 700 }} pagination={{ current: page, pageSize: 100, total: data?.total || 0, showSizeChanger: false, onChange: setPage }} columns={[
      { title: '来源时间', key: 'time', render: (_, row) => <>{row.date || '交易日期未提供'} {row.time}</> },
      { title: '股票', key: 'name', render: (_, row) => <Button type="link" onClick={() => setStock(row.code)}>{row.name} <small>{row.code}</small></Button> },
      { title: '异动类型', key: 'type', render: (_, row) => <Tag color={row.direction === 'up' ? 'red' : 'green'}>{row.label}</Tag> },
      { title: '详情', key: 'detail', render: (_, row) => <Button size="small" onClick={() => setStock(row.code)}>企业简介与概念</Button> },
      { title: '自选', key: 'watch', render: (_, row) => <Button size="small" disabled={state.watchedCodes.includes(row.code)} loading={actions.busy.includes(row.code)} onClick={() => { void actions.act('addStock', row.code); }}>{state.watchedCodes.includes(row.code) ? '已自选' : '加入自选'}</Button> },
    ]} />
    <StockProfileModal code={stock} onClose={() => setStock(undefined)} />
  </div>;
}
