import axios from 'axios';

let cachedToken: string | null = null;
let lastFetchTime: number = 0;
const CACHE_DURATION = 1000 * 60 * 60 * 24; // 缓存 24 小时

export async function getXuanGuBaoIvankaToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedToken && now - lastFetchTime < CACHE_DURATION) {
    return cachedToken;
  }

  try {
    const response = await axios.post('https://stark-api.xuangubao.com.cn/apiv1/user/sign_in/sign_in_with_password', {
      mobile: '+8615794492361',
      password: 'Lt123456@',
    });

    if (response.data?.code === 20000 && response.data?.data?.token) {
      cachedToken = response.data.data.token;
      lastFetchTime = now;
      return cachedToken;
    }
    console.error('XuanGuBao Login Failed:', response.data?.message);
  } catch (error) {
    console.error('XuanGuBao Login Error:', error);
  }

  return cachedToken; // 返回旧的（如果有）或者 null
}
