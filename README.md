# WebGL Studio v1

React / TypeScript / Vite / Zustand 编辑器，独立 Player，统一 Three.js 文档运行层，.NET 10 Native AOT API，SqlSugar / MySQL 8 / MinIO 持久化。

导入真实展厅 → 可视化编辑 → 配置业务组件和事件动作 → 预览 → 云端保存 → 发布独立 Player。

实现基线 main 5a9fdd2（包含用户原始基线 9942d73），分支 codex/webgl-studio-v1。Linux x64 为本次验收与交付平台，Windows 豁免。

## 目录

- apps/editor：中文五区 Dockview 工作台，命令编辑、恢复和发布。
- apps/player：公开播放已发布版本，无编辑器、Gizmo 或编辑状态依赖。
- packages/scene-schema：SceneDocument v1、组件/动作/属性 JSON Schema 与引用校验。
- packages/editor-core：不可变事务、撤销重做、子树复制、删除与重组。
- packages/scene-runtime：文档实例、增量同步、资源、导航和完整业务组件。
- packages/engine：Three.js 设备、帧调度、质量、性能与资源引用计数。
- packages/asset-pipeline：O2VR 导入和标准几何转换、glTF 节点映射；旧格式只存在于此边界。
- server/Studio.Api：AOT Minimal APIs、JWT、草稿 CAS、版本、资源和发布事务。
- server/migrations：版本化 SQL。
- scripts / infrastructure：Linux 隔离服务、导入、集成验收与打包。
- public：真实原始展厅及作品绑定，作为导入输入，不由 Player 直接读取。

## 使用与验收

见 docs/linux-delivery.md 的完整启动、配置和打包步骤。实际结果见 docs/acceptance/linux.md。统一语义与所有权设计见 docs/studio-v1-design.md。

源码命令：

    npm ci
    bash scripts/services.sh build
    bash scripts/services.sh up
    bash scripts/package-linux.sh
    bash scripts/start-linux.sh
    NODE_USE_ENV_PROXY=1 npm run import:showroom

工作台地址 http://127.0.0.1:18080/editor/ 。登录凭据保存在本机 .local/config.json，文件权限 0600；数据、日志、缓存及凭据均被 Git 忽略。

前端验收：npm run typecheck、npm run lint、npm run build，以及真实浏览器 UAT；不新增前端自动化测试套件。域契约与后端工具验收：npm run verify:contracts、STUDIO_FAULTS=1 npm run verify:integration。

所有文档修改经过 EditorCommand；运行对象不进入持久化文档。云保存冲突返回 409 并保留本地事务。资产缺失阻止发布。发布首先写不可变 MinIO Manifest，再事务切换 MySQL 指针，失败保留上一版本。公开 Player 资源请求由数据库检查发布范围。

模型的子节点按 glTF node index 关联；复制整个模型实例保留骨骼与动画，子节点可选择、变换、重组和覆盖材质。多轨时间线、行为图、多人协作和多账号项目权限不在首版范围。
