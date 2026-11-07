import { homedir } from 'os';
import { createHash } from 'crypto';
import { FileType, Uri, workspace } from 'vscode';
import { AgentSkill, AgentSkillEntry, BUILTIN_SKILLS } from '../shared/agent';
import { parseInstallableSkill } from '../shared/agentSkillImport';

export const agentSkillRoot = () => Uri.joinPath(Uri.file(homedir()), '.leekfund', 'skills');
export const agentSkillId = (directory: string) => 'skill-' + createHash('sha256').update(process.platform === 'win32' ? directory.toLowerCase() : directory).digest('hex').slice(0, 24);
export async function loadAgentSkills(disabled: string[] = []): Promise<{ skills: AgentSkill[]; catalog: AgentSkillEntry[]; errors: string[] }> {
  const skills = new Map<string, AgentSkillEntry>(BUILTIN_SKILLS.map(skill => [skill.slash, { ...skill, id: 'builtin-' + skill.slash, enabled: !disabled.includes('builtin-' + skill.slash), builtin: true, removable: false }])); const errors: string[] = [];
  const catalog = Array.from(skills.values()); catalog.forEach(skill => { skill.effective = true; });
  const roots = [{ uri: agentSkillRoot(), source: '用户', removable: true },
    ...(workspace.isTrusted ? (workspace.workspaceFolders || []).map(folder => ({ uri: Uri.joinPath(folder.uri, '.leekfund', 'skills'), source: `工作区 ${folder.name}`, removable: false })) : [])];
  for (const root of roots) {
    const entries = await workspace.fs.readDirectory(root.uri).then(value => value, error => {
      if (!['FileNotFound', 'ENOENT'].includes((error as { code?: string }).code || '')) errors.push(`${root.source} Skills 目录无法读取`);
      return [];
    });
    if (entries.length > 50) errors.push(`${root.source} Skills 超过50个目录，仅加载按名称排序的前50个`);
    for (const [name, type] of entries.sort(([a], [b]) => a.localeCompare(b)).slice(0, 50)) {
      if (type !== FileType.Directory) continue;
      try {
        const directory = Uri.joinPath(root.uri, name); const uri = Uri.joinPath(directory, 'SKILL.md');
        const stat = await workspace.fs.stat(uri); if (stat.size > 32000 || stat.type !== FileType.File) throw new Error('文件过大或不是普通文件');
        const skill = parseInstallableSkill(Buffer.from(await workspace.fs.readFile(uri)).toString('utf8'), root.source);
        const key = directory.toString(); const id = agentSkillId(key);
        const previous = skills.get(skill.slash); if (previous) previous.effective = false;
        const entry = { ...skill, id, directory: key, builtin: false, removable: root.removable, enabled: !disabled.includes(id), effective: true };
        skills.set(skill.slash, entry); catalog.push(entry);
      } catch { errors.push(`${root.source}/${name}：SKILL.md 无效，请检查元数据、工具名称及文件大小`); }
    }
  }
  return { skills: catalog.filter(skill => skill.enabled && skill.effective), catalog, errors };
}
