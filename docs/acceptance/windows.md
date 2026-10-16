# Windows 实际验收记录

日期：2026-10-16，本机真实环境。功能和原生服务链路已完成；性能呈现耗时与全局 DOM 监听器统计仍有下述 Blocked 项，不能据此宣称所有量化门槛通过。

## 基线与交付边界

- 起点 main / origin/main 均为 `f1e4863`，开发分支 `codex/studio-creation-experience`。未提交或推送本轮修改。
- 当前只有一套 SceneDocument、Player UI、运行会话和编辑命令语义；不包含既有展厅文档迁移。
- 演示从原始 O2VR 素材重新导入，输入基线为 80 节点、70 Mesh、57 作品绑定。增加一个创作热点后，交付演示为 81 节点、70 Mesh、57 作品、58 内容记录。原有工程未转换或覆盖。
- 演示场景 `22376eac8f25446ab1899c70b77acd60`，最终草稿修订 28；发布后公共 Player 使用该不可变文档。完整工程导出为 `examples/showroom.studio.zip`。
- 本机 API 直接运行 `Studio.Api.exe`；MariaDB 12.3 / 3306、真实 MinIO / 19000。MinIO 源码提交与二进制摘要见 `acceptance/environment.json`。

## 本轮方案的八项验收

| 项目 | 结果 | 实际证据 |
| --- | --- | --- |
| 热点与三站巡航创作 | Pass | 点击表面创建热点并编辑共享文案；三次记录视角，默认停留 3 秒。`editor-workbench-final.png` |
| 自定义菜单、内容布局和断点 | Pass | 新增参观说明菜单；修改内容版式、字体、颜色、装饰线；保存、重开、发布。桌面/平板/手机均可打开及关闭。`interface-designer-final.png`、`player-*-final.png` |
| 预览与 Player 共用业务 | Pass | 同文档的内容、巡航、展区、音频、第三人称 Avatar、X-Ray、全景均执行真实动作。停止预览后恢复编辑状态，修订保持不变。 |
| 规则语义与取消 | Pass | 浏览器验证重复忽略、延时取消、音频取消、布尔条件、设置变量、If 分支；Fox 动画自然完成后才隐藏对象。命令工具另验证重启/排队取消、缺失目标、循环触发。 |
| 展厅与业务回归 | Pass | 70 Mesh、57 作品保留，材质与烘焙光照可见；音频、Avatar、人称切换、展示分层、动画、展区、全景进入通过。实际全景 PNG 为 2048×1024。 |
| 加载性能量化门槛 | Blocked（部分指标已测） | 最终加载期间三次任务切换在 assets/assets/gpu 阶段发生，输入处理等待最大 1.8ms；Long Tasks 共 8 个，最大 169ms，超过 50ms 的累计部分 220ms。呈现耗时最高 2440ms，且空闲对照仅 4 帧/4516ms，受内置浏览器帧调度限制，不能判定呈现 P95 ≤100ms。详见下文。 |
| 前端、契约与真实服务集成 | Pass | typecheck / lint / build 退出码均 0；26 个前后端契约样本一致；真实 MySQL / MinIO 的上传、冲突、恢复、发布及权限检查通过。 |
| 生命周期与 Windows Native AOT | Partial | Windows 原生发布、运行和端到端通过；十轮场景关闭后资源归零，单视口上下文稳定。统计到的运行层订阅稳定 6 个；浏览器全局 DOM 监听器统计接口不可用，单独标记 Blocked。 |

## 原始十二项 UAT

| UAT | 结果 | 操作与结果 |
| --- | --- | --- |
| 01 导入展厅、变换、光照、作品 | Pass | 浏览器选择原始 ZIP，Worker 导入；80/70/57，真实图片归档 MinIO。新增热点解释上述最终 81 节点。 |
| 02 场景树与视口选择 | Pass | 选择树节点同步轮廓和属性；视口选中用于热点绑定及变换。 |
| 03 Gizmo 与 Inspector | Pass | Fox 沿 X 移动至 174.278447mm，Z 旋转至 27.040298°，X 缩放至 0.01473838；属性同步，每次拖动单次撤销恢复。 |
| 04 新增、复制、删除、重组与历史 | Pass | 27 节点骨骼模型复制为 54；新增容器为 55；重组父节点撤销/重做；递归删除降至 27，撤销恢复 55，重做回到 27。 |
| 05 材质隔离 | Pass | 模型副本改独立蓝色材质，原模型保持橙白纹理。`model-material-isolation.png` |
| 06 GLB 导入、变换、保存重开 | Pass | Fox.glb 保留 27 节点与 Survey/Walk/Run；保存重开后三轴缩放均为 0.01；设置当前画面为初始视角。 |
| 07 热点与内容、行为 | Pass | 共享文案立即出现在热点、菜单与内容弹窗；规则试运行并显示实际执行步骤。 |
| 08 巡航路径与预览 | Pass | 三站缩略图、排序、停留；真实播放、暂停保留进度、继续、停止、重播；Player 使用同一条路线。 |
| 09 碰撞增量更新 | Pass | 真实 box 碰撞体挡住两站路线，检查提示穿墙；X 偏移改 5000 后提示消失，撤销后恢复；未重载场景。`collision-incremental.png` |
| 10 保存、刷新、重开 | Pass | 断网真实保存失败后保留 IndexedDB；恢复原 revision；双窗口 409 保留本地内容，另存副本后成功打开；无错误覆盖云端。 |
| 11 Player 不含编辑工具 | Pass | 独立 Player 无场景树、Gizmo、网格辅助或编辑命令依赖；必需关闭入口始终可用。 |
| 12 场景资源释放 | Partial | 十轮关闭 objects/resources/textures/pending=0，保留编辑网格 geometry=1、canvas/context=1。后五轮完整渲染后稳定 objects=81、resources=345、textures=62、geometries=27。core listeners=6；全局计数 Blocked，见下文。 |

