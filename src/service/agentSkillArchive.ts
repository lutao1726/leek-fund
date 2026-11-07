import { inflateRawSync } from 'zlib';
import { get } from 'https';
import { githubSkillRepository } from '../shared/agentSkillImport';

export interface SkillDocument { path: string; text: string }
export const SKILL_ARCHIVE_LIMIT = 20 * 1024 * 1024;
const crcTable = Array.from({ length: 256 }, (_, i) => { let c = i; for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function skillCRC32(data: Buffer): number { let c = 0xffffffff; for (const byte of data) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** Read only bounded SKILL.md members; never extract archive paths onto disk. ZIP64 is intentionally unsupported. */
export function readSkillArchive(zip: Buffer): SkillDocument[] {
  if (zip.length < 22 || zip.length > SKILL_ARCHIVE_LIMIT) throw new Error('ZIP 为空或超过20MB');
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (zip.readUInt32LE(i) === 0x06054b50 && i + 22 + zip.readUInt16LE(i + 20) === zip.length) { end = i; break; }
  if (end < 0 || zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6) || zip.readUInt16LE(end + 8) !== zip.readUInt16LE(end + 10)) throw new Error('不支持的 ZIP 格式');
  const count = zip.readUInt16LE(end + 10), size = zip.readUInt32LE(end + 12), start = zip.readUInt32LE(end + 16);
  if (count > 5000 || count === 65535 || start + size !== end) throw new Error('ZIP 条目过多或使用了不支持的 ZIP64 格式');
  const paths = new Set<string>(); const documents: SkillDocument[] = []; let at = start; let total = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || zip.readUInt32LE(at) !== 0x02014b50) throw new Error('ZIP 目录损坏');
    const flags = zip.readUInt16LE(at + 8), method = zip.readUInt16LE(at + 10), checksum = zip.readUInt32LE(at + 16);
    const compressed = zip.readUInt32LE(at + 20), expanded = zip.readUInt32LE(at + 24), nameSize = zip.readUInt16LE(at + 28), extra = zip.readUInt16LE(at + 30), comment = zip.readUInt16LE(at + 32);
    const attributes = zip.readUInt32LE(at + 38), offset = zip.readUInt32LE(at + 42);
    if (at + 46 + nameSize + extra + comment > end || flags & 1 || method !== 0 && method !== 8 || expanded === 0xffffffff || compressed === 0xffffffff) throw new Error('ZIP 加密、压缩方式或目录不受支持');
    const name = zip.subarray(at + 46, at + 46 + nameSize).toString('utf8');
    if (!name || name.length > 600 || /[\x00-\x1f\\:]/.test(name) || name.startsWith('/') || name.split('/').some(part => part === '..' || part === '.') || ((attributes >>> 16) & 0xf000) === 0xa000) throw new Error('ZIP 含不安全路径或符号链接');
    const normalized = name.toLowerCase(); if (paths.has(normalized)) throw new Error('ZIP 含重复路径'); paths.add(normalized);
    total += expanded; if (total > 100 * 1024 * 1024) throw new Error('ZIP 声明的展开大小超过100MB');
    at += 46 + nameSize + extra + comment;
    if (!/(^|\/)SKILL\.md$/i.test(name)) continue;
    if (expanded > 32000 || documents.length >= 50) throw new Error('ZIP 中 Skill 超过50个或单文件超过32KB');
    if (offset + 30 > start || zip.readUInt32LE(offset) !== 0x04034b50 || zip.readUInt16LE(offset + 6) !== flags || zip.readUInt16LE(offset + 8) !== method) throw new Error('ZIP 文件头不一致');
    const localName = zip.readUInt16LE(offset + 26), localExtra = zip.readUInt16LE(offset + 28), dataStart = offset + 30 + localName + localExtra;
    if (dataStart + compressed > start || zip.subarray(offset + 30, offset + 30 + localName).toString('utf8') !== name) throw new Error('ZIP 文件范围不正确');
    const packed = zip.subarray(dataStart, dataStart + compressed);
    const bytes = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: 32001 });
    if (bytes.length !== expanded || skillCRC32(bytes) !== checksum) throw new Error('ZIP 文件校验失败');
    documents.push({ path: name, text: bytes.toString('utf8') });
  }
  if (at !== end) throw new Error('ZIP 目录大小不一致');
  if (!documents.length) throw new Error('未找到 SKILL.md，请选择 Skill 目录或包含它的 ZIP');
  return documents;
}

export async function downloadSkillRepository(repository: string, signal: AbortSignal): Promise<Buffer> {
  const repo = githubSkillRepository(repository);
  const fetch = (url: string, redirects: number): Promise<Buffer> => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('安装已取消')); return; }
    const target = new URL(url);
    if (target.protocol !== 'https:' || !['api.github.com', 'codeload.github.com'].includes(target.hostname) || target.port || target.username || target.password) { reject(new Error('GitHub 下载地址不受支持')); return; }
    let done = false; let timer: NodeJS.Timeout;
    const finish = (error?: Error, value?: Buffer) => { if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(value!); };
    const request = get(target, { headers: { 'User-Agent': 'LeekFund-Skill-Installer', Accept: 'application/vnd.github+json' } }, response => {
      if ([301, 302, 307, 308].includes(response.statusCode || 0) && response.headers.location && redirects < 3) {
        response.resume(); try { finishRedirect(new URL(response.headers.location, url).toString()); } catch { finish(new Error('GitHub 下载重定向无效')); } return;
      }
      if (response.statusCode !== 200) { response.resume(); finish(new Error(`GitHub 返回 HTTP ${response.statusCode}，请检查公共仓库地址或稍后重试`)); return; }
      let size = 0; const buffers: Buffer[] = [];
      response.on('data', chunk => { size += chunk.length; if (size > SKILL_ARCHIVE_LIMIT) { finish(new Error('仓库 ZIP 超过20MB，请下载所需 Skill 后导入目录')); request.destroy(); } else buffers.push(chunk); });
      response.on('end', () => finish(undefined, Buffer.concat(buffers))); response.on('error', () => finish(new Error('GitHub 下载中断'))); response.on('aborted', () => finish(new Error('GitHub 下载中断')));
    });
    const abort = () => request.destroy(new Error('安装已取消'));
    const finishRedirect = (location: string) => { clearTimeout(timer); signal.removeEventListener('abort', abort); done = true; fetch(location, redirects + 1).then(resolve, reject); };
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { finish(new Error('GitHub 下载超时，请使用本地目录或 ZIP')); request.destroy(); }, 30000);
    request.on('error', () => finish(new Error(signal.aborted ? '安装已取消' : 'GitHub 下载失败，请检查网络或使用本地导入')));
  });
  return fetch(`https://api.github.com/repos/${repo}/zipball`, 0);
}
