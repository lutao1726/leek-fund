import { lazy } from 'react';
import MyStock from '@/view/my-stocks';
import { RouteProps } from 'react-router-dom';
const DataCenter = lazy(() => import('@/view/data-center'));
const Agent = lazy(() => import('@/view/agent'));
const FlashNewsView = lazy(() => import('@/view/flash-news'));
const Portfolio = lazy(() => import('@/view/portfolio'));
const Research = lazy(() => import('@/view/research'));
const DailySummary = lazy(() => import('@/view/daily-summary'));
const Learning = lazy(() => import('@/view/learning'));
const PresentationSettings = lazy(() => import('@/view/presentation-settings'));
const SectorBoards = lazy(() => import('@/view/sector-boards'));
const MarketCloudMap = lazy(() => import('@/view/market-map'));
const StockChanges = lazy(() => import('@/view/stock-changes'));

const routes: RouteProps[] = [
  { path: '/learning', exact: true, component: Learning },
  { path: '/agent', exact: true, component: Agent },
  { path: '/daily-summary', exact: true, component: DailySummary },
  { path: ['/sector-boards', '/sector-boards/:bkCode'], exact: true, component: SectorBoards },
  { path: '/market-map', exact: true, component: MarketCloudMap },
  { path: '/stock-changes', exact: true, component: StockChanges },
  { path: '/settings', exact: true, component: PresentationSettings },
  { path: '/research', exact: true, component: Research },
  { path: '/portfolio', exact: true, component: Portfolio },
  {
    path: ['/my-stocks'],
    exact: true,
    component: MyStock,
  },
  {
    path: '/data-center',
    component: DataCenter,
  },

  {
    path: '/news',
    component: FlashNewsView,
  },
];
export default routes;
