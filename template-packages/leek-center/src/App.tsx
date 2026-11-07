import { Layout } from 'antd';
import LHeader from './components/layout/Header';
import LFooter from './components/layout/Footer';
import routes from './router-config';
import { Switch, Route, Redirect, useLocation, useHistory } from 'react-router-dom';
import { Suspense, useEffect } from 'react';
import { postMessage } from './utils/common';
import state from './stores';
const { Content } = Layout;

function App() {
  const location = useLocation();
  const history = useHistory();
  useEffect(() => {
    const navigate = (event: MessageEvent) => {
      if (event.data?.command !== 'navigate') return;
      const { route, code } = event.data.data;
      if (typeof route !== 'string' || !['/learning', '/agent', '/my-stocks', '/portfolio', '/research', '/daily-summary', '/settings', '/market-map', '/stock-changes', '/sector-boards'].includes('/' + route.split('?')[0].split('/')[1])) return;
      if (code) {
        const selected = state.stock.stocks.find(item => item.info.code === code);
        if (selected) state.stock.setStockPanelInfo(selected);
      }
      history.replace(route);
    };
    window.addEventListener('message', navigate);
    return () => window.removeEventListener('message', navigate);
  }, [history]);
  useEffect(() => {
    const update = (event: MessageEvent) => {
      if (event.data?.command === 'presentationSettings') document.body.classList.toggle('mode-moyu', event.data.data.settings.bossMode === true);
      if (event.data?.command === 'presentationChanged') document.body.classList.toggle('mode-moyu', event.data.data.bossMode === true);
    };
    window.addEventListener('message', update); postMessage('getPresentationSettings');
    return () => window.removeEventListener('message', update);
  }, []);
  const hideLayoutPaths = ['/ai-config', '/xuangubao-news'];
  const isHideLayout = hideLayoutPaths.includes(location.pathname) || (location.pathname === '/agent' && (window as any).leekAgentStandalone === true);

  return (
    <Layout>
      {!isHideLayout && <LHeader></LHeader>}
      <Content style={!isHideLayout ? { marginTop: 50, minHeight: 'calc(100vh - 86px)' } : { minHeight: '100vh' }}>
        <Suspense fallback={<div>加载中...</div>}><Switch>
          {routes.map((routeConfig) => (
            <Route
              key={
                (Array.isArray(routeConfig.path)
                  ? routeConfig.path.join(',')
                  : routeConfig.path) as any
              }
              {...routeConfig}
            ></Route>
          ))}
          <Redirect from="/" to="/my-stocks"></Redirect>
        </Switch></Suspense>
      </Content>
      {!isHideLayout && <LFooter></LFooter>}
    </Layout>
  );
}

export default App;
