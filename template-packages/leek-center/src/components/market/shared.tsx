import React from 'react';
import { Alert, Button, Card, Empty, Modal, Space, Table, Tag, Typography } from 'antd';
import { useHistory } from 'react-router-dom';
import type { MarketPage, MarketResult, MarketStock, StockProfile } from '../../../../../src/shared/market';
import { useMarketActions, useMarketQuery, useMarketState } from '@/services/market';
import { layoutMarketMap, MapTile, marketColor, marketDate, marketMoney, marketPercent } from '@/utils/market';

export function MarketStatus({ result, error }: { result?: MarketResult<any>; error?: string }) {
  return <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }}>
    {(error || result?.error) && <Alert type={result ? 'warning' : 'error'} showIcon message={error || result?.error} description={result ? '保留上次可用数据，请留意行情时间并重试刷新。' : '暂时无法取得市场数据，可使用刷新按钮重试。'} />}
    {result && <Typography.Text type="secondary">采集：{marketDate(result.fetchedAt)} · 行情：{marketDate(result.asOf)}{result.stale ? ' · 缓存 / 部分数据不可用' : ''}</Typography.Text>}
  </Space>;
}

export function StockTable({ value, loading, onPage, onStock }: { value?: MarketPage<MarketStock>; loading: boolean; onPage: (page: number) => void; onStock: (code: string) => void }) {
  const state = useMarketState(); const actions = useMarketActions();
  return <>
    {actions.error && <Alert type="error" message={actions.error} showIcon />}
    {value?.partial && <Alert type="warning" message="部分来源记录缺少有效代码，当前页仅展示可识别股票。" />}
    <Table<MarketStock> size="small" rowKey="code" loading={loading} dataSource={value?.items || []} scroll={{ x: 850 }} pagination={{ current: value?.page || 1, pageSize: 100, total: value?.total || 0, onChange: onPage, showSizeChanger: false, showTotal: total => `共 ${total} 条` }} columns={[
      { title: '股票', key: 'stock', render: (_, row) => <Button type="link" onClick={() => onStock(row.code)}>{row.name}<small> {row.code}</small></Button> },
      { title: '现价', dataIndex: 'price', render: value => marketMoney(value) },
      { title: '涨跌幅', dataIndex: 'percent', sorter: (a, b) => (a.percent ?? -Infinity) - (b.percent ?? -Infinity), render: value => <span style={{ color: marketColor(value) }}>{marketPercent(value)}</span> },
      { title: '成交额', dataIndex: 'turnover', render: value => marketMoney(value) },
      { title: '主力净流入', dataIndex: 'netInflow', render: value => <span style={{ color: marketColor(value) }}>{marketMoney(value)}</span> },
      { title: '换手率', dataIndex: 'turnoverRate', render: value => marketPercent(value) },
      { title: '自选', key: 'add', render: (_, row) => <Button size="small" disabled={state.watchedCodes.includes(row.code)} loading={actions.busy.includes(row.code)} onClick={() => { void actions.act('addStock', row.code); }}>{state.watchedCodes.includes(row.code) ? '已自选' : '加入自选'}</Button> },
    ]} />
  </>;
}

export function MarketMap({ tiles, onSelect }: { tiles: MapTile[]; onSelect: (id: string) => void }) {
  const rectangles = layoutMarketMap(tiles, 1200, 660);
  const excluded = tiles.length - rectangles.length;
  if (!rectangles.length) return <Empty description="没有可用于云图的市值数据" />;
  return <>
    <Typography.Paragraph type="secondary">面积代表市值，颜色代表涨跌幅。点击或双击色块查看详情。{excluded > 0 ? ` ${excluded} 个条目缺少市值，未纳入云图。` : ''}</Typography.Paragraph>
    <svg viewBox="0 0 1200 660" role="img" aria-label="市场涨跌热力图" style={{ width: '100%', minHeight: 300, maxHeight: '75vh', background: 'var(--vscode-editor-background, #1e1e1e)' }}>
      {rectangles.map(rect => <g key={rect.id} role="button" tabIndex={0} aria-label={`${rect.name} ${marketPercent(rect.percent)}`} onClick={() => onSelect(rect.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(rect.id); } }} style={{ cursor: 'pointer' }}>
        <title>{rect.name} · {marketPercent(rect.percent)} · 市值 {marketMoney(rect.weight)}</title>
        <rect x={rect.x + 0.5} y={rect.y + 0.5} width={Math.max(0, rect.width - 1)} height={Math.max(0, rect.height - 1)} fill={marketColor(rect.percent)} fillOpacity={rect.percent === undefined ? 0.45 : Math.min(1, 0.45 + Math.abs(rect.percent) / 12)} />
        {rect.width > 55 && rect.height > 34 && <text x={rect.x + rect.width / 2} y={rect.y + rect.height / 2} textAnchor="middle" fill="white" style={{ pointerEvents: 'none', fontSize: Math.min(18, Math.max(9, rect.width / (rect.name.length + 1))) }}>{rect.name.slice(0, Math.floor(rect.width / 9))}<tspan x={rect.x + rect.width / 2} dy="1.3em">{marketPercent(rect.percent)}</tspan></text>}
      </g>)}
    </svg>
  </>;
}

export function StockProfileModal({ code, onClose }: { code?: string; onClose: () => void }) {
  const history = useHistory(); const query = useMarketQuery<StockProfile>('profile', { code }, 0, !!code);
  const state = useMarketState(); const actions = useMarketActions(); const data = query.result?.data;
  return <Modal visible={!!code} width={850} title={data?.name || code || '个股详情'} onCancel={onClose} footer={[
    <Button key="refresh" loading={query.loading} onClick={query.refresh}>刷新资料</Button>,
    <Button key="add" type="primary" disabled={!code || state.watchedCodes.includes(code)} loading={!!code && actions.busy.includes(code)} onClick={() => { if (code) void actions.act('addStock', code); }}>{code && state.watchedCodes.includes(code) ? '已在自选' : '加入自选'}</Button>,
  ]}>
    <MarketStatus result={query.result} error={query.error || actions.error} />
    <Card loading={query.loading && !data}>
      {data ? <>
        <Typography.Title level={4}>{data.name} <small>{data.code}</small></Typography.Title>
        <Space size={30}><strong>{marketMoney(data.quote?.price)}</strong><strong style={{ color: marketColor(data.quote?.percent) }}>{marketPercent(data.quote?.percent)}</strong><span>换手率 {marketPercent(data.quote?.turnoverRate)}</span></Space>
        <Typography.Paragraph style={{ marginTop: 16 }}>{data.company || '企业名称暂未提供'}</Typography.Paragraph>
        <Typography.Paragraph>行业：{data.industry || '暂未提供'}</Typography.Paragraph>
        <Typography.Paragraph>{data.description || '企业简介暂未提供'}</Typography.Paragraph>
        {data.mainBusiness && <Typography.Paragraph>主营业务：{data.mainBusiness}</Typography.Paragraph>}
        <Typography.Title level={5}>相关概念</Typography.Title>
        <Space wrap>{data.concepts.map(name => <Tag key={name} style={{ cursor: 'pointer' }} onClick={() => { onClose(); history.push('/sector-boards?kind=concept&kw=' + encodeURIComponent(name)); }}>{name}</Tag>)}</Space>
      </> : <Empty description={query.loading ? '正在获取资料' : '暂无个股资料'} />}
    </Card>
  </Modal>;
}
