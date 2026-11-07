import { authentication, AuthenticationSession, env, Uri, WebviewPanel, workspace } from 'vscode';
import { createHash } from 'crypto';
import globalState from '../../globalState';
import { fetchLearningText, LearningService } from '../../service/learning';
import { learningUrl } from '../../shared/learning';
import { bundledLearningCatalog } from '../../data/learningCatalog';

export function registerLearningService(panel: WebviewPanel) {
  let session: AuthenticationSession | undefined;
  let disposed = false;
  const directory = Uri.joinPath(globalState.context.globalStorageUri, 'learning');
  const file = Uri.joinPath(directory, 'cache.json');
  const service = new LearningService({
    read: async () => JSON.parse(Buffer.from(await workspace.fs.readFile(file)).toString('utf8')),
    write: async value => { await workspace.fs.createDirectory(directory); await workspace.fs.writeFile(file, Buffer.from(JSON.stringify(value), 'utf8')); },
  }, (url, signal) => fetchLearningText(url, signal, session?.accessToken), undefined, bundledLearningCatalog);
  const updateSession = async (interactive = false) => {
    try {
      const next = interactive
        ? await authentication.getSession('github', ['read:user'], { createIfNone: { detail: '用于同步公开的学习资料目录，提高 GitHub API 请求额度。' }, clearSessionPreference: true })
        : await authentication.getSession('github', ['read:user'], { silent: true });
      if (disposed) throw new Error('学习专栏已关闭');
      session = next;
    } catch {
      if (interactive) throw new Error('未获得 GitHub 账号授权，已有学习资料已保留；可再次点击“使用 GitHub 账号”连接。');
      session = undefined;
    }
    const identity = session ? `${session.account.id}:${createHash('sha256').update(session.accessToken).digest('hex')}` : 'anonymous';
    await service.useIdentity(identity);
    if (!disposed) void panel.webview.postMessage({ command: 'learningAuthState', data: { account: session?.account.label } });
  };
  const sessions = authentication.onDidChangeSessions(event => {
    if (event.provider.id === 'github') void updateSession();
  });
  const listener = panel.webview.onDidReceiveMessage(async message => {
    if (!['learningCatalog', 'learningConnectGitHub', 'learningArticle', 'learningOpen'].includes(message?.command)) return;
    const { id, path, force, visual } = message.data || {};
    if (typeof id !== 'string' || id.length > 100) return;
    try {
      let result;
      if (message.command === 'learningCatalog' || message.command === 'learningConnectGitHub') {
        await updateSession(message.command === 'learningConnectGitHub');
        if (disposed) return;
        result = await service.catalog(message.command === 'learningConnectGitHub' || force === true);
      }
      if (message.command === 'learningArticle') result = await service.article(path, force === true);
      if (message.command === 'learningOpen') {
        if (path === undefined) {
          await env.openExternal(Uri.parse(learningUrl(undefined, 'main', visual === true)));
          if (!disposed) void panel.webview.postMessage({ command: 'learningResult', data: { id } });
          return;
        }
        const catalog = (await service.catalog()).value;
        const item = path === undefined ? undefined : catalog.items.find(item => item.path === path);
        if (path !== undefined && !item) throw new Error('资料已不在目录中，请刷新后重试');
        await env.openExternal(Uri.parse(learningUrl(item, catalog.revision, visual === true)));
      }
      if (!disposed) void panel.webview.postMessage({ command: 'learningResult', data: { id, result } });
    } catch (error) {
      if (!disposed) void panel.webview.postMessage({ command: 'learningResult', data: { id, error: (error as Error).message } });
    }
  });
  panel.onDidDispose(() => { disposed = true; session = undefined; sessions.dispose(); listener.dispose(); service.dispose(); });
}
