# Studio 2.2 · Linux G1 验收

日期：2026-10-16（UTC）。基线 `631d782815dd66c51597f578691fd2b59e8eb479`；实施分支 `codex/webgl-studio-2-2`。范围为用户确认的六方向全部 G1。附件作为产品规格使用，其中的示例指令不作为单独授权或新的执行层。Windows x64 发布与 EXE 验收按用户要求 Waived。

**状态：六方向 G1 软件链路通过；外部硬件与生产大模型验收 Blocked，Windows Waived。** 原生包构建、真实服务、契约及浏览器操作有实际记录。交付边界与未完成的必要外部验收列在文末。

## 环境与证据等级

Linux x64 / .NET SDK 10.0.402、runtime 10.0.13 Native AOT；Node 24.19.0；Python 3.12.14；Chromium 154.0.8037.57；隔离 MySQL 8.0.44 和从官方固定源码构建的 MinIO RELEASE.2025-09-07T16-13-09Z。数据库端口 13306，MinIO 19000，API 18080。配置、数据、日志和工具不提交 Git。

浏览器实际创建 WebGL 上下文，环境为 SwiftShader 软件渲染。其结果用于功能、解码和生命周期检查，不代表物理 GPU 性能。真实展厅与真实 IFC、合成汽车/管网、合成全景校准图及合成压缩纹理分别标注。

## 本轮功能与证据

| 方向 | 已实施的闭环 | 验证依据 |
|---|---|---|
| W1 Prefab | 层级建模、分类/缩略图、共享视口源预览、拖放定位、稳定子节点、字段与结构覆盖、Inspector Revert、单字段 Apply、三方冲突、选定实例原子传播、嵌套循环门禁、版本及引用删除检查 | `verify:studio22`、实际 IFC 层级创建/链接/修改/撤销的浏览器操作及 prefab.png |
| W2 项目漫游 | 多场景目录、2:1 全景、球面点/文本/图片/多边形热点、双向链接、缩略导航、地图摆点/北向/比例、自动导览及打断、皮肤、固定场景修订、原子项目发布、完整工程 ZIP | 原生项目发布、恢复固定版后修改草稿仍读取旧版、ZIP 往返；实际项目预览 20 轮 3D→全景→另一 3D→原场景、并发导航最后请求生效、注入加载失败恢复、路线暂停/继续/停止、匿名 Player 热点往返及 390px 布局 |
| W3 Storyboard | 多故事板、模板轨道、时间线拖动/裁剪/复制/拆分/成组/锁定/静音/折叠、相机/变换/透明/显隐/标注/内容/装配适配、路径点 Gizmo、Snapshot、Scratch、章节 Player | 500 次 0→10→2→30→0 浏览器 seek 后精确恢复；非线性拆分、相机租约、Scratch 放弃恢复、命令撤销重做 |
| W4 工业审阅 | IFC/GLB 双管线、GUID/修订、分类与类型单位、按来源分类映射、预检/派生数据、分页虚拟清单、筛选、离散/连续/缺失值颜色、保存视图、普通实体剖切体积、拾取测量 | 两来源 IFC 原生作业；真实 MySQL 分页、过滤、数值查询和映射失败原子性；实际 IFC 清单选择与剖切浏览器操作 |
| W5 Configurator | 产品档案、单/多选/开关/数值、规则级联与原因、视觉绑定、KHR 材质变体、SwapPart、异步顺序门禁、配置 UI、BOM/SKU 来源、目录修订与固定引用 | 有界求解/数值规则/BOM 契约，两个产品档案与实际运行切换；目录固定引用、脏目录发布拦截、删除门禁及 ZIP 闭包；真实 KHR 变体仅改变目标子树，恢复原材质，错误名称拒绝发布并保留旧指针；并发 SwapPart 共用单次准备并在退出时释放 |
| W6 优化 | 诊断、预设、无损 Meshopt、ETC1S KTX2、来源身份与节点矩阵门禁、持久队列/日志/取消/重试/缓存、原件及派生修订、同 Canvas 对照与统计 | 真实 Meshopt / toktx 4.4.2 进程、压缩头与浏览器实际压缩纹理解码；源 SHA 与身份、作业取消和原件删除保护；两个几何相同但变体不同的 Mesh 在压缩后分别保留绑定 |

`verify:studio22` 的 9 组契约/原生集成门禁通过，包括目录固定修订、完整资产闭包、版本冲突和并发部件资源所有权。`verify:extensions` 的 19 组门禁及 `verify:experience` 通过，包含 100 次装配往返、标注锚点与修订修复、管线 CSV、空间索引、命令输入所有权、动作取消和资源释放。`verify:contracts` 的 39 个既有 TS / 原生 API 夹具通过。`verify:browser` 验证 100 次保留 Canvas 的布局切换、快捷键/输入法/飞行、预览和响应式布局。`verify:model-revision` 已通过真实 GLTF 版本映射对话框及视口表面修复。`benchmark:studio` 在相同 1920×1080、DPR 1、SwiftShader 下执行四个合成规模，其中 2,000 标注/2,000 部件仍保持一个上下文；完整调度间隔、加载与资源数据保存在 `studio-2/benchmark.json`，不等同于 GPU 帧时或真实汽车性能。

## 真实输入

