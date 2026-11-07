import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Checkbox, Col, Empty, Input, List, Row, Select, Space, Statistic, Table, Tag, Tooltip, Typography } from 'antd';
import { useHistory } from 'react-router-dom';
import type { DailySummarySnapshot, SummaryRow } from '../../../../src/shared/dailySummary';
import { postMessage } from '@/utils/common';
import { filterSummaryNews, filterSummaryRows } from '@/utils/dailySummary';

const money = (value?: number) => value === undefined ? '—' : value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gain = (value?: number, suffix = '') => <span className={value === undefined ? '' : value > 0 ? 'red' : value < 0 ? 'green' : ''}>{value === undefined ? '—' : `${value > 0 ? '+' : ''}${money(value)}${suffix}`}</span>;
const timestamp = (value?: string | number) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未提供';
const turnover = (value?: number) => value === undefined ? '—' : value >= 1e8 ? `${(value / 1e8).toFixed(2)}亿` : value >= 1e4 ? `${(value / 1e4).toFixed(2)}万` : money(value);

export default function DailySummary() {
  const history = useHistory();
  const [snapshot, setSnapshot] = useState<DailySummarySnapshot>();
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [scope, setScope] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('absolute');
  const [currency, setCurrency] = useState('CNY');
  const [moving, setMoving] = useState(false);
  const [newsScope, setNewsScope] = useState('today');
  const [heldNews, setHeldNews] = useState(false);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const { command, data } = event.data || {};
      if (command === 'dailySummarySnapshot') { setSnapshot(data); }
      if (command === 'dailySummaryError') { setError(data); setRefreshing(false); }
      if (command === 'dailySummaryRefreshing') setRefreshing(data === true);
    };
    window.addEventListener('message', receive);
    postMessage('startDailySummary');
    return () => { window.removeEventListener('message', receive); postMessage('stopDailySummary'); };
  }, []);
  const openReport = (id: string) => history.push(`/research?job=${encodeURIComponent(id)}`);
  const rows = snapshot ? filterSummaryRows(snapshot.rows, { scope, search, sort, currency, moving }) : [];
  const news = snapshot ? filterSummaryNews(snapshot, newsScope, heldNews) : [];
  const columns = [
    { title: '标的', key: 'stock', render: (_: unknown, row: SummaryRow) => <><Button type="link" style={{ padding: 0 }} onClick={() => postMessage('openDailySummaryStock', { code: row.code })}>{row.name}</Button><div style={{ opacity: 0.65 }}>{row.code} · {row.currency === 'unknown' ? '币种未确认' : row.currency}</div><Space size={0}>{row.held && <Tag color="blue">持仓</Tag>}{row.watched && <Tag>自选</Tag>}</Space></> },
    { title: '现价 / 涨跌幅', key: 'price', render: (_: unknown, row: SummaryRow) => <>{money(row.price)}<div>{gain(row.percent, '%')}</div></> },
    { title: '成交额', key: 'turnover', render: (_: unknown, row: SummaryRow) => turnover(row.turnover) },
    { title: '行情时间', key: 'time', render: (_: unknown, row: SummaryRow) => <>{row.quoteTime || '未提供'}{row.quoteDate && row.quoteDate !== snapshot?.date && <div><Tag color="orange">历史报价</Tag></div>}{row.price === undefined && <div><Tag color="orange">报价缺失</Tag></div>}</> },
    { title: '已有研究', key: 'report', render: (_: unknown, row: SummaryRow) => <>
      {row.latestReport ? <Tooltip title={row.latestReport.summary}><Button type="link" style={{ padding: 0 }} onClick={() => openReport(row.latestReport!.jobId)}>查看报告</Button></Tooltip> : <Typography.Text type="secondary">暂无可用报告</Typography.Text>}
      {row.latestReport && <div style={{ opacity: 0.7 }}>{timestamp(row.latestReport.at)}{row.latestReport.old && <Tag color="orange">已满7个自然日</Tag>}{row.latestReport.partial && <Tag>部分结果</Tag>}</div>}
      {row.latestAttempt && ['running', 'queued'].includes(row.latestAttempt.status) && <Button type="link" style={{ padding: 0 }} onClick={() => openReport(row.latestAttempt!.jobId)}>研究进行中</Button>}
      {row.latestAttempt && ['failed', 'interrupted'].includes(row.latestAttempt.status) && <Button type="link" style={{ padding: 0 }} onClick={() => openReport(row.latestAttempt!.jobId)}>查看最近失败或中断任务</Button>}
    </> },
  ];
  return <div style={{ padding: 24, maxWidth: 1600, margin: '0 auto' }}>
    <Space wrap style={{ width: '100%', justifyContent: 'space-between', marginBottom: 18 }}>
      <div><Typography.Title level={3} style={{ margin: 0 }}>今日摘要{snapshot ? ` · ${snapshot.date}` : ''}</Typography.Title><Typography.Text type="secondary">自选变化、持仓与相关资讯 · 上海日期 · 更新于 {timestamp(snapshot?.generatedAt)}</Typography.Text></div>
      <Space wrap><Button loading={refreshing} onClick={() => { setError(''); postMessage('refreshDailySummary'); }}>刷新行情</Button><Button onClick={() => history.push('/portfolio')}>资产管理</Button><Button onClick={() => history.push('/research')}>AI 研究</Button></Space>
    </Space>
    {error && <Alert showIcon type="warning" message={error} style={{ marginBottom: 16 }} />}
    {!snapshot ? error ? <Empty description="摘要尚未就绪，请刷新重试" /> : <Card loading /> : <>
      <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="自选 / 持仓标的" value={`${snapshot.counts.watched} / ${snapshot.counts.held}`} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="涨跌幅绝对值 ≥ 3%" value={snapshot.counts.moving} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="今日相关快讯（缓存范围）" value={snapshot.news.today} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="已有报告 / 在途任务" value={`${snapshot.counts.researched} / ${snapshot.counts.activeResearch}`} /></Card></Col>
      </Row>
      <Alert showIcon type={snapshot.counts.missing ? 'warning' : 'info'} message={`已有报价 ${snapshot.counts.quoted}/${snapshot.rows.length} · 行情日期 ${snapshot.quoteDates.join('、') || '未提供'}${snapshot.counts.missing ? ` · ${snapshot.counts.missing}个标的缺少报价` : ''}`} description="行情涨跌对应来源交易日；休市和跨市场时可能不是今日数据。摘要不会自动调用 AI。" style={{ marginBottom: 18 }} />
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>{snapshot.currencies.map(total => <Col xs={24} lg={8} key={total.currency}><Card size="small" title={`${total.currency} 持仓概览`} extra={<Tag>{total.missingQuotes ? '估值不完整' : '已有行情估值'}</Tag>}>
        <Statistic title="已知持仓市值" value={total.marketValue} precision={2} />
        <Row gutter={12} style={{ marginTop: 12 }}><Col span={12}><div>浮动盈亏</div>{gain(total.profit)}</Col><Col span={12}><div>{total.dailyLabel}</div>{total.missingDailyQuotes ? <Tooltip title={`${total.missingDailyQuotes}条记录暂不可估算，仅显示已知部分`}>{gain(total.todayProfit)} <Tag color="orange">部分估算</Tag></Tooltip> : gain(total.todayProfit)}</Col></Row>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>最大单票占比 {total.exposure?.largestPercent === undefined ? '数据不足' : `${total.exposure.largestPercent.toFixed(1)}%`} · 仅同币种股票持仓，不含现金</Typography.Paragraph>
        <Typography.Text type="secondary">行情日 {total.dates.join('、') || '未提供'}</Typography.Text>
      </Card></Col>)}</Row>
      {snapshot.latestInspection && <Card size="small" title="最近可用持仓巡检" extra={<Button type="link" onClick={() => openReport(snapshot.latestInspection!.jobId)}>查看巡检</Button>} style={{ marginBottom: 20 }}><Typography.Paragraph ellipsis={{ rows: 3, expandable: true }}>{snapshot.latestInspection.summary}</Typography.Paragraph><Typography.Text type="secondary">{timestamp(snapshot.latestInspection.at)} · 历史快照，当前持仓可能已变化</Typography.Text></Card>}
      <Card title="自选与持仓变化" style={{ marginBottom: 20 }}>
        <Space wrap style={{ marginBottom: 16 }}>
          <Select aria-label="标的范围" value={scope} onChange={setScope} style={{ width: 130 }} options={[{ value: 'all', label: '全部标的' }, { value: 'watched', label: '仅自选' }, { value: 'held', label: '仅持仓' }]} />
          <Input.Search aria-label="搜索摘要标的" value={search} onChange={event => setSearch(event.target.value)} allowClear placeholder="名称、代码或行业" style={{ width: 220 }} />
          <Select aria-label="摘要排序" value={sort} onChange={setSort} style={{ width: 160 }} options={[{ value: 'absolute', label: '涨跌幅绝对值' }, { value: 'up', label: '涨幅优先' }, { value: 'down', label: '跌幅优先' }, { value: 'turnover', label: '成交额优先' }]} />
          {sort === 'turnover' && <Select aria-label="成交额币种" value={currency} onChange={setCurrency} style={{ width: 130 }} options={[{ value: 'CNY', label: '人民币标的' }, { value: 'HKD', label: '港币标的' }, { value: 'USD', label: '美元标的' }, { value: 'unknown', label: '其他标的' }]} />}
          <Checkbox checked={moving} onChange={event => setMoving(event.target.checked)}>仅涨跌幅 ≥ 3%（绝对值）</Checkbox>
        </Space>
        <Table rowKey="code" dataSource={rows} columns={columns} scroll={{ x: 950 }} pagination={{ pageSize: 10, hideOnSinglePage: true }} locale={{ emptyText: <Empty description={snapshot.rows.length ? '没有符合筛选条件的标的' : '添加自选或持仓后，这里会汇总行情与研究'} /> }} />
      </Card>
      <Card title="相关快讯" extra={<Typography.Text type="secondary">缓存接收于 {timestamp(snapshot.news.updatedAt)}</Typography.Text>} style={{ marginBottom: 20 }}>
        <Space wrap style={{ marginBottom: 16 }}><Select aria-label="快讯时间范围" value={newsScope} onChange={setNewsScope} style={{ width: 150 }} options={[{ value: 'today', label: '今日发布' }, { value: 'recent', label: '最近3个自然日' }, { value: 'all', label: '全部缓存' }]} /><Checkbox checked={heldNews} onChange={event => setHeldNews(event.target.checked)}>仅关联持仓</Checkbox><Typography.Text type="secondary">最近 {snapshot.news.cached} 条缓存中关联 {snapshot.news.matched} 条 · 关键词匹配，需核实原文</Typography.Text></Space>
        <List dataSource={news} pagination={news.length > 10 ? { pageSize: 10 } : false} locale={{ emptyText: <Empty description={snapshot.news.cached ? '当前范围没有匹配快讯，可切换时间范围或查看新闻快讯' : '暂无共享快讯缓存，等待现有数据源推送'} /> }} renderItem={item => <List.Item style={{ display: 'block' }}>
          <Space wrap><Tag>{item.source === 'xgb' ? '选股宝' : '金十'}</Tag><Typography.Text type="secondary">发布于 {timestamp(item.time)}{item.date && item.date !== snapshot.date ? ' · 历史快讯' : ''}</Typography.Text></Space>
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginTop: 8 }} ellipsis={{ rows: 4, expandable: true }}>{item.text}</Typography.Paragraph>
          <Space wrap>{item.matches.map(match => <Tag key={match.code} color={match.held ? 'blue' : undefined}>{match.name} · {match.reason}{match.held ? ' · 持仓' : ''}</Tag>)}</Space>
        </List.Item>} />
      </Card>
      {snapshot.notes.map(note => <Typography.Paragraph key={note} type="secondary" style={{ marginBottom: 8 }}>{note}</Typography.Paragraph>)}
    </>}
  </div>;
}
