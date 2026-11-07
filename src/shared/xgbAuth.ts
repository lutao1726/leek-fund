import axios from 'axios';
import { commands, ExtensionContext, window } from 'vscode';
import globalState from '../globalState';

const CREDENTIALS_KEY = 'leek-fund.xuangubao.credentials';
const CACHE_DURATION = 1000 * 60 * 60 * 24;
let cachedToken: string | null = null;
let lastFetchTime = 0;
let generation = 0;
let pending: Promise<string | null> | undefined;

function resetToken() {
  generation++;
  cachedToken = null;
  lastFetchTime = 0;
  pending = undefined;
}

export async function xuanGuBaoAccountStatus(): Promise<{ configured: boolean }> {
  const raw = await globalState.context.secrets.get(CREDENTIALS_KEY);
  if (!raw) return { configured: false };
  try {
    const value = JSON.parse(raw);
    return { configured: typeof value.mobile === 'string' && !!value.mobile && typeof value.password === 'string' && !!value.password };
  } catch { return { configured: false }; }
}

export async function saveXuanGuBaoAccount(value: { mobile: string; password: string }) {
  if (typeof value?.mobile !== 'string' || !/^(?:\+\d{1,3})?\d{6,15}$/.test(value.mobile.trim())) throw new Error('请输入有效手机号');
  if (typeof value.password !== 'string' || !value.password.length) throw new Error('请输入密码');
  const mobile = value.mobile.trim().startsWith('+') ? value.mobile.trim() : '+86' + value.mobile.trim();
  try { await globalState.context.secrets.store(CREDENTIALS_KEY, JSON.stringify({ mobile, password: value.password })); }
  catch { throw new Error('账号保存失败，请检查编辑器安全存储后重试'); }
  resetToken();
}

export async function clearXuanGuBaoAccount() {
  try { await globalState.context.secrets.delete(CREDENTIALS_KEY); }
  catch { throw new Error('账号清除失败，请重试'); }
  resetToken();
}

export function registerXuanGuBaoAuth(context: ExtensionContext) {
  context.subscriptions.push(
    context.secrets.onDidChange(event => { if (event.key === CREDENTIALS_KEY) resetToken(); }),
    commands.registerCommand('leek-fund.configureXuanGuBaoAccount', async () => {
      try {
        const mobile = await window.showInputBox({
          title: '配置选股宝账号（1/2）', prompt: '输入手机号，国内号码可省略 +86', ignoreFocusOut: true,
          validateInput: value => /^(?:\+\d{1,3})?\d{6,15}$/.test(value.trim()) ? undefined : '请输入有效手机号',
        });
        if (mobile === undefined) return;
        const password = await window.showInputBox({
          title: '配置选股宝账号（2/2）', prompt: '密码将保存到编辑器安全存储', password: true, ignoreFocusOut: true,
          validateInput: value => value.length ? undefined : '请输入密码',
        });
        if (password === undefined) return;
        await saveXuanGuBaoAccount({ mobile, password });
        window.showInformationMessage('选股宝账号已安全保存，下次获取快讯时使用。');
      } catch {
        window.showErrorMessage('选股宝账号保存失败，请检查编辑器安全存储后重试。');
      }
    }),
    commands.registerCommand('leek-fund.clearXuanGuBaoAccount', async () => {
      try {
        await clearXuanGuBaoAccount();
        window.showInformationMessage('选股宝账号和登录缓存已清除。');
      } catch {
        window.showErrorMessage('选股宝账号清除失败，请重试。');
      }
    })
  );
}

async function fetchToken(requestGeneration: number): Promise<string | null> {
  try {
    const raw = await globalState.context?.secrets.get(CREDENTIALS_KEY);
    if (!raw || requestGeneration !== generation) return null;
    const credentials = JSON.parse(raw);
    if (typeof credentials.mobile !== 'string' || !credentials.mobile || typeof credentials.password !== 'string' || !credentials.password) return null;
    const response = await axios.post('https://stark-api.xuangubao.com.cn/apiv1/user/sign_in/sign_in_with_password', {
      mobile: credentials.mobile,
      password: credentials.password,
    }, { timeout: 15000 });
    if (requestGeneration !== generation) return null;
    if (response.data?.code === 20000 && typeof response.data?.data?.token === 'string' && response.data.data.token) {
      cachedToken = response.data.data.token;
      lastFetchTime = Date.now();
      return cachedToken;
    }
    console.error('选股宝登录失败，请检查账号配置。');
  } catch {
    // Axios errors can include request bodies and credentials; never log the error object.
    console.error('选股宝登录失败，请检查网络或安全存储中的账号配置。');
  }
  return null;
}

export async function getXuanGuBaoIvankaToken(): Promise<string | null> {
  if (cachedToken && Date.now() - lastFetchTime < CACHE_DURATION) return cachedToken;
  if (pending) return pending;
  const requestGeneration = generation;
  const request = fetchToken(requestGeneration);
  pending = request;
  try { return await request; }
  finally { if (pending === request) pending = undefined; }
}
