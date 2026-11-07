import { Webview, window, workspace } from 'vscode';
import { agent } from '../../service/agent';
import { promises as fs } from 'fs';
import { AgentSkillInstaller, readSkillDirectory } from '../../service/agentSkillInstall';
import { downloadSkillRepository, readSkillArchive, SKILL_ARCHIVE_LIMIT } from '../../service/agentSkillArchive';

export function registerAgentBridge(webview: Webview, owner: { visible: boolean; onDidDispose(listener: () => void): { dispose(): unknown }; onDidChangeViewState?(listener: () => void): { dispose(): unknown }; onDidChangeVisibility?(listener: () => void): { dispose(): unknown } }) {
  let selected = agent.state().sessions[0]?.id; let closed = false;
  let installController: AbortController | undefined;
  const post = () => { if (!closed && owner.visible) void webview.postMessage({ command: 'agentState', data: agent.state(selected) }); };
  const unsubscribe = agent.subscribe(post);
  const visibility = owner.onDidChangeViewState?.(post) || owner.onDidChangeVisibility?.(post);
  const messages = webview.onDidReceiveMessage(async message => {
    if (message?.command === 'agentSkillCancel') { installController?.abort(); return; }
    if (!['getAgent', 'agentNew', 'agentSelect', 'agentSend', 'agentStop', 'agentDelete', 'agentModels', 'agentSkills', 'agentExport', 'agentConfig', 'agentSkillDetail', 'agentSkillToggle', 'agentSkillUninstall', 'agentSkillDirectory', 'agentSkillZip', 'agentSkillGithub'].includes(message?.command)) return;
    try {
      const data = message.data || {};
      if (message.command === 'agentSkillDetail') { void webview.postMessage({ command: 'agentSkillDetail', data: agent.skillDetail(data.id) }); return; }
      if (['agentSkillToggle', 'agentSkillUninstall', 'agentSkillDirectory', 'agentSkillZip', 'agentSkillGithub'].includes(message.command)) {
        if (!owner.visible) throw new Error('请在可见面板中管理 Skills');
        agent.beginSkillOperation(); const controller = new AbortController(); installController = controller;
        try {
          const installer = new AgentSkillInstaller();
          if (message.command === 'agentSkillToggle') await agent.setSkillEnabled(data.id, data.enabled);
          else if (message.command === 'agentSkillUninstall') { await installer.uninstall(agent.skillDetail(data.id)); await agent.forgetRemovedSkill(data.id); }
          else {
            let documents;
            if (message.command === 'agentSkillGithub') documents = readSkillArchive(await downloadSkillRepository(data.url, controller.signal));
            else {
              const directory = message.command === 'agentSkillDirectory';
              const chosen = await window.showOpenDialog({ canSelectFolders: directory, canSelectFiles: !directory, canSelectMany: false, openLabel: directory ? '导入 Skill 目录' : '导入 Skill ZIP', ...(!directory ? { filters: { ZIP: ['zip'] } } : {}) });
              if (!chosen?.[0]) { if (!closed) void webview.postMessage({ command: 'agentSkillResult', data: { cancelled: true } }); return; }
              if (chosen[0].scheme !== 'file') throw new Error('请选择扩展运行环境中的本地目录或 ZIP');
              if (controller.signal.aborted || closed) throw new Error('安装已取消');
              if (directory) documents = await readSkillDirectory(chosen[0].fsPath);
              else { if ((await fs.stat(chosen[0].fsPath)).size > SKILL_ARCHIVE_LIMIT) throw new Error('ZIP 超过20MB'); documents = readSkillArchive(await fs.readFile(chosen[0].fsPath)); }
            }
            if (controller.signal.aborted || closed) throw new Error('安装已取消');
            const result = await installer.install(documents, id => agent.disableInstalledSkill(id)); await agent.reloadSkills();
            if (!closed) void webview.postMessage({ command: 'agentSkillResult', data: { success: true, result } });
            return;
          }
          if (!closed) void webview.postMessage({ command: 'agentSkillResult', data: { success: true } });
        } catch (error) { if (!closed) void webview.postMessage({ command: 'agentSkillResult', data: { success: false, error: error instanceof Error ? error.message : 'Skill 操作失败' } }); }
        finally { if (installController === controller) installController = undefined; agent.endSkillOperation(); post(); }
        return;
      }
      switch (message.command) {
        case 'getAgent': post(); return;
        case 'agentNew': selected = agent.create(); break;
        case 'agentSelect': if (!agent.state(data.id).selected) throw new Error('会话不存在'); selected = data.id; break;
        case 'agentSend': if (!selected) selected = agent.create(); agent.send(selected, data.text, data.model); void webview.postMessage({ command: 'agentAccepted', data: { text: data.text } }); break;
        case 'agentStop': if (selected) agent.cancel(selected); break;
        case 'agentDelete': if (selected) agent.remove(selected); selected = agent.state().sessions[0]?.id; break;
        case 'agentModels': await agent.refreshModels(); break;
        case 'agentSkills': await agent.reloadSkills(); break;
        case 'agentConfig': await import('vscode').then(vscode => vscode.commands.executeCommand('workbench.action.openSettings', 'leek-fund.aiConfig')); return;
        case 'agentExport': {
          const session = agent.state(selected).selected; if (!session) throw new Error('没有可导出的会话');
          const uri = await window.showSaveDialog({ filters: { Markdown: ['md'] }, saveLabel: '导出 LeekAgent 会话' });
          if (uri) await workspace.fs.writeFile(uri, Buffer.from(`# ${session.title}\n\n` + session.messages.map(m => `## ${m.role === 'user' ? '用户' : 'LeekAgent'}\n\n${m.text}\n\n${m.model || ''} · ${m.status || ''}\n\n` + (m.traces || []).map(t => `### ${t.id} · ${t.tool} · ${t.at}\n\n\`\`\`json\n${t.content}\n\`\`\``).join('\n\n')).join('\n\n')));
          return;
        }
      }
      post();
    } catch (error) {
      if (!closed) {
        const text = error instanceof Error ? error.message : 'LeekAgent 操作失败';
        if (message.command.startsWith('agentSkill') && !['agentSkills', 'agentSkillDetail'].includes(message.command)) void webview.postMessage({ command: 'agentSkillResult', data: { success: false, error: text } });
        else void webview.postMessage({ command: 'agentError', data: text });
      }
    }
  });
  owner.onDidDispose(() => { closed = true; installController?.abort(); unsubscribe(); messages.dispose(); visibility?.dispose(); });
}
