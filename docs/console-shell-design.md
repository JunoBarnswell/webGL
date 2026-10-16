# 控制台窗口系统实施边界

基线：`ab5502c3f96f24eee226a52c97787fbed2ae42ad`，2026-10-16。本轮只调整 Editor Shell，复用现有全部业务设计器与命令。业务文档格式、服务端、发布与 Player 的契约不变。

## 三次设计复核

1. **功能归属**：工作空间是旧容器选择，不能继续决定业务可达性。SceneTree、ContentPanel、TourPanel、Interactions、InterfaceCanvas、Inspector、Resources 与生成注册表中的每个 ExtensionPanel 都独立登记为窗口；旧命令 ID 保留，统一打开同一窗口。新增窗口只用于现有数据的项目、版本、诊断与作业入口，不复制专业设计器。
2. **生命周期**：布局与场景没有加载关系。采用公开的 `dockview` 包及其 Core API 处理停靠和浮动，React portal 的宿主元素按稳定窗口 ID 创建。Viewport portal 始终存在，窗口重排和恢复布局只移动宿主 DOM。关闭工具窗口释放其组件；视口不能关闭或移出主区域；预览仅最大化现有视口，停止后恢复布局。不会创建第二个 Runtime、Engine、Renderer 或场景副本。
3. **焦点与事务**：扩展命令注册一次，快捷键使用当前聚焦窗口作用域；二维画布只在自己的 DOM 中处理按键。多个 Library Document 同时打开时，历史/保存路由按窗口激活已有 DocumentSession 引用，不按最后挂载者覆盖。窗口配置只持有可序列化 UI 数据，业务对象仍由原 Session 持有。

## 实施清单

- 从基线源码生成完整入口清单，记录旧入口、目标窗口、源码位置与验收项，清单的代码映射和实际 UAT 结果分别记录。
- 建立唯一 ConsoleWindowRegistry、ConsoleLayoutStore、DockHost；停靠、分割、标签、浮动、自动隐藏、布局导入导出与七个预设统一处理。
- 用原 CommandRegistry 驱动菜单、工具栏、窗口入口、搜索、最近命令和自定义工具组。保留原键位、输入与 IME 门禁，提供 F6 窗口巡回。
- App 保留认证、工程导入导出、发布、冲突、本地恢复等原流程；将入口注册成命令，删除旧工作空间容器与手动拖宽链路。
- 保留全部基础面板、十个扩展的工具和所有专业面板；UI 设计器仍使用原画布与原 Inspector。
- 在新壳完成后一次执行 typecheck、lint、build、受影响契约/工具检查与浏览器操作。没有运行的专业业务验收标记 Blocked，不以功能名存在代替通过。

## 状态、事务和权限

- ConsoleLayoutStore：序列化 dock tree、预设、聚焦窗口、自动隐藏、浮动坐标、自定义工具组和私人布局。设备偏好仍由原 Preferences 管理；一次读取原布局偏好，保留原 key 和快捷键。
- 窗口的未保存标记仅投影原 Session 的状态，不持久化到布局文件。Library Document 缓存保留原 Session、修订和脏状态，关闭重开不能把未保存内容显示成已保存。
- StudioState / EditorSession / DocumentSession：继续持有现有场景、选择、业务命令、撤销、保存、草稿与发布；布局操作不提交文档事务，不自动保存。
- 所有原 API、鉴权、expectedRevision 与发布检查不变。损坏布局明确提示并恢复默认；不修改任何场景文档、版本或资源。

## 验收与恢复

- 每个原入口在清单中有目标窗口；所有窗口可从 Window 菜单或命令搜索找到。
- 窗口停靠、浮动、关闭重开、预设切换与预览前后，Canvas/Runtime 身份、选中实体、镜头与文档摘要保持稳定。
- 保存和版本、热点/导览/交互/UI 画布、全部专业扩展保留真实组件；快捷键只作用于聚焦上下文。
- 支持 390px 窄屏与桌面布局；损坏或离屏布局可通过恢复展厅布局处理。布局导入严格校验窗口 ID 和数据结构，不接受业务文档。
- Dock tree 根节点始终使用 branch；窄屏把窗口收为同组标签，回到桌面时合并期间新增/关闭的窗口并复用现有组件。展厅默认不打开底部工具，以保留主要视口。
- 隐藏视口宿主固定在工作台起点，外壳裁切溢出；长表单聚焦不会滚动整个控制台。真正的模态框统一限制 Tab 焦点，浮动工具窗口继续使用普通窗口焦点。
- 标注、装配和管网窗口直接呈现原扩展注册表的创建命令，空场景仍有可操作入口；不复制创建逻辑。
- 前端验证只使用静态门禁与真实浏览器操作；移除原工作空间驱动的三个浏览器测试脚本及其 CI 入口。核心契约、工具与后端集成检查继续保留。
- 回滚代码使用本分支的 Git 差异；浏览器恢复使用“窗口 → 恢复展厅布局”。旧偏好不删除，业务存储没有迁移。

技术依据：[Dockview 渲染生命周期](https://dockview.dev/docs/core/panels/rendering/)、[Dockview 布局 API](https://dockview.dev/docs/api/dockview/overview/)、[Visual Studio 窗口布局](https://learn.microsoft.com/en-us/visualstudio/ide/customizing-window-layouts-in-visual-studio?view=visualstudio)。依赖锁定 `dockview@8.5.1`。
