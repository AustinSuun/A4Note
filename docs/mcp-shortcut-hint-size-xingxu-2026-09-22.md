# 快捷键提示放大与鼠标侧键短名（星序）

任务：`63b530ee-4852-47f9-ac1d-7ed430ed7fad`，spec2。独立分支 `fix/shortcut-hint-size-xingxu`，工作树 `.worktrees/hint-size-xingxu`。原始基线 `9714b06`；已整合最新 main `8a3b1ed` 的文本颜色/B/I 修改，未覆盖其产品文件，也未修改仍由其他 Agent 负责的图层入口高度代码。

## 实现

- 默认键帽 11→**16px**，文字行高24px，最小宽28px，名义高度29px；功能名12→**15px**。保留原来的逆 UI zoom 机制，不扩大应用、工具图标或工具栏本体。
- 按真实 DOM 测量定位；浮动行内容宽度上限320px，键位列有界（常规144px、受限128px）。先尝试大尺寸，只有无法完整摆下所有提示时，才将**非按钮浮动行**降为14px紧凑态；按钮旁/底部键帽始终16px，不以隐藏必要提示过测。
- 测量副本与显示节点共享明确的字体继承，避免原生 WebView 的加号字体宽度差异导致测量一行、显示两行。列宽独立于自身被约束后的宽度，避免循环收缩到0。
- 底部超长组合键让末尾动作键靠近按钮、修饰键向左延伸，为相邻按钮保留空间；保留上下错位、控件碰撞和视口检查。
- `button=3` 显示 **M4**（鼠标后退键），`button=4` 显示 **M5**（鼠标前进键）；共享 keycap formatter 同时覆盖设置与提示。完整 `formatBinding`、title/aria 中文含义、绑定格式和派发均不变。
- 文本浮动栏及其色板原先没有 dialog/menu/obstacle 标记，只避让里面的按钮，会压到色板标题/空白区域。原生红测复现后，在提示层统一保护 `.annotation-inline-actions` 和 `.annotation-color-palette` 整体矩形；未改文本工具产品实现。

## 同场景原生尺寸对照

`.tmp/shots/hint-size-native/paired/` 的 before/after 使用同一原生窗口、同一页面和相同最新 main 工具栏。before 临时载入原始9714b06的四个快捷键模块，after逐字节恢复最终版本；脚本 finally 强制恢复，Git复核业务文件零差异。它不回滚文本/B/I并行实现，不重建或复制资料库。

条件：1280×820 CSS viewport、DPR1.25、UI100%、PDF118%、a4note浅色主题。

| 实测 | before | after |
|---|---:|---:|
| 键帽字号 | 11px | 16px（+45%） |
| 功能名称字号 | 12px | 15px |
| 键帽高度（原生分数像素） | 20.4px | 28.4px |
| Alt键帽宽度 | 24.75px | 33.64px |
| 底部相邻提示最小间隙 | 19px | 9px |
| 工具坞矩形宽×高 | 444.60×69.60px | 完全相同 |

工具坞位置、所有内部按钮矩形逐项相等。此69.6px是既有工具坞高度，不是本任务额外撑高或图层卡目标高度。新字号利用原有提示间隙而不是增加按钮间距；完整原始矩形在 paired/result.json。

## 验证

