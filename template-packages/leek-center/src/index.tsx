import './index.less';
import React from 'react';
import ReactDOM from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

import { postMessage } from './utils/common';
import { setupBackgroundManagement } from './services/background';

declare let __webpack_public_path__: string;
// Webpack consumes this assignment when loading split JS and CSS chunks.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
if ((window as any).leekCenterPublicPath) __webpack_public_path__ = (window as any).leekCenterPublicPath;

const initialRoute = (window as any).initialRoute || '/';

ReactDOM.render(
  <MemoryRouter initialEntries={[initialRoute]}>
    <App />
  </MemoryRouter>,
  document.getElementById('root'),
  () => {
    setupBackgroundManagement();
    postMessage('pageReady');
  }
);
