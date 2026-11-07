import React, { useEffect, useState } from 'react';
import { Alert, Button, Empty, Input, Modal, Popconfirm, Space, Switch, Tag, Typography } from 'antd';
import type { AgentSkillEntry, AgentState } from '../../../../src/shared/agent';
import { postMessage } from '@/utils/common';
import styles from '@/view/agent.module.less';

export default function AgentSkills({ state, onUse }: { state: AgentState; onUse: (slash: string) => void }) {
  const [visible, setVisible] = useState(false); const [search, setSearch] = useState(''); const [url, setUrl] = useState('');
  const [detail, setDetail] = useState<AgentSkillEntry>(); const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'warning' | 'error' | 'info'; text: string }>();
  const busy = pending || !!state.skillBusy; const catalog = state.skillCatalog || [];
  const filtered = catalog.filter(skill => `${skill.name} ${skill.slash} ${skill.description} ${skill.source}`.toLowerCase().includes(search.trim().toLowerCase()));
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.data?.command === 'agentSkillDetail') setDetail(event.data.data);
      if (event.data?.command !== 'agentSkillResult') return;
      setPending(false); const data = event.data.data;
      if (data.cancelled) { setNotice({ type: 'info', text: '已取消导入' }); return; }
      if (!data.success) { setNotice({ type: 'error', text: data.error || 'Skill 操作失败' }); return; }
      if (!data.result) { setNotice({ type: 'success', text: 'Skill 设置已更新' }); return; }
      const { installed, skipped } = data.result;
      setNotice({ type: skipped.length ? 'warning' : 'success', text: `已安装 ${installed.length} 个${installed.length ? '：' + installed.join('、') : ''}。新安装 Skill 默认停用，请查看正文后启用。` + (skipped.length ? `\n跳过 ${skipped.length} 个：\n${skipped.join('\n')}` : '') });
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, []);
  const act = (command: string, data?: object) => { setPending(true); setNotice(undefined); postMessage(command, data || {}); };
  return <>
    <Button onClick={() => setVisible(true)}>Skills 管理</Button>
    <Modal className={styles.agent} visible={visible} title="Skill 安装与启用" width={780} onCancel={() => setVisible(false)} footer={<Space wrap>{pending && <Button onClick={() => postMessage('agentSkillCancel')}>取消导入</Button>}<Button disabled={busy} onClick={() => postMessage('agentSkills')}>刷新列表</Button><Button onClick={() => setVisible(false)}>完成</Button></Space>}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, width: '100%', marginBottom: 12, alignItems: 'center' }}>
        <Typography.Text>{catalog.filter(skill => skill.enabled && skill.effective !== false).length}/{catalog.length} 个已启用</Typography.Text>
        <Input aria-label="搜索 Skill" placeholder="搜索 Skill" allowClear value={search} onChange={event => setSearch(event.target.value)} style={{ width: 180, maxWidth: '100%' }} /><Button disabled={busy} onClick={() => act('agentSkillDirectory')}>导入目录</Button><Button disabled={busy} onClick={() => act('agentSkillZip')}>导入 ZIP</Button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, width: '100%' }}><Input aria-label="GitHub Skill 仓库" placeholder="https://github.com/所有者/仓库" value={url} onChange={event => setUrl(event.target.value)} disabled={busy} style={{ flex: '1 1 230px', minWidth: 0 }} /><Button loading={busy} disabled={!url.trim() || busy} onClick={() => act('agentSkillGithub', { url: url.trim() })}>从 GitHub 安装</Button></div>
      <Typography.Paragraph type="secondary">支持单个 Skill 或技能集合，只导入 SKILL.md 正文。脚本、附件、MCP 及第三方工具声明不执行。新导入默认停用；启用后可使用 LeekAgent 只读数据工具。</Typography.Paragraph>
      {notice && <Alert showIcon type={notice.type} message={<span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{notice.text}</span>} style={{ marginBottom: 12 }} />}
      {!!state.skillErrors?.length && <Alert showIcon type="warning" message="部分 Skills 未加载" description={state.skillErrors.join('；')} style={{ marginBottom: 12 }} />}
      <div style={{ maxHeight: '46vh', overflowY: 'auto' }}>
        {!filtered.length && <Empty description={search ? '没有匹配的 Skill' : '没有可管理的 Skill'} />}
        {filtered.map(skill => <div key={skill.id} style={{ padding: '12px 4px', borderBottom: '1px solid var(--vscode-panel-border, #ddd)', overflowWrap: 'anywhere' }}>
          <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}><Space wrap><Typography.Text strong>{skill.name}</Typography.Text><Tag>{skill.builtin ? '内置' : '已安装'}</Tag>{skill.effective === false && <Tag>已被覆盖</Tag>}<Typography.Text type="secondary">/{skill.slash} · {skill.source}</Typography.Text></Space>
            <Switch aria-label={`启用 ${skill.name}`} checked={skill.enabled && skill.effective !== false} disabled={busy || skill.effective === false} checkedChildren="启用" unCheckedChildren="停用" onChange={enabled => act('agentSkillToggle', { id: skill.id, enabled })} />
          </Space>
          <Typography.Paragraph style={{ margin: '6px 0' }}>{skill.description}</Typography.Paragraph>
          <Space wrap><Button size="small" onClick={() => postMessage('agentSkillDetail', { id: skill.id })}>查看正文</Button><Button size="small" disabled={!skill.enabled || skill.effective === false || busy} onClick={() => { onUse(skill.slash); setVisible(false); }}>使用</Button>
            {skill.removable && <Popconfirm title="卸载此 Skill？仅删除 SKILL.md，其他文件会保留。" okText="确认卸载" cancelText="取消" onConfirm={() => act('agentSkillUninstall', { id: skill.id })}><Button size="small" danger disabled={busy}>卸载</Button></Popconfirm>}
          </Space>
        </div>)}
      </div>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>同名命令优先使用工作区、用户、内置定义；停用当前定义不会回退到低优先级版本。已有回答继续使用启动时的 Skill，后续提问按新状态执行。</Typography.Paragraph>
    </Modal>
    <Modal className={styles.agent} visible={!!detail} title={detail ? detail.name + ' · /' + detail.slash : 'Skill 正文'} width={740} onCancel={() => setDetail(undefined)} footer={<Button onClick={() => setDetail(undefined)}>关闭</Button>}>
      {detail && <><Typography.Paragraph>{detail.description}</Typography.Paragraph><Typography.Paragraph type="secondary" style={{ overflowWrap: 'anywhere' }}>来源：{detail.source}<br />{detail.directory || '扩展内置'}<br />允许的只读工具：{detail.tools.join('、') || '无'}</Typography.Paragraph><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '50vh', overflow: 'auto' }}>{detail.instruction}</pre></>}
    </Modal>
  </>;
}
