import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Collapse, Empty, Input, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import type { AgentState } from '../../../../src/shared/agent';
import { postMessage } from '@/utils/common';
import styles from './agent.module.less';
import AgentSkills from '@/components/agent-skills';

export default function LeekAgent() {
  const [state, setState] = useState<AgentState>({ sessions: [], skills: [], models: [] });
  const [text, setText] = useState(''); const [model, setModel] = useState(''); const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null); const follow = useRef(true);
  const selected = state.selected; const messages = selected?.messages || [];
  const current = messages[messages.length - 1]; const running = current?.status === 'running';
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.data?.command === 'agentState') setState(event.data.data);
      if (event.data?.command === 'agentAccepted') setText(old => old.trim() === event.data.data.text ? '' : old);
      if (event.data?.command === 'agentError') setError(event.data.data);
      if (event.data?.command === 'agentPrompt') setText(event.data.data);
    };
    window.addEventListener('message', receive); postMessage('getAgent'); postMessage('agentModels');
    return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(() => { if (!state.models.some(item => item.id === model)) setModel(state.models[0]?.id || ''); }, [state.models, model]);
  useEffect(() => { if (follow.current) end.current?.scrollIntoView?.({ block: 'nearest' }); }, [current?.text, current?.stage, selected?.id]);
  const send = () => { if (!text.trim() || !model || running) return; setError(''); follow.current = true; postMessage('agentSend', { text: text.trim(), model }); };
  return <div className={styles.agent} style={{ maxWidth: 1100, margin: '0 auto', padding: 12, minWidth: 0 }}>
    <Space wrap style={{ marginBottom: 12 }}><Typography.Title level={4} style={{ margin: 0 }}>LeekAgent</Typography.Title>
      <Button onClick={() => postMessage('agentNew')}>新会话</Button>
      <Select aria-label="会话" placeholder="选择历史会话" style={{ width: 200 }} value={selected?.id} onChange={id => { follow.current = true; postMessage('agentSelect', { id }); }} options={state.sessions.map(s => ({ value: s.id, label: s.title }))} />
      <Button disabled={!selected} onClick={() => postMessage('agentExport')}>导出</Button>
      <Popconfirm title="删除当前会话？正在生成的回答也会停止。" onConfirm={() => postMessage('agentDelete')}><Button disabled={!selected}>删除</Button></Popconfirm>
    </Space>
    <Space wrap style={{ marginBottom: 12 }}>
      <Select aria-label="模型来源" style={{ width: 260, maxWidth: '100%' }} placeholder="选择模型" value={model || undefined} onChange={setModel} disabled={running} options={state.models.map(m => ({ value: m.id, label: m.name }))} />
      <Button onClick={() => postMessage('agentModels')}>刷新模型</Button><Button onClick={() => postMessage('agentConfig')}>API 配置</Button><AgentSkills state={state} onUse={slash => setText('/' + slash + ' ')} />
    </Space>
    <Typography.Paragraph type="secondary">发送时，问题和所需行情、资讯或持仓资料将提交给所选模型。工具只读；保留最近 10 个会话，每个会话最近 10 轮。模型上下文最多使用最近 6 轮完整回答。</Typography.Paragraph>
    {!model && <Alert type="info" showIcon message="未发现模型。请刷新 IDE 模型列表，或填写 API 配置后再刷新。" style={{ marginBottom: 12 }} />}
    {(error || state.error) && <Alert closable onClose={() => setError('')} showIcon type="warning" message={error || state.error} style={{ marginBottom: 12 }} />}
    <Space wrap style={{ marginBottom: 12 }}>{state.skills.map(skill => <Button key={skill.slash} size="small" title={`${skill.description} · ${skill.source}`} onClick={() => setText('/' + skill.slash + ' ')}>/{skill.slash} · {skill.name}</Button>)}</Space>
    <div role="log" aria-label="LeekAgent 对话" aria-live="polite" onScroll={event => { const node = event.currentTarget; follow.current = node.scrollHeight - node.clientHeight - node.scrollTop < 80; }} style={{ maxHeight: '55vh', minHeight: 180, overflowY: 'auto', overflowWrap: 'anywhere' }}>
      {!messages.length && <Empty description="直接提问，或选择 Skill。个股解读示例：/explain sh600519" />}
      {messages.map(item => <Card key={item.id} size="small" style={{ marginBottom: 12 }} title={<Space wrap>{item.role === 'user' ? '你' : 'LeekAgent'}{item.model && <Tag>{item.model}</Tag>}{item.stage && <Typography.Text type="secondary">{item.stage}</Typography.Text>}</Space>}>
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{item.text || (item.status === 'running' ? '正在准备…' : '未生成内容')}</Typography.Paragraph>
        {item.error && <Alert showIcon type="warning" message={item.error} style={{ marginTop: 8 }} />}
        {!!item.traces?.length && <Collapse style={{ marginTop: 8 }}><Collapse.Panel header={`数据工具与原始证据（${item.traces.length}）`} key="evidence">{item.traces.map(trace => <div key={trace.id} style={{ marginBottom: 12 }}>
          <Space wrap><Tag color={trace.error ? 'orange' : 'blue'}>{trace.id}</Tag><strong>{trace.tool}</strong><small>{new Date(trace.at).toLocaleString()}</small></Space>
          <pre style={{ maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', marginTop: 6 }}>{trace.content}</pre>
        </div>)}</Collapse.Panel></Collapse>}
      </Card>)}<div ref={end} />
    </div>
    <Input.TextArea aria-label="向 LeekAgent 提问" value={text} maxLength={8000} autoSize={{ minRows: 3, maxRows: 8 }} placeholder="输入问题，Enter 发送，Shift+Enter 换行" onChange={e => setText(e.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !(event.nativeEvent as any).isComposing) { event.preventDefault(); send(); } }} />
    <Space wrap style={{ marginTop: 8 }}><Button type="primary" disabled={!text.trim() || !model || running} onClick={send}>发送</Button>
      <Button danger disabled={!running} onClick={() => postMessage('agentStop')}>停止生成</Button>
      <Typography.Text type="secondary">{running ? `${current?.stage || '正在生成'} · ${current?.model || '准备模型'}` : '切换页面后任务继续，可返回查看或手动停止。'}</Typography.Text>
    </Space>
  </div>;
}
