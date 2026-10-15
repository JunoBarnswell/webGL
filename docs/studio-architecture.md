# WebGL Studio v1：统一链路与实施边界

基线：GitHub main `9942d737ce8efcca20ba6534cce721c87b1d3d01`。用户批准 Windows Native AOT、SqlSugar、MySQL 8、MinIO、内存缓存、单管理员、本机真实联调；不生成概念效果图。按后续指令，先完成连贯实现，再集中编译验证。

## 三轮架构推演

1. **业务所有权**：SceneDocument 是唯一业务状态。组件 Schema 同时定义校验、Inspector 字段和资源/实体引用。编辑命令只修改文档；Three.js 对象、运行动画、导航和选择均不是持久化源。旧 SceneParser、构造函数内展区/巡航和 UUID 业务绑定退出运行入口；O2VR 仅由导入工具转换。
2. **运行所有权**：文档运行层直接实例化标准组件，不调用旧业务接口翻译语义。Engine 仅负责渲染设备、帧调度、资源任务与释放。变化按实体/组件同步；异步任务带场景世代号，取消或关闭后不能复活对象。编辑和播放使用同一运行层；停止预览从文档恢复运行状态。资产缓存持有自己的资源引用；实例持有自己的引用；材质覆盖不修改共享模板。
3. **持久化所有权**：MySQL 管草稿 revision、不可变版本、资产索引和发布指针，MinIO 管文件。上传 Pending→对象确认→Ready；发布先写不可变 manifest 再提交发布指针。冲突/缺失/断连返回真实错误。内存缓存只缓存不可变内容，清空缓存不丢数据、不改变权限。前端串行自动保存；IndexedDB 记录提交后的本地文档和服务器 revision。

## 产品交互

中文深色五区工作台：场景树、视口、属性、资源、交互/巡航。面板支持停靠、缩放和布局恢复。选取、框选、锁定、重组、Gizmo 和 Inspector 走同一命令系统。预览暂时接管输入；表单聚焦不触发导航快捷键。资源操作和云端操作显示进行中、失败、冲突和重试入口。

组件覆盖 Mesh、Model、ModelNode、Hotspot、Artwork、Collider、Ground、Trigger、DisplayLayer、Light、Audio、Avatar、Cruise、Zone、Panorama、Animation。事件/条件/动作采用注册的有序规则，首版不实现通用脚本图。

## 契约与数据

- SceneDocument v1：毫米、稳定实体 ID、局部 TRS、显式组件、材质、资产引用、环境/导航设置和行为。
- GLB/glTF 为模型资产包；Model 实例一次加载，ModelNode 使用 glTF node index 绑定，不用节点名称推断。资源文件关系保留相对路径。
- O2VR 原始 80 节点、70 网格、57 作品绑定必须可追溯；内置路线等迁移数据固化为组件。原始素材保留作为导入源。
- 草稿保存携带 expectedRevision；冲突 409，禁止最后写入覆盖。恢复历史版本生成新草稿，不修改原版本。
- 资源被草稿或版本引用时拒绝删除。匿名访问只能读取当前发布的版本及其依赖。

## 实施与验收清单

1. Schema、组件注册表、命令与局部变更契约。
2. AOT API、版本化 SQL、MinIO 对象存储、JWT、持久化和发布事务。
3. Engine 和 SceneRuntime 统一替代旧运行路径。
4. Editor、Player、完整业务属性和工程导入导出。
5. 本机服务、真实展厅导入、集中 typecheck/lint/build/AOT publish、真实 API 与浏览器验收。

不使用 Mock 或演示数据替代资源；不新增前端测试套件。后端、导入与发布工具按行为验证。验收证据区分已完成、失败和 Blocked。日志、服务数据和凭据放在 Git 忽略目录或临时目录；交付不包含凭据和数据库数据。
