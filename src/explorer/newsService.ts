import Axios from 'axios';
import { TreeItem, Uri, window, commands } from 'vscode';
import { randHeader } from '../shared/utils';
import { LeekFundConfig } from '../shared/leekConfig';
import { defaultXueQiuHeaders, getXueQiuToken } from '../shared/xueqiu-helper';

export class NewsTreeItem extends TreeItem { }

export function normalizeXueQiuUserId(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  const match = text.match(/^(?:https?:\/\/(?:www\.)?xueqiu\.com\/(?:u\/)?)?(\d+)(?:\/?(?:[?#].*)?)?$/);
  return match?.[1];
}

export class NewsService {
  private cookies = '';
  private initializedAt = 0;
  private initializing: Promise<void> | undefined;
  private warned = false;

  get headers() {
    const configured = String(LeekFundConfig.getConfig('leek-fund.xueqiuCookie', '') || '').trim();
    return { ...defaultXueQiuHeaders, ...randHeader(), Cookie: configured || this.cookies };
  }

  async init() {
    if (LeekFundConfig.getConfig('leek-fund.xueqiuCookie', '') || Date.now() - this.initializedAt < 60000) return;
    if (!this.initializing) {
      this.initializing = (async () => {
        try { this.cookies = await getXueQiuToken(); }
        catch { /* Profile requests report a visible, sanitized error instead. */ }
        finally { this.initializedAt = Date.now(); this.initializing = undefined; }
      })();
    }
    await this.initializing;
  }

  private failure(error: any): string {
    const status = error?.response?.status;
    return status ? `雪球接口返回 HTTP ${status}，请设置或更新雪球 Cookie 后刷新` : '雪球请求失败，请检查网络及雪球 Cookie 后刷新';
  }

  async getNewsUserList(userIds: string[]): Promise<NewsTreeItem[]> {
    const ids = [...new Set((userIds || []).map(normalizeXueQiuUserId).filter((id): id is string => !!id))];
    if (!ids.length) return [];
    await this.init();
    return Promise.all(ids.map(async userId => {
      const treeItem = new NewsTreeItem(`雪球用户 ${userId}`);
      treeItem.id = userId;
      try {
        const response = await Axios.get('https://xueqiu.com/statuses/original/show.json', {
          params: { user_id: userId }, headers: this.headers, timeout: 15000,
        });
        const user = response.data?.user;
        if (response.status !== 200 || !user || !user.screen_name) throw new Error('Invalid user response');
        treeItem.label = user.screen_name;
        treeItem.tooltip = user.description || user.screen_name;
        const image = String(user.profile_image_url || '').split(',').pop();
        if (image) {
          const imageUrl = /^https?:\/\//.test(image) ? image : `${user.photo_domain || ''}${image}`;
          if (/^(?:https?:)?\/\//.test(imageUrl)) treeItem.iconPath = Uri.parse(imageUrl.startsWith('//') ? 'https:' + imageUrl : imageUrl);
        }
        treeItem.command = { title: user.screen_name, command: 'leek-fund.newItemClick', arguments: [user.screen_name, userId] };
      } catch (error) {
        treeItem.description = '获取失败，点击打开主页';
        treeItem.tooltip = this.failure(error);
        treeItem.command = { title: '打开雪球用户主页', command: 'vscode.open', arguments: [Uri.parse(`https://xueqiu.com/u/${userId}`)] };
      }
      return treeItem;
    }));
  }

  async getNewsData(userId: string): Promise<any[]> {
    const id = normalizeXueQiuUserId(userId);
    if (!id) return [];
    await this.init();
    try {
      const response = await Axios.get('https://xueqiu.com/v4/statuses/user_timeline.json', {
        params: { page: 1, user_id: id }, headers: this.headers, timeout: 15000,
      });
      if (response.status !== 200 || !Array.isArray(response.data?.statuses)) throw new Error('Invalid timeline response');
      this.warned = false;
      return response.data.statuses;
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        void window.showWarningMessage(this.failure(error), '配置雪球 Cookie', '打开用户主页').then(action => {
          if (action === '配置雪球 Cookie') return commands.executeCommand('leek-fund.setXueqiuCookie');
          if (action === '打开用户主页') return commands.executeCommand('vscode.open', Uri.parse(`https://xueqiu.com/u/${id}`));
        });
      }
      return [];
    }
  }
}
