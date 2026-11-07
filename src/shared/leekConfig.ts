/*--------------------------------------------------------------
 *  Copyright (c) Nicky<giscafer@outlook.com>. All rights reserved.
 *  Github: https://github.com/giscafer
 *-------------------------------------------------------------*/

import { window, workspace } from 'vscode';
import { uniq, events } from './utils';
import { compact, flattenDeep } from 'lodash';

export class BaseConfig {
  /**
   * 获取全局（用户）配置对象
   */
  protected static getGlobalConfig() {
    return workspace.getConfiguration(undefined, null);
  }

  /**
   * 获取全局配置值（字符串数组类型）
   */
  protected static getGlobalConfigArray(key: string, defaultValue: string[] = []): string[] {
    const config = this.getGlobalConfig();
    const configInspect = config.inspect(key);
    return (configInspect?.globalValue as string[]) ?? config.get(key, defaultValue);
  }

  static getConfig(key: string, defaultValue?: any): any {
    const config = this.getGlobalConfig();
    return config.inspect(key)?.globalValue ?? config.get(key, defaultValue);
  }

  static setConfig(cfgKey: string, cfgValue: Array<any> | string | number | Object) {
    events.emit('updateConfig:' + cfgKey, cfgValue);
    const config = this.getGlobalConfig();
    return config.update(cfgKey, cfgValue, true);
  }

  static async updateConfig(cfgKey: string, codes: Array<string>) {
    const config = this.getGlobalConfig();
    // 优先使用全局配置值
    const origin = this.getGlobalConfigArray(cfgKey);
    let newCodes = uniq(compact(origin.concat(codes)));
    console.log(`🚀 ~ BaseConfig ~ updateConfig ~ ${cfgKey}:`, newCodes);
    await config.update(cfgKey, newCodes, true);
    return newCodes;
  }

  static removeConfig(cfgKey: string, code: string) {
    const config = this.getGlobalConfig();
    // 优先使用全局配置值
    const sourceCfg = this.getGlobalConfigArray(cfgKey);
    const newCfg = sourceCfg.filter((item: string) => item !== code);
    if (sourceCfg.length === newCfg.length) {
      window.showInformationMessage(
        `删除期货不成功。请 [点击此处](https://github.com/LeekHub/leek-fund/issues/281) 查看期货相关问题`
      );
    }
    return config.update(cfgKey, newCfg, true);
  }
}

export class LeekFundConfig extends BaseConfig {
  constructor() {
    super();
  }
  // Stock Begin
  static updateStockCfg(list: string, cb?: Function) {
    const cfgKey = 'leek-fund.stocks';
    const config = this.getGlobalConfig();
    // 优先使用全局配置值
    const origin = this.getGlobalConfigArray(cfgKey);
    let codes = typeof list === 'string' ? list.split(',') : list;
    let newCodes = uniq(compact(flattenDeep(origin).concat(codes))) as string[];
    newCodes = newCodes.map((code: string) => {
      if (code.startsWith('hk')) {
        return code.toLowerCase();
      }
      return code;
    });
    config.update(cfgKey, newCodes, true).then(() => {
      window.showInformationMessage(`Stock Successfully add.`);
      if (cb && typeof cb === 'function') {
        cb(codes, newCodes);
      }
    });
  }

  static removeStockCfg(code: string, cb?: Function) {
    this.removeConfig('leek-fund.stocks', code).then(() => {
      window.showInformationMessage(`Stock Successfully delete.`);
      if (cb && typeof cb === 'function') {
        cb(code);
      }
    });
  }

  static addStockToBarCfg(code: string, cb?: Function) {
    const addStockToBar = () => {
      let configArr: string[] = this.getConfig('leek-fund.statusBarStock');
      if (configArr.length >= 8) {
        window.showInformationMessage(`StatusBar Exceeding Length.`);
        if (cb && typeof cb === 'function') {
          cb(code);
        }
      } else if (configArr.includes(code)) {
        window.showInformationMessage(`StatusBar Already Have.`);
        if (cb && typeof cb === 'function') {
          cb(code);
        }
      } else {
        configArr.push(code);
        this.setConfig('leek-fund.statusBarStock', configArr).then(() => {
          window.showInformationMessage(`Stock Successfully add to statusBar.`);
          if (cb && typeof cb === 'function') {
            cb(code);
          }
        });
      }
    };

    if (this.getConfig('leek-fund.hideStatusBarStock')) {
      this.setConfig('leek-fund.hideStatusBarStock', false).then(() => {
        addStockToBar();
      });
    } else {
      addStockToBar();
    }
  }

  static setStockTopCfg(code: string, cb?: Function) {
    let arr: string[] = this.getConfig('leek-fund.stocks');
    // 临时解决3.10.1~3.10.3 pr产生的分组bug
    const stockList = flattenDeep(arr).filter?.((item) => item !== code);
    stockList.unshift(code);

    this.setConfig('leek-fund.stocks', stockList).then(() => {
      window.showInformationMessage(`Stock successfully set to top.`);
      if (cb && typeof cb === 'function') {
        cb(code);
      }
    });
  }
  static setStockListTopCfg(codes: string[], cb?: Function) {
    let arr: string[] = this.getConfig('leek-fund.stocks');
    // 临时解决3.10.1~3.10.3 pr产生的分组bug
    const stockList = flattenDeep(arr).filter((item) => !codes.includes(item));
    stockList.unshift(...codes);

    this.setConfig('leek-fund.stocks', stockList).then(() => {
      window.showInformationMessage(`Stock Group successfully set to top.`);
      if (cb && typeof cb === 'function') {
        cb(codes);
      }
    });
  }

