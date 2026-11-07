import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Input, Row, Space, Statistic, Table, Tabs, Tag, Typography } from 'antd';
import { useHistory, useLocation, useParams } from 'react-router-dom';
import type { BoardOverview, MarketPage, MarketStock, SectorBoard } from '../../../../src/shared/market';
import { useMarketActions, useMarketQuery, useMarketState } from '@/services/market';
import { MarketStatus, StockProfileModal, StockTable } from '@/components/market/shared';
import { marketColor, marketMoney, marketPercent } from '@/utils/market';

function FlowRank({ rows, title, select }: { rows: SectorBoard[]; title: string; select: (code: string) => void }) {
  const rank = rows.filter(row => row.netInflow !== undefined).sort((a, b) => b.netInflow! - a.netInflow!).slice(0, 10);
  const max = Math.max(1, ...rank.map(row => Math.abs(row.netInflow!)));
  return <Card size="small" title={title}>{rank.length ? rank.map(row => <div key={row.code} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '7px 0' }}>
    <Button type="link" style={{ width: 100, padding: 0, textAlign: 'left', overflow: 'hidden' }} onClick={() => select(row.code)}>{row.name}</Button>
    <div style={{ flex: 1, background: 'var(--vscode-input-background, #ddd)', height: 8 }}><div style={{ width: `${Math.abs(row.netInflow!) / max * 100}%`, height: 8, background: marketColor(row.netInflow) }} /></div>
    <span style={{ minWidth: 80, textAlign: 'right', color: marketColor(row.netInflow) }}>{marketMoney(row.netInflow)}</span>
  </div>) : <Empty description="暂无资金流数据" />}</Card>;
}

