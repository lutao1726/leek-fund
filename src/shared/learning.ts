export const LEARNING_REPO = 'https://github.com/zhouqinglong520/trading-mastery';
export const LEARNING_SITE = 'https://zhouqinglong520.github.io/trading-mastery/';
export const LEARNING_CATEGORIES = ['交易体系', '游资心法', '个人复盘', '可视化'];
export interface LearningResource {
  path: string; title: string; category: string; topic: string; kind: string; sha: string; size: number;
}
export interface LearningCatalog { revision: string; fetchedAt: string; items: LearningResource[] }
export interface LearningArticle { path: string; sha: string; fetchedAt: string; text: string }
export interface LearningResult<T> { value: T; stale: boolean; error?: string; source?: 'github' | 'cache' | 'bundled' }
export function learningPath(path: unknown): path is string {
  return typeof path === 'string' && path.length <= 1000 && !/[\\\x00-\x1f]/.test(path)
    && !path.split('/').some(part => !part || part === '.' || part === '..')
    && LEARNING_CATEGORIES.includes(path.split('/')[0]);
}
export const encodeLearningPath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
export function learningUrl(item?: LearningResource, revision = 'main', visual = false) {
  if (!item) return visual ? LEARNING_SITE : LEARNING_REPO;
  if (!learningPath(item.path) || !/^(main|[a-f0-9]{40})$/.test(revision)) throw new Error('资料地址无效');
  const path = encodeLearningPath(item.path);
  return visual && item.kind === 'html'
    ? LEARNING_SITE
    : `${LEARNING_REPO}/blob/${revision}/${path}`;
}
export function parseLearningTree(raw: any, now: number): LearningCatalog {
  if (raw?.truncated || !Array.isArray(raw?.tree) || !/^[a-f0-9]{40}$/.test(raw?.sha)) throw new Error('仓库目录不完整或格式已变化');
  const seen = new Set<string>();
  const items: LearningResource[] = [];
  for (const entry of raw.tree) {
    if (entry.type !== 'blob' || !learningPath(entry.path) || !/^[a-f0-9]{40}$/.test(entry.sha) || seen.has(entry.path)) continue;
    const parts = entry.path.split('/'); const file = parts[parts.length - 1];
    const kind = file.split('.').pop()!.toLowerCase();
    if (!['md', 'html', 'pdf', 'xlsx', 'xls', 'mm', 'png', 'jpg', 'svg'].includes(kind)) continue;
    seen.add(entry.path);
    items.push({ path: entry.path, title: file.replace(/\.[^.]+$/, '').replace(/_/g, ' '), category: parts[0],
      topic: parts[0] === '游资心法' ? parts[1] : parts[0], kind, sha: entry.sha, size: Number(entry.size) || 0 });
  }
  if (!items.length) throw new Error('仓库暂未提供可用的学习资料');
  return { revision: raw.sha, fetchedAt: new Date(now).toISOString(), items: items.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN', { numeric: true })) };
}
