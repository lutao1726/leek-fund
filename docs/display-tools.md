# 展示与资讯增强（第二批）

## 个性化设置与状态栏

命令面板运行 `LeekFund: 个性化设置`，也可进入韭菜中心 → 设置，或 Settings 视图 → 个性定制。

- 状态栏最多选择 8 个自选标的，支持拖动或上下按钮排序。
- 报价与收益模板提供即时预览；点击「保存显示设置」生效。
- 支持颜色、涨跌图标、收益显示、持仓高亮、价格提醒，以及底部快讯开关。
- 「侧栏栏目」页签提供 Stock、XueQiu News、Binance、Forex、Settings、LeekAgent 六个独立开关，保存后控制栏目是否启用。已被侧栏右键菜单隐藏的栏目，可点击对应「打开」按钮重新显示；新开启的栏目须先保存再打开。侧栏开关与底部 News 开关独立。
- 隐藏 Settings 后，仍可通过命令面板 `LeekFund: 个性化设置` 恢复。默认保留已有侧栏布局，开关不回显 VS Code 右键菜单的隐藏状态。
- 行情模板支持 `${name}`、`${code}`、`${price}`、`${percent}`、`${icon}`。
- 收益模板支持 `${currency}`、`${profit}`、`${todayProfit}`、`${marketValue}`、`${cost}`，仍按币种分别展示，缺失数据以 `*` 和悬浮提示标识。

设置兼容原有用户配置，更新报价模板时保留其他侧栏模板。Webhook 凭据不保存在普通设置中。

## 底部 LeekFund News

运行 `LeekFund: 打开 LeekFund News`，或点击原快讯状态栏入口。底部面板与韭菜中心、兼容 OUTPUT 共用金十和选股宝快讯服务。

- 可按来源、重要消息筛选，暂停更新或清空列表。
- 面板最多保留 500 条去重消息，时间使用数据源提供的时间。
- 面板隐藏或关闭后释放自身订阅；仍有其他页面订阅时，共享服务继续运行。
- 底部面板开关为 `leek-fund.newsPanelEnabled`；原 OUTPUT 使用原 `leek-fund.flash-news` 开关，彼此独立。
- 没有消息表示尚无可展示数据，不保证数据源持续在线或覆盖所有新闻。

## 老板模式与 Blame 行情

老板模式会在韭菜中心淡化文字，将独立实时走势页与图片走势页去色。可从设置、底部开关或走势页按钮切换，状态保存在用户设置。

Blame 行情默认关闭，开启后使用 VS Code 原生行尾装饰及 CodeLens 展示缓存行情，不修改代码文件、Git 历史或 GitLens 配置，也不另开行情请求。

- 默认仅展示未清仓持仓；可切换为自选。
- 可配置作者名、3～300 秒轮播间隔、文件顶部 0～5 条行情。
- 文件顶部行情可点击打开对应走势；行尾悬浮显示代码、报价和数据时间。
- 关闭后清空装饰；退出扩展释放定时器与监听。

## Webhook 价格预警

设置页底部支持企业微信、钉钉、飞书 / Lark 群机器人。地址与签名密钥使用 VS Code SecretStorage 保存，不回显、不写入普通配置或日志。

1. 在相应平台创建群机器人，填写对应 HTTPS Webhook 地址。钉钉、飞书启用加签时还需填写签名密钥；使用关键词校验时，可配置关键词 `LeekFund`。
2. 保存机器人配置。保存不会自动启用推送；在页面单独打开 Webhook 总开关。
3. 同时开启股票价格预警，并在原自选详情中配置价格 / 涨跌幅阈值。
4. 预警触发时保留原编辑器提醒，并向配置的平台发送文本通知。

同标的 3 分钟内去重，同平台推送至少间隔 3.1 秒，队列最多 30 条。请求 8 秒超时，不跟随重定向，不自动重试，避免不确定的重复发送；失败显示不含凭据的简短提示。编辑器关闭后不监控、不推送，也没有后台服务或券商交易接入。

协议参考：[企业微信](https://developer.work.weixin.qq.com/document/path/91770)、[钉钉](https://open.dingtalk.com/document/robots/custom-robot-access)、[飞书](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)。

## 开发验证

```powershell
npm run check
npm run test:presentation
npm run test:core
npm run test:ui -- --silent --noStackTrace
npm run build
```

自动化验证使用模拟行情和模拟 HTTP，不向真实机器人发送测试消息。实际编辑器中的布局、原生旁注与真实机器人收信仍需联调。
