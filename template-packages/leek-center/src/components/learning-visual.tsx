import React, { useState } from 'react';
import { Button, Space, Typography } from 'antd';
import { ExportOutlined, ReloadOutlined } from '@ant-design/icons';

export const LEARNING_SITE_URL = 'https://zhouqinglong520.github.io/trading-mastery/';
export default function LearningVisual({ openExternal }: { openExternal: () => void }) {
  const [version, setVersion] = useState(0);
  return <div className="learning-visual">
    <div className="learning-visual-toolbar"><Typography.Text type="secondary">交易大师 · 在线可视化学习</Typography.Text>
      <Space wrap><Button icon={<ReloadOutlined />} onClick={() => setVersion(value => value + 1)}>刷新页面</Button>
        <Button icon={<ExportOutlined />} onClick={openExternal}>浏览器打开</Button></Space></div>
    <Typography.Paragraph type="secondary">如页面无法显示，可点击“浏览器打开”访问学习站点。</Typography.Paragraph>
    <iframe key={version} title="交易大师可视化学习站点" src={LEARNING_SITE_URL}
      sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"
      referrerPolicy="no-referrer" />
  </div>;
}
