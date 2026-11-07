import store from '@/stores/index';
import { receiveFetchResponse } from '@/utils/fetch';

const CommandHandler: Record<string, (data: any) => any> = {
  updateStockList(data) {
    store.stock.setStocks(data);
  },
  updateStockQuotes(data) { store.stock.applyQuoteUpdates(data); },
  updateStockGroups(data) { store.stock.setGroups(data); },
  updateStockRemind(data) {
    // console.log('updateStockRemind: ', data);
    store.stock.setStockRemind(data);
  },
  fetchResponse(data) {
    receiveFetchResponse(data);
  },
  postFlashNews(data) {
    console.log('postFlashNews: ', data);
    store.news.appendNews(data);
  },
};

export function setupBackgroundManagement() {
  window.addEventListener('message', (event) => {
    const { command, data } = event.data;
    try {
      if (CommandHandler[command]) {
        CommandHandler[command](data);
      }
    } catch (err) {
    } finally {
    }
  });
}