- 旧字号浏览器红测：`before/initial-size.json`、截图及失败日志；旧11px无法通过新16px/最小键帽尺寸断言。
- 快捷键 core52、dispatcher50、layout35、settings22 全过。
- 真实组件浏览器 **461项**通过：default/长组合+M4/M5 × 浅深色 × 800×600/1280×800 × UI80/100/125/150，共32组合；另覆盖绑定即时更新、动作执行、锚点显隐、长组合、Ctrl释放、透明无盒装、整块popup/文本色板避让。浏览器主题矩阵使用主题变量，原生另通过实际设置页切换深夜主题取证。
- Windows/Tauri 官方 dev:live 主矩阵 **153项**通过：侧栏、UI80/100/140、真实PDF335、长组合与两侧键、窄窗、受控CSS150、工具弹窗；CDP back/forward事件分别激活underline/area，长Ctrl+Alt+Shift+F9激活highlight，后退侧键完整中文title保留。pageerror/console error为0。
- 原生附加 **87项**通过：最新main直接B/I、文本浮动栏、文字色板、实际设置页深夜主题、UI120及受控CSS125、侧栏关闭。断言整个浮动栏和色板矩形均不与提示交叠，pageerror/console error为0。
- 同场景原生配对通过：字号、PDF/UI/DPR一致性、工具坞/按钮不变、完整可见，pageerror/console error为0。
- **PowerShell `npm run verify` 全量通过**，退出0，211.647秒；包含TypeScript/build、Reader/UI-state、PDF查找、插件/任务/资源/图层/选区/橡皮等，Rust215 passed、0 failed、5 ignored。共享快捷键 diagnostics 0；diff check通过。
- 首轮全量verify跑完后有2项失败：Reader/ui-state仍断言已被main文本任务删除的字号/外框UI，以及旧通用色路径。仅同步这两份测试契约到已验收设计（验证缺失UI、保留内部字段、验证实际textColor分支），不恢复废弃UI、不改其他Agent产品逻辑；复跑全量绿。

### 如实保留的额外问题与范围

另外单跑不在全量verify内的 `verify-pdf-text-annotation-browser.mjs`，两次停在第454行东侧手柄拖拽宽度断言（216→285px，脚本期望增宽>100px）。在**未包含本任务的干净 main 8a3b1ed**上，用相同脚本、只重定向证据输出路径，再次复现同一断言失败。Reader文本源码及该脚本与main完全相同，未代改其缩放逻辑或放宽断言；保留工作树与main对照日志，作为既有文本回归待独立跟进，不能宣称此附加脚本通过。

应用当前真实UI缩放偏好上限是140%，不是150%。因此原生80/100/120/140由实际快捷键操作；125/150是额外受控CSS布局压力测试，**不宣称应用设置可选择150%**。800×600使用CDP viewport模拟，DPR1.25为本机原始值，不宣称多物理显示器认证。鼠标侧键是CDP输入事件，不是手持硬件点击。PDF335用分段真实Ctrl-wheel达到，并断言页面显示335%，不与UI zoom混淆。

早期原生baseline目录中04-pdf335实际仅111%、07-narrow-ui150实际140%（旧驱动单次wheel被限幅、应用zoom上限）；保留原始证据不篡改，不以其文件名充当335/150证明。最终after含真实335及单独07b-narrow-css-ui150，配对目录统一118%。旧baseline08弹窗邻接断言曾失败，本轮长组合末键对齐后通过。

## 证据与交接

- 主矩阵：`.tmp/shots/hint-size-native/after/`；补充：`extra/`；严格前后：`paired/`。
- 真实色板避让红测：`extra-before-popup-fix/`；浏览器：`.tmp/shots/hint-size-browser/{before,final}/`。
- 日志：`.tmp/hint-size/{verify-green,native-after-final,native-extra,paired,browser-final,text-browser-retry,text-main-baseline}.log`。
- 可复跑原生驱动：`.tmp/hint-size/{native,extra,paired}.mjs`，与尺寸JSON和日志一并作为结果附件提供；paired会暂时切换自有快捷键源文件，必须仅在本任务工作树、无其他写入时运行。setup仅首次导入，已有fixture.json时不要重复导入。
- 隔离身份 `app.aster.research.dev.hint-size-xingxu.wafaaa7f0d6`，Vite1469/CDP9269；截图保留DEV原生已核验条。MCP重连后只回收经PID和端口核验已退出的自有旧锁，保留锁备份，没有清理其他Agent实例。
- 最终交付SHA/本地main包含关系与附件ID以任务卡delivery为准。下一步用户验收；不自行归档。不打包、安装、推送、发布，不访问正式资料库。