export default function SectorBoards() {
  const history = useHistory(); const location = useLocation(); const { bkCode } = useParams<{ bkCode?: string }>();
  const [tab, setTab] = useState('industry'); const [keyword, setKeyword] = useState(''); const [page, setPage] = useState(1); const [stock, setStock] = useState<string>();
  useEffect(() => { const query = new URLSearchParams(location.search); setTab(query.get('kind') === 'concept' ? 'concept' : 'industry'); setKeyword(query.get('kw') || ''); }, [location.search]);
  useEffect(() => setPage(1), [bkCode]);
  const state = useMarketState(); const actions = useMarketActions();
  const overview = useMarketQuery<BoardOverview>('overview', {}, 60000, !bkCode);
  const quote = useMarketQuery<Omit<SectorBoard, 'kind'>>('boardQuote', { code: bkCode }, 15000, !!bkCode);
  const members = useMarketQuery<MarketPage<MarketStock>>('members', { code: bkCode, page }, 15000, !!bkCode);
  const leaders = useMarketQuery<MarketPage<MarketStock>>('leaders', { page }, 60000, !bkCode && tab === 'leaders');
  const data = overview.result?.data;
  const all = [...(data?.industry || []), ...(data?.concept || [])]; const byCode = new Map(all.map(row => [row.code, row]));
  const rows = (tab === 'concept' ? data?.concept : data?.industry) || [];
  const filtered = rows.filter(row => `${row.name} ${row.code}`.toLowerCase().includes(keyword.trim().toLowerCase()));
  const select = (code: string) => history.push('/sector-boards/' + code + location.search);
  const follow = (code: string) => { void actions.act('follow', code, !state.followedBoards.includes(code)); };
  const refresh = () => { if (bkCode) { quote.refresh(); members.refresh(); } else { overview.refresh(); if (tab === 'leaders') leaders.refresh(); } };
  const q = quote.result?.data;
  const hot = rows.filter(row => row.percent !== undefined).sort((a, b) => b.percent! - a.percent!).slice(0, 5);
  const speed = rows.filter(row => row.speed !== undefined).sort((a, b) => Math.abs(b.speed!) - Math.abs(a.speed!)).slice(0, 5);
  return <div style={{ padding: 24, maxWidth: 1600, margin: '0 auto' }}>
    <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
      <div><Typography.Title level={3} style={{ margin: 0 }}>{bkCode ? q?.name || bkCode : '板块行情'}</Typography.Title><Typography.Text type="secondary">行业、概念、资金流与成分股 · 东方财富公开行情</Typography.Text></div>
      <Space>{bkCode && <Button onClick={() => history.push('/sector-boards' + location.search)}>返回板块列表</Button>}<Button onClick={() => history.push('/market-map' + (bkCode ? '?board=' + bkCode : ''))}>大盘云图</Button><Button loading={overview.loading || quote.loading || members.loading || leaders.loading} onClick={refresh}>刷新</Button></Space>
    </Space>
    {actions.error && <Alert type="error" showIcon message={actions.error} style={{ marginBottom: 12 }} />}
    <Card size="small" title="我的关注" style={{ marginBottom: 16 }}><Space wrap>{state.followedBoards.length ? state.followedBoards.map(code => <Tag key={code} closable onClick={() => select(code)} onClose={event => { event.preventDefault(); event.stopPropagation(); follow(code); }} style={{ cursor: 'pointer' }}>{byCode.get(code)?.name || (q?.code === code ? q.name : code)} {byCode.get(code)?.percent !== undefined ? marketPercent(byCode.get(code)?.percent) : q?.code === code ? marketPercent(q.percent) : ''}</Tag>) : <Typography.Text type="secondary">在板块列表或详情中点击「关注」，保存在本机配置。</Typography.Text>}</Space></Card>
    {bkCode ? <>
      <MarketStatus result={quote.result} error={quote.error} />
      <Space style={{ marginBottom: 16 }}><Tag>{bkCode}</Tag><Button type={state.followedBoards.includes(bkCode) ? 'default' : 'primary'} loading={actions.busy.includes(bkCode)} onClick={() => follow(bkCode)}>{state.followedBoards.includes(bkCode) ? '取消关注' : '关注板块'}</Button></Space>
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>{[
        ['指数', marketMoney(q?.price)], ['涨跌幅', marketPercent(q?.percent)], ['主力净流入', marketMoney(q?.netInflow)], ['换手率', marketPercent(q?.turnoverRate)],
      ].map(([title, value]) => <Col xs={12} lg={6} key={title}><Card size="small"><Statistic title={title} value={value} /></Card></Col>)}</Row>
      <Typography.Title level={4}>成分股</Typography.Title>
      <MarketStatus result={members.result} error={members.error} />
      <StockTable value={members.result?.data} loading={members.loading} onPage={setPage} onStock={setStock} />
    </> : <>
      <MarketStatus result={overview.result} error={overview.error} />
      {data?.partial && <Alert type="warning" showIcon message="当前板块数据不完整，概览和云图仅基于已取得的记录。" style={{ marginBottom: 12 }} />}
      {tab !== 'leaders' && <>
        <Space wrap style={{ marginBottom: 10 }}><strong>今日领涨</strong>{hot.map(row => <Button size="small" key={row.code} style={{ color: marketColor(row.percent) }} onClick={() => select(row.code)}>{row.name} {marketPercent(row.percent)}</Button>)}</Space>
        <div><Space wrap style={{ marginBottom: 20 }}><strong>涨速</strong>{speed.length ? speed.map(row => <Button size="small" key={row.code} style={{ color: marketColor(row.speed) }} onClick={() => select(row.code)}>{row.name} {marketPercent(row.speed)}</Button>) : '暂无涨速数据'}</Space></div>
        <Row gutter={[16, 16]} style={{ marginBottom: 20 }}><Col xs={24} lg={12}><FlowRank title="行业主力净流入 TOP10" rows={data?.industry || []} select={select} /></Col><Col xs={24} lg={12}><FlowRank title="概念主力净流入 TOP10" rows={data?.concept || []} select={select} /></Col></Row>
      </>}
      <Tabs activeKey={tab} onChange={value => { setTab(value); setPage(1); }}>
        <Tabs.TabPane key="industry" tab="行业板块" /><Tabs.TabPane key="concept" tab="概念板块" /><Tabs.TabPane key="leaders" tab="涨幅榜" />
      </Tabs>
      {tab === 'leaders' ? <><MarketStatus result={leaders.result} error={leaders.error} /><StockTable value={leaders.result?.data} loading={leaders.loading} onPage={setPage} onStock={setStock} /></> : <>
        <Input.Search allowClear value={keyword} placeholder="搜索板块名称或 BK 代码" onChange={event => setKeyword(event.target.value)} style={{ maxWidth: 480, marginBottom: 16 }} />
        <Table<SectorBoard> size="small" rowKey="code" dataSource={filtered} loading={overview.loading} pagination={{ pageSize: 20, showSizeChanger: true }} scroll={{ x: 1000 }} columns={[
          { title: '板块', key: 'name', render: (_, row) => <Button type="link" onClick={() => select(row.code)}>{row.name}<small> {row.code}</small></Button> },
          { title: '指数', dataIndex: 'price', render: value => marketMoney(value) },
          { title: '涨跌幅', dataIndex: 'percent', sorter: (a, b) => (a.percent ?? -Infinity) - (b.percent ?? -Infinity), render: value => <span style={{ color: marketColor(value) }}>{marketPercent(value)}</span> },
          { title: '主力净流入', dataIndex: 'netInflow', sorter: (a, b) => (a.netInflow ?? -Infinity) - (b.netInflow ?? -Infinity), render: value => <span style={{ color: marketColor(value) }}>{marketMoney(value)}</span> },
          { title: '换手率', dataIndex: 'turnoverRate', render: value => marketPercent(value) },
          { title: '上涨 / 下跌家数', key: 'breadth', render: (_, row) => `${row.rising ?? '—'} / ${row.falling ?? '—'}` },
          { title: '领涨股', dataIndex: 'leader', render: value => value || '—' },
          { title: '关注', key: 'follow', render: (_, row) => <Button size="small" loading={actions.busy.includes(row.code)} onClick={() => follow(row.code)}>{state.followedBoards.includes(row.code) ? '已关注' : '关注'}</Button> },
        ]} />
      </>}
    </>}
    <StockProfileModal code={stock} onClose={() => setStock(undefined)} />
  </div>;
}
