import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Pagination, Select, Space, Typography } from 'antd';
import { useHistory, useLocation } from 'react-router-dom';
import type { BoardOverview, MarketPage, MarketStock, SectorBoard, StockScope } from '../../../../src/shared/market';
import { useMarketActions, useMarketQuery, useMarketState } from '@/services/market';
import { MarketMap, MarketStatus, StockProfileModal } from '@/components/market/shared';

export default function MarketCloudMap() {
  const history = useHistory(); const location = useLocation(); const board = new URLSearchParams(location.search).get('board') || undefined;
  const [scope, setScope] = useState('industry'); const [page, setPage] = useState(1); const [stock, setStock] = useState<string>();
  useEffect(() => setPage(1), [board, scope]);
  const state = useMarketState(); const actions = useMarketActions();
  const isBoardMap = !board && ['industry', 'concept'].includes(scope);
  const overview = useMarketQuery<BoardOverview>('overview', {}, 60000, isBoardMap);
  const quote = useMarketQuery<Omit<SectorBoard, 'kind'>>('boardQuote', { code: board }, 15000, !!board);
  const stocks = useMarketQuery<MarketPage<MarketStock>>(board ? 'members' : 'universe', board ? { code: board, page } : { scope: scope as StockScope, page }, board ? 15000 : 60000, !isBoardMap);
  const data = isBoardMap ? (scope === 'industry' ? overview.result?.data.industry : overview.result?.data.concept) || [] : stocks.result?.data.items || [];
  const query = isBoardMap ? overview : stocks;
  const tiles = data.map(row => ({ id: row.code, name: row.name, weight: row.marketCap || 0, percent: row.percent }));
  return <div style={{ padding: 24, maxWidth: 1800, margin: '0 auto' }}>
    <Space wrap style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
      <div><Typography.Title level={3} style={{ margin: 0 }}>{board ? (quote.result?.data.name || board) + ' · 成分股云图' : '大盘云图'}</Typography.Title><Typography.Text type="secondary">板块与个股涨跌分布 · 数据源：东方财富</Typography.Text></div>
      <Space wrap>
        {board ? <Button onClick={() => history.push('/market-map')}>返回大盘云图</Button> : <Select aria-label="云图范围" value={scope} style={{ width: 190 }} onChange={setScope} options={[{ value: 'industry', label: '行业板块' }, { value: 'concept', label: '概念板块' }, { value: 'all', label: 'A股 · 按市值分页' }, { value: 'star', label: '科创板 · 按市值分页' }, { value: 'chinext', label: '创业板 · 按市值分页' }]} />}
        <Button onClick={() => history.push('/sector-boards' + (board ? '/' + board : ''))}>板块行情</Button>
        {board && <Button onClick={() => { void actions.act('follow', board, !state.followedBoards.includes(board)); }} loading={actions.busy.includes(board)}>{state.followedBoards.includes(board) ? '取消关注' : '关注板块'}</Button>}
        <Button loading={query.loading || quote.loading} onClick={() => { query.refresh(); if (board) quote.refresh(); }}>刷新</Button>
      </Space>
    </Space>
    <MarketStatus result={query.result} error={query.error || actions.error} />
    {board && quote.error && <Alert type="warning" message={quote.error} style={{ marginBottom: 12 }} />}
    {isBoardMap ? <Alert type="info" showIcon message="板块成分可能重叠，面积之和不代表全市场总市值。" style={{ marginBottom: 16 }} /> : <Alert type="info" showIcon message={`当前展示第 ${page} 页，${stocks.result?.data.items.length || 0} / ${stocks.result?.data.total || 0} 只。${board ? '成分股按涨幅分页' : '个股按市值分页'}，当前页的颜色分布不代表全市场涨跌比例。`} style={{ marginBottom: 16 }} />}
    {isBoardMap && overview.result?.data.partial && <Alert type="warning" message="部分板块数据不可用，当前云图仅展示已获取的条目。" />}
    <Card loading={query.loading && !query.result}>
      <MarketMap tiles={tiles} onSelect={code => { if (isBoardMap) history.push('/market-map?board=' + code); else setStock(code); }} />
    </Card>
    {!isBoardMap && <Pagination style={{ marginTop: 16 }} current={page} pageSize={100} total={stocks.result?.data.total || 0} showSizeChanger={false} onChange={setPage} />}
    <StockProfileModal code={stock} onClose={() => setStock(undefined)} />
  </div>;
}
