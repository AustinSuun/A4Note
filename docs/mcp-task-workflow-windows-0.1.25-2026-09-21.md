# 任务流程代码集成与 Windows 0.1.25 本地包

## 结果

先集成验证、再合并本地main、最后打包，均已完成。产品源码提交c72776272641193b2599bff6583e0c56fcd00184；此前34738d6已整合，包含网关退出生命周期代码及本次Agent负责合并的流程修复。

新流程：Agent开发验证 → 合并本地main → 提交待检查 → 用户验收归档。新code交付在submit时只读校验main包含关系。归档不执行Git合并或验证命令；旧交付unknown仍可归档，同时保留合并未确认提示。

## 用户授权例外与安全边界

用户明确允许仅豁免main中的未跟踪报告docs/mcp-archived-main-reconciliation-qinglan-2026-09-21.md，原地保留、不提交、不删除。ff-only合并前后SHA256均为4b7ac4994f0ee65f8655c5005fdc77151da4f69784ec82039f204066e51a6a91；目标工作区没有其他变化。状态JSON冲突保留双方记录。

未安装、未启动安装器、未重启或替换现有任务服务、未推送/发布、未修改真实任务验收状态或真实资料库。旧服务仍可能拦截截图中两卡归档；需后续明确授权受控升级才在运行实例生效。

## 产物

独立目录：D:/WorkSpace/Aster/.worktrees/agent-owned-merge/artifacts/windows/latest/

- A4 Note_x64-setup.exe（Windows x64安装包）
- a4note.exe（应用主程序；不能把单文件当作含完整服务资源的安装包）
- A4 Note_x64-setup.exe.sig、build-info.json、latest.json

版本0.1.25；builtAt2026-09-21T01:20:10.619Z。旧的共享artifacts/windows/latest/0.1.24未覆盖。latest.json只是本地标准打包输出，不表示对应GitHub版本已发布。

| 文件 | SHA256 |
| --- | --- |
| a4note.exe | 4CA3455E964920D4C83C6F1A82ACDCD74D4A8F42A91A7E11C2649CB698F34BAE |
| A4 Note_x64-setup.exe | A28DA51F5F55549BEA6BEAB31568A650CEE4D129D32999B9B5AF3DE3644AF0DF |

## 验证

- 合并分支任务服务专项：86通过、1跳过；验收109断言、编辑冲突14断言及打包依赖检查通过。
- 完整npm run verify通过；Rust201通过、5忽略。生产构建、架构、状态检查通过；taskboard诊断0项。
- 标准npm run package:windows退出0；隔离前端/原生宿主/Cargo target；EXE内5个前端入口资源校验通过，更新签名生成且非空。
- 7-Zip只解包未安装；包内全部18个配置资源与源码/宿主输出SHA256一致，包含task-delivery、store、MCP和gateway-lifecycle。
- 直接加载解包出来的任务服务代码运行交付及自动验收集成测试：7/7通过，包括旧unknown交付归档、脏main/哨兵保留、提交前已合并校验、自动验收归档。
- EXE/安装包哈希独立复算与build-info一致。

构建信息诚实保留sourceDirty=true：构建后Git仅标记src-tauri/Cargo.toml修改，diff为空，进一步读取工作区与HEAD逐字节比较一致（rawBytesMatch=true）；刷新该文件索引后无暂存差异。未篡改build-info为clean，不把此包冒充sourceDirty=false的产物。

未验证：安装器实际安装/升级、现有用户桌面端归档点击及真实任务库受控切换；未声称安装版已经修复。现有Rust未使用代码与前端chunk/动态导入警告保留。

## 证据

独立工作区.tmp/package-0125-audit.json、.tmp/package-0125-service-tests.log、.tmp/package-0125-source-dirty-explanation.json记录包内检查。命令cmd_975480144f5babc535034eb1604d2fc5cc41829a91361128完成打包；cmd_f0b45a066df87b3557748037b1f4c53eb421c37c59bb80c5完成解包核验。历史复核阻塞已按本轮授权处理，之前报告的阻塞描述不再是最新集成状态。