真实展厅重新按当前导入器归档：**80 节点、70 Mesh、57 作品绑定、144 个资产、0 缺失**。导入报告列出 4 项与实际主线设置有关的冲突；保留原 UUID。`verify:delivery` 通过公开展厅、汽车装配/管网合成样例、10 轮预览及 10 轮关闭/重开，无持续资源增长。

IFC 样本用于只读导入，原件及许可来源没有伪装为自有生产模型：

| 输入 | 来源与许可 | SHA-256 | 实际输出 |
|---|---|---|---|
| Building-Architecture.ifc | buildingSMART Certification-datasets，CC BY 4.0；[固定 blob](https://api.github.com/repos/buildingSMART/Certification-datasets/git/blobs/07f1b8014e74b950037f53a0547ded51b435953f)（API blob ID 07f1b8014e74b950037f53a0547ded51b435953f） | c4db65ba847f6b369a95d6c54fa11f4750cbe6d59f021934e8923d8d578e5885 | IFC2X3；19 个语义产品，14 个几何节点，几何转换失败 0 |
| IfcOpenShell basic.ifc | IfcOpenShell/Bonsai，LGPL-3.0；[固定 blob](https://api.github.com/repos/IfcOpenShell/IfcOpenShell/git/blobs/d613dcee468ad0d65407649e77218432bdbaf3cc) | e7a0b8dba92d708daf623741fa5b99b2db6da6e3cc744283b06cf78e1147dba0 | IFC4；8 个语义产品，3 个几何节点，几何转换失败 0 |

IFC 的单位、源坐标原点及 Z-up→Y-up 转换写入报告；模型与属性绑定同一派生模型摘要。没有几何的空间/分组仍可作为语义记录。它不支持参数化 CAD 回写。

## 故障与复现

```bash
npm ci
npm run schema:generate
npm run typecheck
npm run lint
npm run verify:extensions
npm run verify:experience
npm run build
bash scripts/services.sh up
bash scripts/package-linux.sh
bash scripts/start-linux.sh
# 另一终端，在同一源码目录中
npm run verify:contracts
npm run verify:studio22
STUDIO_FAULTS=1 npm run verify:integration
npm run dev
# Vite 启动后
npm run verify:model-revision
npm run verify:browser
npm run examples:industry
NODE_USE_ENV_PROXY=1 npm run import:showroom
npm run verify:delivery
```

`STUDIO_FAULTS=1` 只停止和恢复本任务的 MinIO 容器；与其他依赖 MinIO 的验收串行执行。已通过 JWT 边界、并发保存恰好一个 409、非法事务不改草稿、缺失依赖/MinIO 中断保留原指针、版本恢复、引用删除保护及取消发布。库和项目冲突不覆盖本地编辑。实际将正在转换 IFC 的 Native AOT 进程终止后，重新运行本轮原生包，作业恢复为 Succeeded，原项目发布指针保持不变（`restart22.json`）。

最终目录通过自己的 `run.sh` 启动，使用随包的隔离 Node 依赖、IfcOpenShell 和 toktx 实际完成 IFC、Meshopt/KTX2 及双 Mesh 变体保留检查（`bundle22.json`）。工程包重新导出为当前契约版本，包含真实展厅、多场景模板/目录及材质变体样例。

本轮结构化记录和截图位于交付包 `acceptance/studio-2.2/`，包括 `studio22.json`、`converters22.json`、`browser22.json`、`project-browser22.json`、`configurator22.json`、`restart22.json`、`bundle22.json` 和既有门禁记录。`studio22/` 保存六工作空间及 Player 截图，`studio-2/` 保存真实展厅、模型修订和生命周期记录。一次性浏览器操作作为验收执行，不增加前端测试框架或测试套件。

## Blocked / Waived 与局限

| 项目 | 状态 | 原因及复现/后续条件 |
|---|---|---|
| Windows Native AOT / EXE | Waived | 用户指定 Linux 验收，Windows 豁免 |
| 物理桌面 GPU、真实手机/平板和 VR 设备 | Blocked | 当前环境没有物理 GPU、移动设备或头显；提供相应设备后，用同一 ZIP、同一项目、同画质执行浏览器 UAT；`STUDIO_CHROMIUM=/path/to/browser npm run benchmark:studio` 可复现现有统计流程，不能将该合成脚本当作真实资产基准 |
| 5,000 / 20,000 可交互零件的授权生产汽车及数十万元素厂房 | Blocked | 本环境仅有小型公开 IFC、真实展厅和合成行业样例。需要许可明确的生产资料及目标设备，导入后按附件第 7 节记录相同设备/相机/画质下的冷/热缓存、CPU、GPU、内存和视觉差异 |
| 30 分钟生产大场景长会话 | Blocked | 缺少上述代表性生产资料及硬件。现有 20 次跨场景循环和 10 次真实展厅重开不能冒称此项通过；在提供资料和设备后持续运行 30 分钟并记录每次切换后的资源/监听器/上下文 |

AOT 发布保留 SqlSugar、Newtonsoft.Json 等依赖的裁剪/动态代码分析警告；未屏蔽。实际 MySQL 查询、事务、源生成 JSON、S3、库版本、项目发布、属性查询和作业均通过原生程序运行验证。Vite 对共享 Three.js/runtime 大块发出体积提示。没有据此宣称所有硬件、所有 IFC 表达或所有模型均无风险。

复杂行为图、多人权限、专业 CAD 回写、IoT、LOD/实例化/流式大模型等 G2/G3 不计入本轮 G1。
