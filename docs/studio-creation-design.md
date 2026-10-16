# Studio 当前 实施边界

基线：main f1e4863；开发分支 codex/studio-creation-experience。

## 已反思并确定的三条链路

1. 内容所有权：作品、热点和点击介绍原来分别保存文案。当前 以 ContentItem 为唯一业务资料，Artwork/Hotspot/动作持稳定引用；布局只绑定字段，不复制内容。
2. 运行所有权：旧 Player 的播放布尔值、业务面板和运行对象可相互脱节。当前 由 SceneRuntime 持播放会话状态，UI 通过 dispatch/getSnapshot/subscribe 直接消费；编辑预览与公开 Player 共用同一 UI 渲染模块。
3. 事务与资源：整份文档克隆、原图资源卡和首次 GPU 构建会争用主线程。命令使用结构共享和正反向变更；导入解析进 Worker；加载按阶段调度，取消不提交文档并释放任务拥有的资源。

## 实施清单

- 当前 JSON Schema、稳定内容/视点/巡航/UI ID、条件与动作。
- 可观察的业务会话、真实巡航暂停/继续、动作完成/取消、完整状态恢复。
- 共享 DOM/CSS Player UI、五个任务工作区、内容与导览创作、二维界面画布。
- Worker 解包/解析、共享资产请求、派生缩略图、GPU 预热与资源释放。
- Native AOT 契约、缩略图与资源任务接口，保留不可变历史。

## 数据与失败边界

沿用管理员认证、expectedRevision、MinIO 资产和 MySQL 事务。不考虑旧展厅迁移，不修改既有文档。冲突先报告，不猜测合并。发布前校验全部 UI/内容/业务引用。预览不写草稿；加载、执行、保存失败保留真实原因。

## 验收

typecheck/lint/build；工具与真实数据库/MinIO 契约集成检查；浏览器验证热点、三站录制、自由布局、三种尺寸、事件与完整预览；十轮场景开关；Windows Native AOT 发布并运行。性能使用同机、相同资产、相同缓存策略的前后追踪，基线保存在系统临时目录。

用户最新约束：只维护当前契约；演示通过原始 O2VR 素材重新导入。

## 当前实施补充

- 不持有 schemaVersion / formatVersion，不引入场景迁移包。数据库 SQL 结构脚本的流水号只管理数据库 DDL。
- SceneDocument 持业务与界面数据；RuntimeSnapshot 持单次播放会话；Zustand 持编辑工具与选择。普通增量不会触发 loadDocument；显式替换场景的命令同时替换运行实例。
- 正反向 Immer patches 作为撤销历史与窗口内事务；每个浏览器窗口使用独立 workspaceId。恢复时保留原 revision；云端保存与冲突另存成功后才解决对应恢复记录。
- AssetWorker 拥有 Worker 生命周期与取消；AssetCache 合并字节请求；AssetStore 拥有实例资源，场景运行层负责释放。后台动作通过会话/规则 AbortSignal 取消，排队任务不能在停止预览后重新运行。
- 设计画布与运行 UI 复用 ContentCard、UiLayoutView 和业务控件。断点属性同时控制布局覆盖和公共控件样式；默认模板直接可用，未完成图片/动作配置只允许保存草稿。
