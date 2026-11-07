import type { FundInfo as BGFundInfo } from '../../../src/shared/typed';
export type FundInfo = BGFundInfo;
/** JSON sent over the Webview bridge; never import the extension's VS Code classes. */
export interface LeekTreeItem {
  info: FundInfo;
  id?: string;
  type?: string;
  isCategory?: boolean;
}
