import { promises as fs } from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { Uri } from 'vscode';
import { AgentSkillEntry, AgentSkillInstallResult } from '../shared/agent';
import { parseInstallableSkill } from '../shared/agentSkillImport';
import { agentSkillId, agentSkillRoot } from './agentSkills';
import { SkillDocument } from './agentSkillArchive';

export async function readSkillDirectory(directory: string): Promise<SkillDocument[]> {
  const documents: SkillDocument[] = []; let count = 0;
  const walk = async (folder: string, depth: number) => {
    if (depth > 8) return;
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++count > 5000) throw new Error('目录超过5,000个条目，请直接选择具体 Skill 目录');
      if (entry.isSymbolicLink() || ['.git', 'node_modules', '.venv'].includes(entry.name)) continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(file, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
        if (documents.length >= 50 || (await fs.lstat(file)).size > 32000) throw new Error('Skill 超过50个或单文件超过32KB');
        documents.push({ path: path.relative(directory, file), text: await fs.readFile(file, 'utf8') });
      }
    }
  };
  if (!(await fs.lstat(directory)).isDirectory()) throw new Error('请选择普通目录');
  await walk(directory, 0);
  if (!documents.length) throw new Error('所选目录中没有 SKILL.md');
  return documents;
}

/** Installs document-only workflows. Paths and executable assets from packages are never copied. */
export class AgentSkillInstaller {
  constructor(private root = agentSkillRoot().fsPath) {}
  private async prepareRoot() {
    await fs.mkdir(this.root, { recursive: true });
    if (!(await fs.lstat(this.root)).isDirectory() || (await fs.lstat(this.root)).isSymbolicLink()) throw new Error('Skill 安装根目录不可用或为符号链接');
    return fs.realpath(this.root);
  }
  async install(documents: SkillDocument[], disable: (id: string) => Promise<void>): Promise<AgentSkillInstallResult> {
    if (!documents.length || documents.length > 50) throw new Error('单次安装支持1～50个 Skill');
    const root = await this.prepareRoot(); const result: AgentSkillInstallResult = { installed: [], skipped: [] }; const slashes = new Set<string>();
    const entries = await fs.readdir(root, { withFileTypes: true }); let directoryCount = entries.length;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try { const file = path.join(root, entry.name, 'SKILL.md'); const stat = await fs.lstat(file); if (stat.isFile() && stat.size <= 32000) slashes.add(parseInstallableSkill(await fs.readFile(file, 'utf8'), '用户').slash); } catch { /* Invalid existing entries still count towards the directory limit. */ }
    }
    for (const document of documents) {
      let directory: string | undefined;
      try {
        const skill = parseInstallableSkill(document.text, '用户');
        if (slashes.has(skill.slash)) throw new Error('已安装或本次导入存在相同 slash，请先卸载旧版本');
        if (directoryCount >= 50) throw new Error('用户 Skills 目录达到50个条目上限');
        directory = path.join(root, skill.slash);
        // Atomic mkdir refuses existing folders; no overwrites or recursively deleting imported content.
        await fs.mkdir(directory);
        slashes.add(skill.slash); directoryCount++;
      } catch (error) { result.skipped.push(`${document.path}：${(error as any).code === 'EEXIST' ? '已安装同名目录，请先卸载旧版本' : (error as Error).message}`); continue; }
      const temp = path.join(directory, '.install-' + randomBytes(8).toString('hex'));
      try {
        const uri = Uri.file(path.join(this.root, path.basename(directory)));
        await disable(agentSkillId(uri.toString()));
        await fs.writeFile(temp, document.text, { flag: 'wx', mode: 0o600 });
        await fs.link(temp, path.join(directory, 'SKILL.md')); await fs.unlink(temp).catch(() => {});
        result.installed.push(path.basename(directory));
      } catch {
        await fs.unlink(temp).catch(() => {}); await fs.rmdir(directory).catch(() => {});
        result.skipped.push(`${document.path}：安装写入失败，请检查目录权限`);
      }
    }
    return result;
  }
  async uninstall(entry: AgentSkillEntry) {
    if (!entry.removable || entry.builtin || !entry.directory) throw new Error('只能在这里卸载用户目录中的 Skill');
    const root = await this.prepareRoot();
    const directory = Uri.parse(entry.directory).fsPath; const relative = path.relative(path.resolve(this.root), path.resolve(directory));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) throw new Error('Skill 目录不在用户安装目录内');
    const real = await fs.realpath(directory);
    if (path.dirname(real) !== root || (await fs.lstat(directory)).isSymbolicLink()) throw new Error('不能卸载符号链接目录');
    const file = path.join(real, 'SKILL.md'); if (!(await fs.lstat(file)).isFile() || (await fs.lstat(file)).isSymbolicLink()) throw new Error('Skill 文件不是普通文件');
    await fs.unlink(file); await fs.rmdir(real).catch(() => {});
  }
}
