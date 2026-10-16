# WebGL Studio

面向作品、热点、导览、交互和 Player 界面的场景创作工作台。React / TypeScript / Vite / Zustand，统一 Three.js 场景运行层，.NET 10 Windows Native AOT API，SqlSugar / MySQL 协议数据库、真实 MinIO 和 IMemoryCache。

导入素材 → 搭建场景 → 编辑热点与导览 → 设计界面和交互 → 完整预览 → 保存与发布独立 Player。

本次基线为 main `f1e4863`，开发分支 `codex/studio-creation-experience`。直接维护当前 SceneDocument 契约，不保留分代运行入口，不迁移既有展厅文档。

## 工作台

- 场景搭建：模型层级、选择、变换、材质、光照、环境与碰撞。
- 热点内容：点击场景放置热点，作品和交互引用同一份内容资料。
- 导览巡航：记录画面、排列视点、设置停留和移动，保留镜头与路径精调。
- 事件交互：模板、条件组、顺序动作、分支、变量、等待与执行调试。
- 界面设计：共享 DOM/CSS 画布设计菜单、业务控件和内容版式，支持桌面、平板、手机覆盖。

预览和公开 Player 共用 UI、业务调度与播放状态。停止预览会取消动作并恢复编辑相机和文档状态。资源库按需打开，窄窗口使用抽屉。

## 目录与所有权

| 目录 | 职责 |
| --- | --- |
| apps/editor | 五个任务工作区、二维画布、三维编辑工具、IndexedDB 恢复 |
| apps/player | 公开加载不可变发布，使用共享 Player UI |
| packages/scene-schema | 当前 JSON Schema、业务引用、内容、视点、规则、UI 定义 |
| packages/editor-core | EditorCommand、结构共享、正反向变更、撤销重做 |
| packages/scene-runtime | 加载、增量更新、运行会话、动作取消、巡航、媒体和资源所有权 |
| packages/player-ui | 设计画布与播放共用的 DOM/CSS 渲染和业务控件 |
| packages/asset-pipeline | Worker 解包、解析、缩略图与原始素材导入 |
| packages/engine | Three.js 设备、帧调度、质量和性能设施 |
| server/Studio.Api | AOT Minimal APIs、JWT、CAS 草稿、不可变版本、MinIO 和发布事务 |
| server/migrations | 数据库结构 SQL；与场景文档分代无关 |

## 本机启动与交付

完整说明见 [Windows 启动与发布](docs/windows-delivery.md)，设计见 [统一架构](docs/studio-creation-design.md) 和 [创作流程](docs/studio-product-design.md)，结果见 [实际验收记录](docs/acceptance/windows.md)。

```powershell
npm ci
npm run typecheck
npm run lint
npm run build
.\scripts\package-windows.ps1 -SkipFrontend
.\scripts\start-local.ps1 -ConfigPath .local/config.json -Port 18080
```

本机数据库与 MinIO 服务须先运行。工作台地址为 `http://127.0.0.1:18080/editor/`。密码、连接配置、持久化数据和工具位于忽略目录，不进入 Git 或发布 ZIP。

所有编辑通过命令提交；播放会话不写工程。云端按 expectedRevision 保存，冲突返回 409 并保留当前窗口的本地事务；可恢复或另存。不可变 Manifest 先写入 MinIO，最后以数据库事务切换发布指针。缺失资源及未完成业务配置阻止发布。

门禁为 typecheck、lint、build 和真实浏览器操作；不引入前端测试框架。`verify:experience` 检查命令与业务调度契约，`verify:contracts` 比较前后端契约，`verify:integration` 连接真实数据库和 MinIO。故障注入命令与结果见验收记录。

## Studio 2

统一扩展、沉浸布局与命令中心说明见 [架构设计](docs/studio-2-design.md) 和 [扩展开发](docs/extensions.md)。新增受信任扩展只需在 `packages/extensions` 提供 Schema、RuntimeSystem 和 EditorCommand 工具，构建生成两端目录；未知扩展数据保留，未解析依赖阻止发布。

紧凑布局默认收起停靠面板，Space 在视口焦点时切换专注模式，Ctrl+. 搜索命令，? 打开快捷键帮助与重映射。输入法、输入框和右键飞行具有输入优先级。预览复用已有 Canvas 与 Runtime，会话停止后恢复编辑状态。

```bash
npm ci
npm run schema:generate
npm run typecheck
npm run lint
npm run verify:extensions
npm run verify:experience
npm run build
# 完整 API / MySQL / MinIO 环境启动后
npm run verify:contracts
npm run verify:integration
npm run verify:browser
```

[可移植行业样例](examples/README.md) 使用合成几何，包含 50 零件的汽车拆解和 100 管线 / 1000 管段 / 500 标签的管网。它们可通过工程导入、编辑、预览和发布。真实 CAD/IFC 双向编辑不在当前产品边界内。