  static cleanStocksCfg(cb?: Function) {
    let arr: string[] = this.getConfig('leek-fund.stocks');
    const validCodeRegex = /^[a-zA-Z0-9_\.]+$/;
    const stockList = flattenDeep(arr).filter((item) => validCodeRegex.test(item));
    if (stockList.length !== flattenDeep(arr).length) {
      this.setConfig('leek-fund.stocks', stockList).then(() => {
        window.showInformationMessage(`Stock cache cleaned.`);
        if (cb) cb();
      });
    } else {
      if (cb) cb();
    }
  }

  static setStockUpCfg(code: string, cb?: Function) {
    const callback = () => {
      window.showInformationMessage(`Stock successfully move up.`);
      if (cb && typeof cb === 'function') {
        cb(code);
      }
    };

    let configArr: string[] = this.getConfig('leek-fund.stocks');
    const currentIndex = configArr.indexOf(code);
    let previousIndex = currentIndex - 1;
    // 找到前一个同市场的股票
    for (let index = currentIndex - 1; index >= 0; index--) {
      const previousCode = configArr[index];
      if (/^(sh|sz|bj)/.test(code) && /^(sh|sz|bj)/.test(previousCode)) {
        previousIndex = index;
        break;
      }
      if (/^(hk)/.test(code) && /^(hk)/.test(previousCode)) {
        previousIndex = index;
        break;
      }
      if (/^(usr_)/.test(code) && /^(usr_)/.test(previousCode)) {
        previousIndex = index;
        break;
      }
      if (/^(nf_)/.test(code) && /^(nf_)/.test(previousCode)) {
        previousIndex = index;
        break;
      }
      if (/^(hf_)/.test(code) && /^(hf_)/.test(previousCode)) {
        previousIndex = index;
        break;
      }
    }
    if (previousIndex < 0) {
      callback();
    } else {
      // 交换位置
      configArr[currentIndex] = configArr.splice(previousIndex, 1, configArr[currentIndex])[0];
      this.setConfig('leek-fund.stocks', configArr).then(() => {
        callback();
      });
    }
  }

  static setStockDownCfg(code: string, cb?: Function) {
    const callback = () => {
      window.showInformationMessage(`Stock successfully move down.`);
      if (cb && typeof cb === 'function') {
        cb(code);
      }
    };

    let configArr: string[] = this.getConfig('leek-fund.stocks');
    const currentIndex = configArr.indexOf(code);
    let nextIndex = currentIndex + 1;
    //找到后一个同市场的股票
    for (let index = currentIndex + 1; index < configArr.length; index++) {
      const nextCode = configArr[index];
      if (/^(sh|sz|bj)/.test(code) && /^(sh|sz|bj)/.test(nextCode)) {
        nextIndex = index;
        break;
      }
      if (/^(hk)/.test(code) && /^(hk)/.test(nextCode)) {
        nextIndex = index;
        break;
      }
      if (/^(usr_)/.test(code) && /^(usr_)/.test(nextCode)) {
        nextIndex = index;
        break;
      }
      if (/^(nf_)/.test(code) && /^(nf_)/.test(nextCode)) {
        nextIndex = index;
        break;
      }
      if (/^(hf_)/.test(code) && /^(hf_)/.test(nextCode)) {
        nextIndex = index;
        break;
      }
    }
    if (nextIndex >= configArr.length) {
      callback();
    } else {
      // 交换位置
      configArr[currentIndex] = configArr.splice(nextIndex, 1, configArr[currentIndex])[0];
      this.setConfig('leek-fund.stocks', configArr).then(() => {
        callback();
      });
    }
  }

  // Stock End

  // Binance Begin
  static updateBinanceCfg(codes: string, cb?: Function) {
    this.updateConfig('leek-fund.binance', codes.split(',')).then(() => {
      window.showInformationMessage(`Pair Successfully add.`);
      if (cb && typeof cb === 'function') {
        cb(codes);
      }
    });
  }
  static removeBinanceCfg(code: string, cb?: Function) {
    this.removeConfig('leek-fund.binance', code).then(() => {
      window.showInformationMessage(`Pair Successfully delete.`);
      if (cb && typeof cb === 'function') {
        cb(code);
      }
    });
  }
  static setBinanceTopCfg(code: string, cb?: Function) {
    let configArr: string[] = this.getConfig('leek-fund.binance');
    configArr = [code, ...configArr.filter((item) => item !== code)];
    this.setConfig('leek-fund.binance', configArr).then(() => {
      window.showInformationMessage(`Pair successfully set to top.`);
      if (cb && typeof cb === 'function') {
        cb(code);
      }
    });
  }
  // Binance end

  // StatusBar Begin
  static updateStatusBarStockCfg(codes: Array<string>, cb?: Function) {
    if (codes.length > 8) { window.showWarningMessage('状态栏最多展示 8 个标的'); return; }
    const updateStatusBarStock = () => {
      this.setConfig('leek-fund.statusBarStock', codes).then(() => {
        window.showInformationMessage(`Status Bar Stock Successfully update.`);
        if (cb && typeof cb === 'function') {
          cb(codes);
        }
      });
    };

    if (codes.length) {
      if (this.getConfig('leek-fund.hideStatusBarStock')) {
        this.setConfig('leek-fund.hideStatusBarStock', false).then(() => {
          updateStatusBarStock();
        });
      } else {
        updateStatusBarStock();
      }
    } else {
      if (!this.getConfig('leek-fund.hideStatusBarStock')) {
        this.setConfig('leek-fund.hideStatusBarStock', true).then(() => {
          updateStatusBarStock();
        });
      } else {
        updateStatusBarStock();
      }
    }
  }
  // StatusBar End
}
