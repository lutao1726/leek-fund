import { Layout, Menu } from 'antd';
import Styles from './Header.module.less';
import { useHistory, useLocation } from 'react-router-dom';
import { MenuInfo } from 'rc-menu/lib/interface';
const { Header } = Layout;
const { SubMenu } = Menu;

export default function LHeader() {
  let history = useHistory();

  const location = useLocation();

  function handleClick(e: MenuInfo) {
    history.replace(e.key.toString());
  }

  return (
    <Header className={Styles.header}>
      <div className={Styles.logo}>韭菜中心</div>
      <Menu
        onClick={handleClick}
        // theme="dark"
        mode="horizontal"
        overflowedIndicator={<span aria-label="更多导航">更多 ···</span>}
        selectedKeys={['/' + location.pathname.split('/')[1]]}
      >
        <Menu.Item key="/daily-summary">今日摘要</Menu.Item>
        <Menu.Item key="/my-stocks">我的自选</Menu.Item>
        <Menu.Item key="/portfolio">资产</Menu.Item>
        <Menu.Item key="/research">AI 研究</Menu.Item>
        <Menu.Item key="/agent">LeekAgent</Menu.Item>
        <Menu.Item key="/learning">学习专栏</Menu.Item>
        <Menu.Item key="/news">新闻快讯</Menu.Item>
        <Menu.Item key="/stock-changes">个股异动</Menu.Item>
        <Menu.Item key="/market-map">大盘云图</Menu.Item>
        <Menu.Item key="/sector-boards">板块行情</Menu.Item>
        <Menu.Item key="/data-center">数据中心</Menu.Item>
        <Menu.Item key="/settings">设置</Menu.Item>
        <SubMenu key="3" title="工具">
          <Menu.Item key="3">我的预警</Menu.Item>
        </SubMenu>
      </Menu>
    </Header>
  );
}
