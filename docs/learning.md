# 学习专栏

入口：韭菜中心顶部「学习专栏」，或命令面板 `LeekFund: 学习专栏`。

资料来自 [zhouqinglong520/trading-mastery](https://github.com/zhouqinglong520/trading-mastery)。按实际仓库文件生成目录，覆盖交易体系、游资心法、个人复盘、可视化；支持关键词、分类及文件类型筛选。不会将 README 的宣传数量当作可用文件数量。

- Markdown 在专栏内阅读，支持标题、列表、引用、代码、表格和 HTTP(S) 链接。HTML 标签以文本显示，不执行仓库脚本。
- 「可视化学习」在专栏内加载 [交易大师站点首页](https://zhouqinglong520.github.io/trading-mastery/)，提供独立的「刷新页面」和「浏览器打开」。目录中的「打开可视化」也会切换到该站点首页；此入口不依赖目录 API 是否成功。若网络或站点嵌入策略导致页面无法显示，可使用浏览器打开。
- 表格、思维导图、PDF 等在原文页面查看或下载。原文链接使用同步时的仓库版本，可视化页面由上游 Pages 发布状态决定。
- 「刷新内容」重新请求 GitHub 目录，同时更新当前文章；新增、修改、删除的资料都会反映到目录中。
- 普通进入页面复用 6 小时内的目录缓存。已读文章按文件 SHA 复用；手动刷新会重新下载当前文章。
- 目录及最近 12 篇文章保存在插件全局存储的 `learning/cache.json`，文章缓存总量最多 4 MB；单次读取限制 2 MB。不会将整仓库或外部广告页面打包进插件。
- 网络故障、GitHub 限流或目录异常时保留上次可用缓存，显示错误和原同步时间，可在提示的等待时间后重试；超大文章可通过「查看原文」访问。
- 首次同步失败且没有用户缓存时，使用随插件提供的目录快照，标注「内置目录」及快照时间；文章仍从 GitHub 原始文件服务按对应版本读取，目录快照不包含文章正文。点击刷新可在网络恢复后切换到最新目录。
- HTTP 403 会与明确的额度耗尽、HTTP 429 限流区分显示。同步失败后至少等待一分钟再发起远程重试；GitHub 提供额度恢复时间或重试间隔时遵守该时间，避免反复点击加重限流。
- 自动尝试复用 VSCode 已授权给本扩展的 GitHub 登录会话。点击「使用 GitHub 账号」可连接本机 VSCode 中已登录的账号；首次使用需要通过 VSCode 的授权提示，仅申请 `read:user`，无需私有仓库权限。「切换 GitHub 账号」使用 VSCode 原生账号选择。
- GitHub 令牌仅在扩展后台内存中使用，只发送到 `https://api.github.com/repos/zhouqinglong520/trading-mastery/` 下的请求；不会传入网页、GitHub Pages、原始文件站点、日志或学习缓存。取消授权时保留已有资料。
- 登录或切换到不同账号/凭据后，清除之前身份的同步等待时间并重新同步；账号自身仍受 GitHub 的限流规则约束。本地 `git user.name`、`git user.email` 只是提交身份，不能代替登录凭据。

资料版权归原作者所有，仅供学习交流。

验证：`node scripts/test-learning.js`；加 `--live` 可验证实时目录及首篇文章。界面测试：`npm --prefix template-packages/leek-center test -- --watchAll=false --runInBand learning.test.tsx`。
