import { Layout, Space, Divider, Button, Switch } from 'antd';
import { postMessage } from '@/utils/common';
import { useEffect, useState } from 'react';
const { Footer } = Layout;

export default function LFooter() {
  const [boss, setBoss] = useState(document.body.classList.contains('mode-moyu'));
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.data?.command === 'presentationSettings') setBoss(event.data.data.settings.bossMode === true);
      if (event.data?.command === 'presentationChanged') setBoss(event.data.data.bossMode === true);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  return (
    <Footer style={{ lineHeight: '32px' }}>
      <Space>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          老板模式：
          <Switch
            checked={boss}
            onChange={(checked) => {
              setBoss(checked);
              postMessage('setBossMode', checked);
              document.body.classList[checked ? 'add' : 'remove']('mode-moyu');
            }}
            size="small"
          />
        </div>
      </Space>
      <Space
        style={{ float: 'right' }}
        align="end"
        split={<Divider type="vertical" />}
      >
        <Button
          onClick={() => {
            postMessage('executeCommand', 'leek-fund.viewFundFlow');
          }}
          type="link"
        >
          北向资金流向
        </Button>
        <Button
          onClick={() => {
            postMessage('executeCommand', 'leek-fund.viewMainFundFlow');
          }}
          type="link"
        >
          主力资金流向
        </Button>
      </Space>
    </Footer>
  );
}
