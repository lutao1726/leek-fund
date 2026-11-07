export type AgentToolName = 'watchlist' | 'portfolio' | 'quote' | 'news' | 'sectors' | 'board' | 'changes' | 'history';
export interface AgentSkill { slash: string; name: string; description: string; instruction: string; tools: AgentToolName[]; source: string; prefetch?: boolean }
export interface AgentSkillEntry extends AgentSkill { id: string; enabled: boolean; builtin: boolean; directory?: string; removable: boolean; effective?: boolean }
export interface AgentSkillInstallResult { installed: string[]; skipped: string[] }
export interface AgentModel { id: string; name: string; source: 'ide' | 'byok' }
export interface AgentTrace { id: string; tool: string; input: object; content: string; at: string; error?: boolean }
export interface AgentMessage { id: string; role: 'user' | 'assistant'; text: string; at: string; status?: 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted'; model?: string; stage?: string; traces?: AgentTrace[]; error?: string }
export interface AgentSession { id: string; title: string; updatedAt: string; messages: AgentMessage[] }
export interface AgentState { sessions: { id: string; title: string; updatedAt: string }[]; selected?: AgentSession; skills: AgentSkill[]; skillCatalog?: AgentSkillEntry[]; skillErrors?: string[]; skillBusy?: boolean; models: AgentModel[]; error?: string }
export const AGENT_TOOLS: AgentToolName[] = ['watchlist', 'portfolio', 'quote', 'news', 'sectors', 'board', 'changes', 'history'];
export class AgentUserError extends Error {}
export const BUILTIN_SKILLS: AgentSkill[] = [
  { slash: 'summary', name: '资讯摘要', description: '按来源时间整理近期快讯', tools: ['news'], instruction: '按主题整理近期快讯，引用证据编号，标明样本范围和发布时间；没有日期时不能称为今日资讯。', source: '内置' },
  { slash: 'brief', name: '三条简报', description: '三条要点与待核实事项', tools: ['news'], instruction: '输出三条快讯要点，每条注明证据、来源时间和待核实事项。资料不足时不强行凑满三条。', source: '内置' },
  { slash: 'portfolio', name: '持仓巡检', description: '分币种检查持仓与数据缺口', tools: ['portfolio', 'watchlist'], instruction: '列出各币种已知市值、报价缺口和集中度，区分自选与真实持仓，不混加币种，不将股票持仓占比当作全账户仓位。输出观察清单。', source: '内置' },
  { slash: 'explain', name: '个股解读', description: '输入股票代码，核对行情和历史', tools: ['quote', 'history', 'news'], instruction: '先确定用户提供的股票代码，结合报价、历史日线及近期快讯整理事实、支持与反对依据、观察条件及数据缺口。未关联的新闻不推定影响。', source: '内置' },
  { slash: 'scan', name: '板块扫描', description: '板块热度、自选及近期资讯', tools: ['sectors', 'watchlist', 'news'], instruction: '按行业和概念分别列出涨跌和资金流向，结合自选与快讯列出待跟踪事项。成分重叠不累加为全市场总量。', source: '内置' },
];
export function parseAgentPrompt(text: string, skills: AgentSkill[]) {
  const match = /^\/(\w[\w-]*)\b\s*/.exec(text);
  const aliases: Record<string, string> = { s: 'summary', p: 'portfolio', e: 'explain' };
  const slash = match ? aliases[match[1]] || match[1] : undefined;
  const skill = skills.find(item => item.slash === slash);
  if (slash && !skill) throw new Error('Skill 不存在或未启用，请在 Skills 管理中检查');
  return { skill, prompt: match ? text.slice(match[0].length).trim() : text };
}
/** Deliberately small metadata grammar: no executable YAML or arbitrary tool names. */
export function parseAgentSkill(text: string, source: string): AgentSkill {
  if (text.length > 24000) throw new Error('Skill 超过 24,000 字符');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(text);
  if (!match) throw new Error('需要 YAML 头和正文');
  const metadata: Record<string, string> = {}; const tools: string[] = []; let inTools = false;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s+([a-z]+)\s*$/.exec(line);
    if (item && inTools) { tools.push(item[1]); continue; }
    const field = /^(name|description|slash|tools):\s*(.*?)\s*$/.exec(line);
    if (!field) throw new Error('不支持的 Skill 元数据');
    inTools = field[1] === 'tools'; metadata[field[1]] = field[2].replace(/^['"]|['"]$/g, '');
    if (inTools && field[2]) throw new Error('tools 请使用逐行列表');
  }
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(metadata.slash || '') || ['s', 'p', 'e'].includes(metadata.slash) || !metadata.name || metadata.name.length > 80 || !metadata.description || metadata.description.length > 300 || !match[2].trim()) throw new Error('Skill 名称、描述、slash 或正文不正确');
  if (tools.length > 8 || tools.some(tool => !AGENT_TOOLS.includes(tool as AgentToolName))) throw new Error('Skill 只能使用内置只读工具');
  return { name: metadata.name, description: metadata.description, slash: metadata.slash, instruction: match[2].trim(), tools: Array.from(new Set(tools)) as AgentToolName[], source };
}
