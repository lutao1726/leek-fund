import { Alert, Button, Spin } from 'antd';
import { useEffect, useState } from 'react';
import { postMessage } from '@/utils/common';
import { uniqueAlphaNumericId } from '@/utils/uuid';
import './index.less';

const srcUrl = 'https://view.le5le.com/v/?id=019749ca-8bc5-786f-aa04-913e3c62bea8';

export default function StockDashboard() {
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const requestId = uniqueAlphaNumericId();
    let settled = false;
    setReady(false);
    setLoading(true);
    setError('');
    const timeout = setTimeout(() => {
      settled = true;
      setError('资金大屏启动超时，请重试');
      setLoading(false);
      postMessage('stopStockDashboard', { requestId });
    }, 10000);
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (settled || message?.command !== 'stockDashboardStatus' || message.data?.requestId !== requestId) return;
      settled = true;
      clearTimeout(timeout);
      if (message.data.ready) {
        setReady(true);
      } else {
        setError(message.data.error || '资金大屏暂不可用，请重试');
        setLoading(false);
      }
    };
    window.addEventListener('message', handleMessage);
    postMessage('startStockDashboard', { requestId });
    return () => {
      settled = true;
      clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);
      postMessage('stopStockDashboard', { requestId });
    };
  }, [attempt]);

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="资金流向大屏暂不可用"
        description={error}
        action={<Button onClick={() => setAttempt(value => value + 1)}>重试</Button>}
      />
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '95vh' }}>
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--vscode-editor-background)', zIndex: 1,
        }}>
          <Spin size="large" tip="正在加载资金大屏..." />
        </div>
      )}
      {ready && (
        <iframe
          key={attempt}
          src={srcUrl}
          style={{ width: '100%', height: '100%', border: 'none' }}
          onLoad={() => setLoading(false)}
          title="地域板块资金流向大屏"
        />
      )}
    </div>
  );
}
