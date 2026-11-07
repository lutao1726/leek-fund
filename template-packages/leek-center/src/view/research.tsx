import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Collapse, Empty, Input, List, Popconfirm, Progress, Row, Select, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import { useHistory, useLocation } from 'react-router-dom';
import type { ResearchBody, ResearchJob, ResearchState, StockEvidence } from '../../../../src/shared/research';
import { postMessage } from '@/utils/common';
import state from '@/stores';
import { observer } from 'mobx-react';

const active = (status: string) => status === 'queued' || status === 'running';
const labels: Record<string, string> = { queued: '排队中', running: '进行中', completed: '已完成', partial: '部分完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' };
const timestamp = (value?: string) => value ? new Date(value).toLocaleString('zh-CN') : '未提供';
const safeLink = (url?: string) => url && /^https?:\/\//i.test(url) ? url : undefined;

function Report({ report }: { report: ResearchBody }) {
  const sections: [string, string[]][] = [['支持依据', report.support], ['反对依据', report.counter],
    ['后续观察条件', report.conditions], ['判断失效条件', report.invalidation], ['数据缺口与限制', report.limitations]];
  return <>
    <Typography.Paragraph strong style={{ whiteSpace: 'pre-wrap' }}>{report.summary}</Typography.Paragraph>
    {sections.map(([title, items]) => <div key={title} style={{ marginTop: 18 }}><Typography.Title level={5}>{title}</Typography.Title>
      <ul style={{ paddingLeft: 22 }}>{items.map((item, index) => <li key={index} style={{ whiteSpace: 'pre-wrap', marginBottom: 6 }}>{item}</li>)}</ul></div>)}
  </>;
}

function Evidence({ evidence }: { evidence: StockEvidence }) {
  return <Collapse style={{ marginTop: 16 }}><Collapse.Panel header="原始证据、来源与时间" key="sources">
    <Typography.Paragraph type="secondary">采集于 {timestamp(evidence.capturedAt)}。行情时间与采集时间分别记录，历史报告保留当时快照。</Typography.Paragraph>
    {evidence.limitations.map((item, index) => <Typography.Paragraph type="secondary" key={index}>{item}</Typography.Paragraph>)}
    {evidence.sources.map(source => <Card size="small" key={source.id} style={{ marginTop: 10 }} title={<Space wrap><Tag>{source.id}</Tag>{source.title}<Tag color={source.status === 'available' ? 'green' : 'orange'}>{source.status === 'available' ? '可用' : '缺失'}</Tag></Space>}>
      <div>数据截至：{source.asOf || '未提供'} · 采集时间：{timestamp(source.fetchedAt)}</div>
      {safeLink(source.url) && <Typography.Link href={safeLink(source.url)} target="_blank" rel="noreferrer">查看来源</Typography.Link>}
      {source.content && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflow: 'auto', marginTop: 10 }}>{source.content}</pre>}
    </Card>)}
  </Collapse.Panel></Collapse>;
}

function Detail({ job }: { job: ResearchJob }) {
  const exposure = job.exposure;
  return <>
    {job.error && <Alert showIcon type="warning" message={job.error} style={{ marginBottom: 16 }} />}
    {exposure && <Card size="small" title="组合客观指标 · 同币种持仓市值口径" style={{ marginBottom: 16 }}>
      <Table size="small" rowKey="currency" pagination={false} scroll={{ x: 650 }} dataSource={exposure.currencies} columns={[
        { title: '币种', dataIndex: 'currency' }, { title: '报价覆盖', render: (_, row) => `${row.quotedCount}/${row.count}` },
        { title: '已知市值', render: (_, row) => row.marketValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) },
        { title: '最大单票占比', render: (_, row) => row.largestPercent === undefined ? '数据不足' : `${row.largestPercent.toFixed(1)}%` },
        { title: '前三大占比', render: (_, row) => row.topThreePercent === undefined ? '数据不足' : `${row.topThreePercent.toFixed(1)}%` },
      ]} />
      {exposure.currencies.map(currency => <div key={currency.currency} style={{ marginTop: 12 }}>{currency.currency} 行业分布：{currency.industries.length ? currency.industries.map(industry => <Tag key={industry.name}>{industry.name} {industry.percent.toFixed(1)}%</Tag>) : '数据不足，暂不计算'}</div>)}
      {exposure.notes.map(note => <Typography.Paragraph type="secondary" key={note} style={{ marginTop: 8, marginBottom: 0 }}>{note}</Typography.Paragraph>)}
      {!!exposure.missingQuotes.length && <Alert type="warning" message={`缺少报价：${exposure.missingQuotes.join('、')}`} style={{ marginTop: 10 }} />}
      {!!exposure.unclassified.length && <Typography.Paragraph type="secondary">行业未知：{exposure.unclassified.join('、')}</Typography.Paragraph>}
    </Card>}
    {job.kind === 'portfolio' && job.report && <Card title="组合巡检结论" style={{ marginBottom: 16 }}><Report report={job.report} /></Card>}
    {!job.stocks.length && <Empty description={active(job.status) ? '任务正在准备，可离开此页，稍后回来查看' : '本次没有生成研究结果'} />}
    {job.stocks.map(stock => <Card title={`${stock.name} · ${stock.code}`} key={stock.code} style={{ marginBottom: 16 }}>
      {stock.report ? <Report report={stock.report} /> : stock.error ? <Alert showIcon type="warning" message={stock.error} /> : <Typography.Text type="secondary">{active(job.status) ? '正在采集证据或生成报告…' : '任务未完成，未生成报告'}</Typography.Text>}
      {stock.evidence && <Evidence evidence={stock.evidence} />}
    </Card>)}
  </>;
}

