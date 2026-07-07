# PR 检查清单

## 改动内容

- 

## 影响模块

- [ ] `src/core`
- [ ] `src/platform`
- [ ] `src/features/library`
- [ ] `src/features/reader`
- [ ] `src/features/ai`
- [ ] `src/features/settings`
- [ ] `src/workbench`
- [ ] `src/shared`
- [ ] `src/ui`
- [ ] `src-tauri`
- [ ] `docs`

## 风险类型

- [ ] 修改数据结构或 SQLite schema
- [ ] 修改 PDF 导入或文件复制
- [ ] 修改 PDF 阅读或标注
- [ ] 修改 AI Provider 或 AI 上下文
- [ ] 修改插件/命令/工作台扩展点
- [ ] 修改 UI 视觉或布局
- [ ] 仅文档改动

## 已运行验证

- [ ] `npm run build`
- [ ] `npm run test:architecture`
- [ ] `npm run verify`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] 不适用，原因：

## Review 说明

需要重点 review 的地方：

- 

是否需要模块 owner review：

- [ ] 是
- [ ] 否

## 截图或说明

如果修改 UI，请附截图或说明界面变化。