## 故障与一致性

- 真实并发 expectedRevision 保存：一个 200、一个 409，后保存窗口保留内容。恢复时仍用本地原始 revision；不会伪装成当前云端 revision。
- IndexedDB 按窗口 workspaceId 隔离；另一个窗口保存不清除当前窗口的未同步事务；云端副本创建成功后才解决原恢复记录。两份冲突验收副本已清理。
- 导入取消：ZIP 解包/上传中取消，场景仍 0 节点、修订 0；提示未提交变更，未留下半成品文档。
- 加载取消：点击到 cancelled 的观测反馈 3.3ms；迟到异步回调不会改回加载中；重试成功。`cancel-final.json`。
- 缺失资源、未绑定 UI 图片/材质和未完成动作阻止发布，上一有效发布指针保留。
- 实际停止本任务 MinIO 后发布返回 503，旧发布指针保留，随后恢复 MinIO。`integration-faults.json`。最终 Native API 的普通集成回归另见 `integration.json`。
- 历史快照不可变，恢复形成新草稿修订；取消发布后公共 Manifest 和所属资源访问撤销；有引用资产删除返回 409。
- 服务重启检查见 `restart.json`；凭据、数据库和对象存储数据均不进入发布包。

## 性能方法与限制

改造前采集一次相同主展厅资产、禁用浏览器缓存的 Trace；改造后同条件采集候选 Trace。可比主线程 FunctionCall / FireAnimationFrame / TimerFire / EventDispatch / EvaluateScript / RunMicrotasks 非重叠片段的超过 50ms 部分为 2473.81ms → 8.28ms，最大片段 1190.78ms → 58.28ms。这是 Trace 片段指标，不能称为完整 TBT。该轮候选 Long Tasks API 另记录 101ms、58ms 两个任务。

最终构建另采集一轮加载：8 个 Long Tasks，累计超过 50ms 部分 220ms，三次实际点击的最大输入处理等待为 1.8ms。Event Timing 的呈现耗时为 352–2440ms；空闲对照 visibility=visible 下仅观察到 4 个 requestAnimationFrame / 4516ms。保留全部原始结果，不用较早的小样本替换最终结果。三个点击不足以提供普遍的 P95 保证，现有基线也缺少完整 Long Tasks observer，严格的呈现耗时与完整 TBT 门槛为 Blocked。

复现该限制：在同一内置浏览器打开 Editor，使用 DevTools 协议 `Network.setCacheDisabled({cacheDisabled:true})`，重载；注册 buffered Long Tasks 和 durationThreshold=16 的 Event Timing observer；在加载时实际点击热点内容、导览巡航、场景搭建，等待 ready 后读取并断开 observer。另以 requestAnimationFrame 在约 4.5 秒内计数作空闲对照。原始文件 `baseline-trace.json`、`candidate-trace.json`、`final-performance.json`，汇总 `performance-final-summary.json`。取消反馈独立记录，不推导未采样的输入结果。

全局 DOM 监听器统计复现命令：内置浏览器 CDP capability 调用 `send('Memory.getDOMCounters', {})`，返回 `This method is not supported through raw CDP.`。因此 `lifecycle.json` 中的 listeners 仅表示运行层自有订阅，不冒充浏览器全部监听器。需要可暴露该统计能力的浏览器才能补足全局计数。

## 命令与构建结果

```powershell
npm run typecheck
npm run lint
npm run build
npm run verify:experience
npm run verify:contracts
npm run verify:integration
$env:STUDIO_FAULTS='1'; npm run verify:integration; Remove-Item Env:STUDIO_FAULTS
dotnet publish server/Studio.Api/Studio.Api.csproj -c Release -r win-x64 -p:PublishAot=true --nologo --verbosity:minimal
.\scripts\start-local.ps1 -ConfigPath .local/config.json -Port 18080
```

上述适用命令均实际执行；门禁摘要在 `frontend-gates.json`、`contracts.json`、`integration*.json`。不新增或执行前端自动化测试套件；verify:experience 是业务调度及命令契约工具。日志保存在本机系统临时目录，发布包不包含敏感日志。

Native AOT 编译成功并直接运行生成的 exe 完成 JSON、JWT、MySQL 查询/事务、MinIO 字节校验与端到端验收。SqlSugar、Microsoft.IdentityModel.Tokens、System.Linq.Expressions 等依赖仍产生 IL2104、IL3053、IL3000 等裁剪/AOT 警告；本次已执行路径通过，不将其描述为全依赖零警告。构建保留显式实体和元数据配置，后续扩展 ORM 路径仍须做原生验证。