function Research() {
  const history = useHistory();
  const selected = new URLSearchParams(useLocation().search).get('job');
  const [snapshot, setSnapshot] = useState<ResearchState>({ jobs: [] });
  const [detail, setDetail] = useState<ResearchJob>();
  const [code, setCode] = useState<string>();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = snapshot.jobs.find(job => job.id === selected);
  const job = detail?.id === selected ? detail : undefined;
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const { command, data } = event.data || {};
      if (command === 'researchState') setSnapshot(data);
      if (command === 'researchDetail') setDetail(data || undefined);
      if (command === 'researchActionResult') {
        setBusy(false);
        if (data.success) { setError(''); history.replace(data.id ? `/research?job=${data.id}` : '/research'); }
        else { setError(data.error); message.error(data.error); }
      }
    };
    window.addEventListener('message', receive);
    postMessage('getResearch');
    return () => window.removeEventListener('message', receive);
  }, [history]);
  useEffect(() => { if (selected) postMessage('selectResearch', { id: selected }); }, [selected]);
  useEffect(() => {
    if (!selected && snapshot.jobs.length) history.replace(`/research?job=${snapshot.jobs[0].id}`);
  }, [selected, snapshot.jobs, history]);
  const act = (command: string, data?: object) => { setBusy(true); setError(''); postMessage(command, data); };
  const usage = snapshot.jobs.reduce((sum, item) => {
    item.usage.forEach(entry => { sum.input += entry.input || 0; sum.output += entry.output || 0; sum.estimate += (entry.estimatedInput || 0) + (entry.estimatedOutput || 0); sum.calls++; });
    return sum;
  }, { input: 0, output: 0, estimate: 0, calls: 0 });
  const jobs = snapshot.jobs.filter(item => (kind === 'all' || item.kind === kind) && item.title.toLowerCase().includes(search.toLowerCase()));
  const options = state.stock.stocks.filter(stock => /^(?:(?:sh|sz|bj)\d{6}|hk\d{5}|usr_[a-z0-9._-]+)$/i.test(stock.info.code)).map(stock => ({ value: stock.info.code, label: `${stock.info.name} ${stock.info.code}` }));
  const previous = job?.kind === 'stock' ? snapshot.jobs.find(item => item.kind === 'stock' && item.id !== job.id && item.createdAt < job.createdAt && item.title === job.title && ['completed', 'partial'].includes(item.status)) : undefined;
  return <div style={{ padding: 24, maxWidth: 1600, margin: '0 auto' }}>
    <Typography.Title level={3} style={{ marginTop: 0 }}>AI 研究与持仓巡检</Typography.Title>
    <Typography.Paragraph type="secondary">基于冻结证据生成报告，保留支持依据、反对依据和后续验证条件。任务在扩展后台运行，关闭页面后可继续。</Typography.Paragraph>
    <Space wrap style={{ marginBottom: 18 }}>
      <Select showSearch allowClear value={code} onChange={setCode} optionFilterProp="label" options={options} placeholder="选择自选股票" style={{ minWidth: 240 }} />
      <Button type="primary" disabled={!code || busy} onClick={() => act('startStockResearch', { code })}>分析个股</Button>
      <Button disabled={busy} onClick={() => act('startPortfolioResearch')}>一键持仓巡检</Button>
      <Button onClick={() => postMessage('executeCommand', 'leek-fund.openAiConfig')}>AI 配置</Button>
    </Space>
    {error && <Alert showIcon type="error" message={error} style={{ marginBottom: 16 }} />}
    {snapshot.storageError && <Alert showIcon type="warning" message={snapshot.storageError} style={{ marginBottom: 16 }} />}
    <Card size="small" style={{ marginBottom: 18 }}>
      <Row gutter={16}><Col xs={12} md={6}><Statistic title="真实输入 Token" value={usage.input} /></Col><Col xs={12} md={6}><Statistic title="真实输出 Token" value={usage.output} /></Col><Col xs={12} md={6}><Statistic title="单独估算 Token" value={usage.estimate} /></Col><Col xs={12} md={6}><Statistic title="已返回的模型调用" value={usage.calls} /></Col></Row>
      <Typography.Text type="secondary">仅统计保留的最近30份研究任务；估算按字符粗算，不并入真实用量。删除记录会同步移出统计。</Typography.Text>
    </Card>
    <Row gutter={[20, 20]}><Col xs={24} lg={8}><Card title="分析历史" size="small">
      <Input.Search value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索股票名称或报告标题" allowClear />
      <Select value={kind} onChange={setKind} style={{ width: '100%', marginTop: 10 }} options={[{ value: 'all', label: '全部研究' }, { value: 'stock', label: '个股研究' }, { value: 'portfolio', label: '持仓巡检' }]} />
      <List dataSource={jobs} locale={{ emptyText: '暂无研究记录' }} renderItem={item => <List.Item style={{ display: 'block', padding: 12, borderLeft: selected === item.id ? '3px solid #1890ff' : undefined }}>
        <Button type="link" style={{ padding: 0, height: 'auto', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => history.replace(`/research?job=${item.id}`)}>{item.title}</Button>
        <div style={{ marginTop: 6 }}><Tag color={active(item.status) ? 'blue' : item.status === 'failed' ? 'red' : 'default'}>{labels[item.status]}</Tag><Typography.Text type="secondary">{timestamp(item.createdAt)}</Typography.Text></div>
        <Typography.Text type="secondary">{item.stage}</Typography.Text>
      </List.Item>} />
    </Card></Col><Col xs={24} lg={16}>
      {current ? <><Card size="small" title={current.title} style={{ marginBottom: 16 }} extra={<Tag>{labels[current.status]}</Tag>}>
        <Typography.Paragraph type="secondary">{timestamp(current.createdAt)} · {current.model} · 历史范围 {current.range}</Typography.Paragraph>
        <Progress percent={Math.round(current.completed / Math.max(1, current.total) * 100)} status={current.status === 'failed' ? 'exception' : active(current.status) ? 'active' : 'normal'} />
        <Typography.Paragraph>{current.stage}</Typography.Paragraph>
        <Space wrap>
          {active(current.status) ? <Button disabled={busy} onClick={() => act('cancelResearch', { id: current.id })}>取消任务</Button> : <Button disabled={busy} onClick={() => act('retryResearch', { id: current.id })}>按最新数据重新分析</Button>}
          <Button disabled={!job} onClick={() => postMessage('exportResearch', { id: current.id })}>导出 Markdown</Button>
          {previous && <Button onClick={() => history.replace(`/research?job=${previous.id}`)}>查看上一份报告</Button>}
          {!active(current.status) && <Popconfirm title="删除这份研究记录及其证据？" onConfirm={() => act('deleteResearch', { id: current.id })}><Button danger disabled={busy}>删除记录</Button></Popconfirm>}
        </Space>
        {!!current.usage.length && <Typography.Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 0 }}>本次真实用量 {current.usage.reduce((sum, item) => sum + (item.input || 0) + (item.output || 0), 0)} Token · 返回 {current.usage.length} 次 · {current.finishedAt ? `结束于 ${timestamp(current.finishedAt)}` : '进行中'}</Typography.Paragraph>}
      </Card>{job ? <Detail job={job} /> : <Card loading />}</> : <Card><Empty description="选择一只自选股票或开始持仓巡检" /></Card>}
    </Col></Row>
  </div>;
}

export default observer(Research);
