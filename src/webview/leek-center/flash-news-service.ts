import axios from 'axios';
import { Webview, window } from 'vscode';

export class FlashNewsService {
  constructor(private webview: Webview | null) {}

  public async fetchNewsData() {
    const NEWS_FLASH_URL = 'https://baoer-api.xuangubao.com.cn/api/v6/message/newsflash';
    const subjectIds = [9, 10, 723, 35, 469];
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': 'https://xuangubao.com.cn/',
      'Origin': 'https://xuangubao.com.cn',
    };

    // 获取最新20条消息用于实时更新
    let latestRes: any;
    try {
      latestRes = await axios.get(NEWS_FLASH_URL, {
        params: {
          limit: 20,
          subj_ids: subjectIds.join(','),
          platform: 'pcweb',
        },
        headers,
        timeout: 10000,
      });
    } catch (err) {
      console.error('获取最新快讯失败:', err);
    }

    // 获取当天所有消息用于全量显示
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayStartTimestamp = Math.floor(todayStart.getTime() / 1000);

    let allDayRes: any;
    try {
      allDayRes = await axios.get(NEWS_FLASH_URL, {
        params: {
          limit: 100,
          subj_ids: subjectIds.join(','),
          start_time: todayStartTimestamp,
          platform: 'pcweb',
        },
        headers,
        timeout: 10000,
      });
    } catch (err) {
      console.error('获取全天快讯失败:', err);
    }

    if (latestRes?.data?.code === 20000) {
      const { messages, next_cursor } = latestRes.data.data;
      const allDayMessages = allDayRes?.data?.code === 20000 ? (allDayRes.data.data.messages || []) : [];

      // 对当天全量新闻进行去重
      const uniqueAllDayMessages: any[] = [];
      const seenIds = new Set<number>();

      allDayMessages.forEach((msg: any) => {
        if (!seenIds.has(msg.id)) {
          seenIds.add(msg.id);
          uniqueAllDayMessages.push(msg);
        }
      });

      return {
        messages: messages,
        next_cursor: next_cursor,
        lastUpdate: Date.now(),
        allDayMessages: uniqueAllDayMessages
      };
    }
    throw new Error('API Error or No Data');
  }

  async getNewsData() {
    try {
      const data = await this.fetchNewsData();
      this.webview?.postMessage({
        command: 'newsData',
        data
      });
    } catch (err) {
      console.error('Fetch news error', err);
      // window.showErrorMessage('获取快讯失败'); // 既然是静默刷新，可以不弹窗或者减少打扰
      this.sendEmptyData();
    }
  }

  private sendEmptyData() {
    this.webview?.postMessage({
      command: 'newsData',
      data: {
        messages: [],
        allDayMessages: []
      },
    });
  }
}
