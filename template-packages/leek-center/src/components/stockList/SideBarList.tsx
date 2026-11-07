import { Button, Collapse, Input, Space } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useObserver } from 'mobx-react';
import state from '@/stores/index';
import styles from './SideBarList.module.less';
import { LeekTreeItem } from '@/../types/shim-background';

import Item from './SidebarItem';
import { postMessage } from '@/utils/common';

const { Panel } = Collapse;

export default function SideBarist({
  currentStock,
  onClick,
}: {
  currentStock: undefined | LeekTreeItem;
  onClick?: (stockInfo: LeekTreeItem) => void;
}) {
  const [query, setQuery] = useState('');
  const search = useRef<Input>(null);
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && !target.isContentEditable) {
        event.preventDefault(); search.current?.focus();
      }
    };
    window.addEventListener('keydown', focus);
    return () => window.removeEventListener('keydown', focus);
  }, []);
  return useObserver(() => {
    const store = state.stock;
    const quotesByCode = new Map(store.stocks.map(stock => [stock.info.code, stock]));
    const allCodes = store.groups.reduce<string[]>((codes, group) => codes.concat(group.codes), []);
    const groups = store.groupsEnabled ? [
      ...(store.heldCodes.length ? [{ id: 'holdings', name: '我的持仓', codes: store.heldCodes }] : []), ...store.groups,
    ] : [{ id: 'stock', name: '股票', codes: store.groups.length ? allCodes : store.stocks.map(stock => stock.info.code) }];
    return (
    <>
      <Input ref={search} allowClear placeholder="搜索代码或名称（/）" value={query} onChange={event => setQuery(event.target.value)} style={{ margin: '12px 8px', width: 'calc(100% - 16px)' }} />
      <Space style={{ padding: '0 8px 10px' }} wrap>
        <Button size="small" onClick={() => postMessage('executeCommand', 'leek-fund.addStockGroup')}>新增分组</Button>
        <Button size="small" onClick={() => postMessage('executeCommand', 'leek-fund.toggleStockGroups')}>{store.groupsEnabled ? '市场分类' : '自定义分组'}</Button>
      </Space>
      {groups.map(group => {
        const items = group.codes.map(code => quotesByCode.get(code) || { info: { code, name: code, percent: '', price: undefined } });
        const matches = items.filter(stock => `${stock.info.name} ${stock.info.code}`.toLowerCase().includes(query.trim().toLowerCase()));
        if (query && !matches.length) return null;
        return <Collapse key={group.id} defaultActiveKey={[group.id]} className={styles['stock-list']}>
          <Panel header={`${group.name} (${matches.length})`} key={group.id}>
            {matches.length ? matches.map(stock => <Item key={stock.info.code} selected={(currentStock || store.stockPanelInfo)?.info.code === stock.info.code} stock={stock} onClick={() => onClick?.(stock)} />) : <div className="empty">暂无股票，可从 Stock 侧栏添加或移动</div>}
          </Panel>
        </Collapse>;
      })}
    </>
  );
  });
}
