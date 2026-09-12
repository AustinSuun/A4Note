# 浏览器原生通信迁移

## 已确认交互

用户已选择 Native Messaging，正常路径不要求输入链接、端口、扩展ID或配对码。首次由用户在扩展发起连接，在桌面确认授权；此后恢复已授权连接。禁止把旧HTTP地址框隐藏后冒充原生通信。

## 接入设计

- 独立 Rust host（apps/native-host），不启动 Tauri GUI，不将日志写入 stdout。避免给 stdio host 链接/初始化桌面窗口运行时。
- 扩展使用 chrome.runtime.connectNative('app.aster.research.capture')；stdio传输为4字节本机端序长度加UTF-8 JSON，单帧上限1MiB。只允许已定义操作，不提供文件路径/命令执行接口。
- Host与已运行桌面通过Windows命名管道连接，而非HTTP。管道限定当前用户ACL、拒绝远程客户端、首实例排他；检查调用来源和授权。桌面未运行时给出明确提示，不扫描端口。
- 固定扩展公钥身份，由构建生成并校验扩展ID及host allowed_origins白名单。公钥不是秘密，也不替代桌面授权。不能接受网页消息中自报的扩展ID作为身份。
- hello只查询连接/授权状态；request_access才发起桌面确认，防重复弹窗和请求轰炸；拒绝后不自动反复询问。授权按用户持久保存，支持撤销；不沿用12小时手填令牌流程。
- 授权后的submit/list_tasks复用现有持久队列、元数据补全及入库保护，不在host另建文献库或独立下载工作线程。
- PDF使用小块消息：每块192KiB原始字节，server分配transferId，限制总50MiB、序号、时限与并发。原生验证结构与SHA256后进入同一任务，关闭/取消/撤销清理本次暂存，不接受浏览器指定落盘路径。
- 安装器负责Chrome/Edge当前用户NativeMessagingHosts注册，清晰区分安装范围。卸载只删除本安装拥有的注册项，不误删其他安装或用户资料。裸EXE不冒充已经注册host的安装版。
- shipping popup 0.4.0已切换Native Messaging，必须配套新安装器。旧HTTP仅编译入回归测试；正式程序无HTTP回退。

## 当前实现

已接入独立Rust stdio host、SID命名管道/双方进程路径校验、持久授权与桌面确认/撤销、192KiB PDF分块、同一Store/入库worker、0.4.0扩展自动连接及NSIS按用户注册/所有权安全卸载。标准Windows打包先编译无测试feature的host并捆绑清单。公钥固定并由打包校验；桌面版本号仍沿用0.1.2，须核对build-info中的captureTransport而非只看版本号。

真实隔离stdio子进程回归cmd_1789213691893_18 exit0；Native协议/授权/管道/入库8项cmd15通过。真实Chrome/Edge安装后完整GUI端到端仍待验收；不得据mock或隔离服务子进程声称已通过。完整verify cmd20通过（Rust183/0/5默认忽略，专用进程回归独立运行），NSIS真实宏隔离注册回归通过；Windows安装器cmd21已发布latest，builtAt2026-09-12T11:55:51.168Z，扩展ZIP0.4.0已生成。cmd25独立哈希及release host检查通过，安装器未签名。

## 验证门槛

1. 帧边界、Unicode、多帧、EOF、截断、过大消息、未知操作/身份伪造字段、输出失败。
2. 浏览器请求关联、连接复用、拒绝授权、断开/重连、超时和监听器清理。
3. 真正stdio子进程+管道跨进程回归，未授权不得提交或上传，撤销和关闭可恢复。
4. 隔离注册/安装/修复/卸载检查，验证Chrome和Edge白名单与扩展ID一致；不在未确认情况下改真实浏览器配置。
5. 真实扩展→host→桌面→PDF/元数据入库验收。Mock通过不等于Native Messaging已经可用。
