import { AGENT_TOOLS, AgentSkill, parseAgentSkill } from './agent';

/** Standard name/description SKILL.md documents become read-only, on-demand workflows. */
export function parseInstallableSkill(text: string, source: string): AgentSkill {
  text = text.replace(/^\uFEFF/, '');
  const header = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(text);
  if (!header) throw new Error('缺少 SKILL.md 元数据或正文');
  if (/^slash:/m.test(header[1])) return parseAgentSkill(text, source);
  if (/^tools:/m.test(header[1])) throw new Error('使用 tools 字段时请同时声明 slash，采用 LeekAgent 格式');
  if (text.length > 24000) throw new Error('Skill 超过24,000字符');
  const fields: Record<string, string> = {}; const lines = header[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const field = /^(name|description):\s*(.*)$/.exec(lines[i]); if (!field) continue;
    if (fields[field[1]] !== undefined) throw new Error('元数据字段重复');
    let value = field[2].trim();
    if (/^[|>][-+]?$/.test(value)) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim());
      value = block.join(' ').trim();
    } else if (value.startsWith('"')) {
      try { value = JSON.parse(value); } catch { throw new Error('不支持的多行引号，请使用 description: >- 格式'); }
    } else if (/^'.*'$/.test(value)) value = value.slice(1, -1).replace(/''/g, "'");
    if (typeof value !== 'string') throw new Error('元数据须为文本'); fields[field[1]] = value;
  }
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(fields.name || '') || !fields.description?.trim() || fields.description.length > 2000 || !header[2].trim()) throw new Error('标准 Skill 需要英文短名称 name、description 和正文');
  if (fields.name.length > 31) throw new Error('Skill 名称超过31位，请添加独立 slash 并使用 LeekAgent 元数据格式');
  if (['s', 'p', 'e'].includes(fields.name)) throw new Error('名称与内置别名冲突');
  return { slash: fields.name, name: fields.name, description: fields.description, instruction: header[2].trim(), tools: [...AGENT_TOOLS], source, prefetch: false };
}
export function githubSkillRepository(value: unknown): string {
  if (typeof value !== 'string' || value.length > 300) throw new Error('请填写 GitHub 仓库地址');
  let url: URL; try { url = new URL(value.trim()); } catch { throw new Error('请填写 https://github.com/所有者/仓库'); }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) throw new Error('只支持 GitHub 公共仓库 HTTPS 地址');
  const match = /^\/([a-zA-Z0-9-]{1,100})\/([a-zA-Z0-9_.-]{1,100})\/?$/.exec(url.pathname);
  if (!match || ['.', '..'].includes(match[2])) throw new Error('请填写仓库根地址，不包含 tree、blob 或子目录');
  const repo = match[2].replace(/\.git$/, ''); if (!repo || ['.', '..'].includes(repo)) throw new Error('GitHub 仓库名称不正确');
  return `${match[1]}/${repo}`;
}
