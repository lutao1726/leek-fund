import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Input, List, Row, Select, Space, Spin, Tabs, Tag, Typography, message } from 'antd';
import { BookOutlined, ReloadOutlined, ExportOutlined, GithubOutlined } from '@ant-design/icons';
import type { LearningArticle, LearningCatalog, LearningResource, LearningResult } from '../../../../src/shared/learning';
import { useLearningClient } from '@/services/learning';
import LearningMarkdown from '@/components/learning-markdown';
import LearningVisual from '@/components/learning-visual';
import './learning.less';

const kinds: Record<string, string> = { md: '文章', html: '可视化', pdf: 'PDF', xlsx: '复盘表格', xls: '复盘表格', mm: '思维导图' };
const timestamp = (value?: string) => value ? new Date(value).toLocaleString('zh-CN') : '尚未同步';
export default function Learning() {
  const request = useLearningClient();
  const [mode, setMode] = useState('reading');
  const [account, setAccount] = useState<string>(); const [connecting, setConnecting] = useState(false);
  const [content, setContent] = useState<{ catalog?: LearningResult<LearningCatalog>; selected: string; force: boolean; version: number }>({ selected: '', force: false, version: 0 });
  const { catalog, selected } = content;
  const [article, setArticle] = useState<LearningResult<LearningArticle>>();
  const [category, setCategory] = useState('all'); const [kind, setKind] = useState('all'); const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false); const [reading, setReading] = useState(false);
  const [error, setError] = useState(''); const [articleError, setArticleError] = useState('');
  const mounted = useRef(true);
  const sync = useCallback(async (force = false, connect = false) => {
    setLoading(true); setError('');
    if (connect) setConnecting(true);
    try {
      const result = await request<LearningResult<LearningCatalog>>(connect ? 'learningConnectGitHub' : 'learningCatalog', { force }, connect ? 300000 : 45000);
      if (!mounted.current) return;
      setContent(previous => ({ catalog: result, force, version: previous.version + 1,
        selected: result.value.items.some(item => item.path === previous.selected) ? previous.selected
          : result.value.items.find(item => item.category === '交易体系' && item.kind === 'md')?.path || result.value.items[0]?.path || '' }));
    } catch (failure) { if (mounted.current) setError((failure as Error).message); }
    finally { if (mounted.current) { setLoading(false); setConnecting(false); } }
  }, [request]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source && event.source !== window) return;
      if (event.data?.command === 'learningAuthState') setAccount(typeof event.data.data?.account === 'string' ? event.data.data.account : undefined);
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(() => { mounted.current = true; void sync(); return () => { mounted.current = false; }; }, [sync]);
  const item = catalog?.value.items.find(item => item.path === selected);
  useEffect(() => {
    let active = true; setArticleError('');
    if (!item || item.kind !== 'md') { setArticle(undefined); setReading(false); return; }
    const force = content.force;
    setArticle(previous => previous?.value.path === item.path && previous.value.sha === item.sha ? previous : undefined);
    setReading(true);
    request<LearningResult<LearningArticle>>('learningArticle', { path: item.path, force }).then(result => {
      if (active) setArticle(result);
    }).catch(failure => { if (active) setArticleError(failure.message); }).finally(() => { if (active) setReading(false); });
    return () => { active = false; };
  }, [item, content.version, content.force, request]);
  const resources = useMemo(() => (catalog?.value.items || []).filter(item =>
    (category === 'all' || item.category === category) && (kind === 'all' || item.kind === kind)
    && `${item.path} ${item.title}`.toLowerCase().includes(search.trim().toLowerCase())), [catalog, category, kind, search]);
  useEffect(() => { setPage(1); }, [category, kind, search]);
  const open = async (resource?: LearningResource, visual = false) => {
    try { await request('learningOpen', { path: resource?.path, visual }); }
    catch (failure) { if (mounted.current) message.error((failure as Error).message); }
  };
  const topics = new Set(catalog?.value.items.filter(item => item.category === '游资心法').map(item => item.topic));
  const currentArticle = article?.value.path === selected && article.value.sha === item?.sha ? article : undefined;
  return <div className="learning-page">
    <div className="learning-heading"><div><Typography.Title level={3}><BookOutlined /> 学习专栏</Typography.Title>
      <Typography.Paragraph type="secondary">交易体系 · 游资心法 · 复盘模板 · 可视化资料</Typography.Paragraph></div>
      <Space wrap><Button icon={<ExportOutlined />} onClick={() => void open()}>来源仓库</Button>
        <Button icon={<GithubOutlined />} loading={connecting} disabled={!connecting && (loading || reading)} onClick={() => void sync(true, true)}>{account ? '切换 GitHub 账号' : '使用 GitHub 账号'}</Button>
        <Button type="primary" icon={<ReloadOutlined />} loading={loading || reading} disabled={connecting} onClick={() => void sync(true)}>刷新内容</Button></Space></div>
    <div className="learning-meta"><Space wrap><Tag color="blue">{catalog?.value.items.length || 0} 份资料</Tag><Tag>{topics.size} 个游资专题</Tag>
      <span>{catalog?.source === 'bundled' ? '内置目录时间' : '上次同步'}：{timestamp(catalog?.value.fetchedAt)}</span>{catalog?.stale && <Tag color="orange">{catalog.source === 'bundled' ? '内置目录' : '离线缓存'}</Tag>}</Space></div>
    <Typography.Paragraph type="secondary">{account ? `同步账号：${account}（VSCode GitHub）` : '当前使用匿名请求，可连接 VSCode 已登录的 GitHub 账号同步。'}</Typography.Paragraph>
    {(error || catalog?.error) && <Alert showIcon type="warning" message={error || catalog?.error} style={{ marginBottom: 16 }} />}
    <Tabs activeKey={mode} onChange={setMode} destroyInactiveTabPane>
      <Tabs.TabPane tab="资料阅读" key="reading">
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={9} xl={8}><Card title="资料目录" className="learning-directory">
        <Input.Search aria-label="搜索学习资料" placeholder="搜索游资、文章或文件名" allowClear value={search} onChange={event => setSearch(event.target.value)} />
        <div className="learning-filters"><Select aria-label="资料分类" value={category} onChange={setCategory}>
          <Select.Option value="all">全部分类</Select.Option>{Array.from(new Set(catalog?.value.items.map(item => item.category))).map(value => <Select.Option key={value} value={value}>{value}</Select.Option>)}
        </Select><Select aria-label="资料类型" value={kind} onChange={setKind}><Select.Option value="all">全部类型</Select.Option>
          {Array.from(new Set(catalog?.value.items.map(item => item.kind))).map(value => <Select.Option key={value} value={value}>{kinds[value] || value.toUpperCase()}</Select.Option>)}
        </Select></div>
        <List loading={loading} dataSource={resources} locale={{ emptyText: <Empty description={catalog ? '没有匹配的资料' : '点击刷新内容加载资料'} /> }}
          pagination={resources.length > 10 ? { current: page, pageSize: 10, onChange: setPage, size: 'small', showSizeChanger: false } : false}
          renderItem={resource => <List.Item className={selected === resource.path ? 'learning-selected' : ''}>
            <button className="learning-resource" aria-pressed={selected === resource.path} onClick={() => setContent(previous => ({ ...previous, selected: resource.path, force: false }))}>
              <span className="learning-resource-title">{resource.title}</span><span><Tag>{kinds[resource.kind] || resource.kind.toUpperCase()}</Tag>{resource.topic}</span>
            </button></List.Item>} />
      </Card></Col>
      <Col xs={24} lg={15} xl={16}><Card className="learning-reader" title={item ? <Space wrap><span>{item.category === '游资心法' ? `${item.topic} · ` : ''}{item.title}</span></Space> : '开始学习'}
        extra={item && <Button size="small" icon={<ExportOutlined />} onClick={() => void open(item)}>查看原文</Button>}>
        {item && <Typography.Paragraph type="secondary" className="learning-path">{item.path}</Typography.Paragraph>}
        {(articleError || currentArticle?.error) && <Alert type="warning" showIcon message={articleError || currentArticle?.error} style={{ marginBottom: 16 }} />}
        <Spin spinning={reading}>
          {currentArticle ? <><div className="learning-article-meta">内容获取：{timestamp(currentArticle.value.fetchedAt)}{currentArticle.stale && ' · 缓存内容'}</div>
            <LearningMarkdown text={currentArticle.value.text} /></>
            : item && item.kind !== 'md' ? <Empty description={`${kinds[item.kind] || item.kind.toUpperCase()}资料，请打开查看或下载`}>
              <Button type="primary" onClick={() => item.kind === 'html' ? setMode('visual') : void open(item)}>{item.kind === 'html' ? '打开可视化' : '打开资料'}</Button>
            </Empty> : <Empty description={reading ? '正在获取文章…' : item ? '文章暂未加载，请刷新重试或查看原文' : '从左侧选择一份学习资料'} />}
        </Spin>
      </Card></Col>
    </Row>
      </Tabs.TabPane>
      <Tabs.TabPane tab="可视化学习" key="visual"><LearningVisual openExternal={() => void open(undefined, true)} /></Tabs.TabPane>
    </Tabs>
    <Typography.Paragraph type="secondary" className="learning-attribution">资料来源：zhouqinglong520 / trading-mastery，版权归原作者所有。内容仅供学习交流，不构成投资建议。</Typography.Paragraph>
  </div>;
}
