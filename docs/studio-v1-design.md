# WebGL Studio v1 统一语义设计

分支 `codex/webgl-studio-v1` 起点为 `5a9fdd2870ceec4afe680a43d2563574b953f97d`，包含原基线 `9942d737ce8efcca20ba6534cce721c87b1d3d01`。Linux x64 Native AOT 为交付平台，Windows 验收豁免。按用户最新要求连续实现，最后集中编译、联调与验收。

## 代码所有权

- SceneDocument 是唯一业务事实；单位毫米、局部 TRS、稳定 ID。JSON Schema 同时定义组件、动作、属性和引用。选择、缓存、Three.js 对象和播放进度不得进入文档。草稿允许空动作列表及待绑定动画等未完成配置，发布校验才要求完整；前后端使用相同 Schema 和语义检查。
- EditorSession 是唯一写入入口；副本执行、校验、原子提交 ChangeSet。撤销重做走同一通知路径。Gizmo 临时改变对象，结束提交一次，取消恢复。复制子树重映射内部引用，删除处理依赖。
- SceneRuntime 直接执行组件和事件动作，Editor/Player 共用；拥有实例、导航、音频、巡航、动画。停止预览恢复文档状态。不存在旧业务 API 翻译层。
- Engine 仅拥有渲染设备、Scene、Camera、帧调度、性能和资源计数。卸载场景保留设备，最终 dispose 销毁设备及监听器。
- 资源按 owner 的去重资源集合计数。几何体、材质、纹理各自计数；材质释放不隐式释放纹理。缓存模板和实例分别持有引用，实例材质和纹理参数独立。骨骼实例使用 SkeletonUtils.clone。异步装配携带场景世代和实体任务代号，过期结果只能释放。
- glTF Model 声明源单位到毫米的倍率，ModelNode 按源 node index 绑定，文档位置为毫米。子节点只能在同一模型实例内重组，模型整体可以自由挂载。动画绑定原生节点。
- O2VR 仅存在于导入器。UUID、名称规则、材质、路线和展区坐标一次转换为显式组件；运行链路不再解析旧场景或 manifest。迁移以实际生效源码为准，edit_info 冲突和未支持项报告。

## 产品流程

登录 → 工程列表/新建/导入 → 五区工作台 → 本地事务与串行云保存 → 业务预览 → 发布检查 → 独立 Player。

中文深色 Dockview 工作台：左场景树、中视口、右 Inspector、下资源与交互/巡航。布局保存和重置，窄屏按面板切换。Schema 生成组件字段、引用选择、路线与视点数组。编辑时 Orbit/Gizmo 拥有视口输入，预览时运行导航接管；表单不触发导航或删除。

保存状态区分未保存、保存中、已保存、断连和冲突。IndexedDB 顺序记录提交文档及服务器 revision。409 暂停云写入并保留本地修改，支持重新读取云端或另存工程。本地恢复不得自动覆盖新云版本。发布前显示引用和缺失资产；失败保留上一有效发布。恢复历史版本递增草稿 revision。

## 持久化语义

- MySQL 管工程、整体草稿、revision、不可变版本、依赖和发布指针。CAS 与依赖替换在同一事务。
- 资产包保留相对路径，按排序文件名与内容计算 SHA-256。Pending → S3 PUT/HEAD 确认 → Ready。缺失资产可保存草稿，禁止发布。删除和引用更新通过资产行锁串行。
- 发布捕获 revision 和旧指针，验证依赖后写不可变 MinIO Manifest，再事务内重新核对 revision/指针并切换。失败不改变旧发布。
- Player 使用稳定场景 URL 及带版本 ID 的资源 URL。匿名请求每次从数据库检查发布状态。不保存临时签名 URL。
- IMemoryCache 仅缓存不可变版本、Manifest 和 Ready 元数据，有容量与 TTL；权限、草稿和发布指针不缓存。
- AOT API 使用 CreateSlimBuilder、JSON 源生成 DTO、显式 SqlSugar 实体与元数据保留。结构由版本化 SQL 管理。

## 集中验收

完成实现后执行前端 typecheck/lint/build、契约和真实 MySQL/MinIO 集成、Linux Native AOT publish 与原生进程、原文 12 项 UAT、业务专项与故障恢复。10 轮卸载观察资源、监听器、上下文。未实际完成项标 Blocked，记录原因及命令；Windows 标 Waived。
