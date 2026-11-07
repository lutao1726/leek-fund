import { Layout } from 'antd';
import SideBarList from '@/components/stockList/SideBarList';
import { LeekTreeItem } from '@/../types/shim-background';
import state from '@/stores/index';
import StockInfoPanel from '@/components/stock-info-panel';
import { useObserver } from 'mobx-react';

const { Content, Sider } = Layout;

function RenderMyStockContent() {
  return useObserver(() => {
    if (state.stock.stockPanelInfo) {
      return <StockInfoPanel stock={state.stock.stockPanelInfo} />;
    }
    return null;
  });
}

export default function MyStock() {

  const sideBarItemClick = function (stockInfo: LeekTreeItem) {
    state.stock.setStockPanelInfo(stockInfo);
    console.log('stockInfo: ', JSON.parse(JSON.stringify(stockInfo)));
  };

  return (
    <Layout>
      <Sider
        width={220}
        style={{
          overflow: 'auto',
          height: 'calc(100vh - 86px)',
          position: 'fixed',
          left: 0,
        }}
      >
        <SideBarList currentStock={undefined} onClick={sideBarItemClick} />
      </Sider>
      <Content
        style={{
          height: 'calc(100vh - 86px)',
          position: 'fixed',
          left: 220,
          width: 'calc(100vw - 220px)',
          overflowY: 'auto',
        }}
      >
        <RenderMyStockContent />
      </Content>
    </Layout>
  );
}
