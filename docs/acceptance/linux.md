# Linux v1 验收记录

验收日期：2026-10-15，结构化记录时间为 UTC。实施分支 `codex/webgl-studio-v1`。用户确认的基线为 `5a9fdd2870ceec4afe680a43d2563574b953f97d`，包含原始基线 `9942d737ce8efcca20ba6534cce721c87b1d3d01`。

Linux 功能门禁、最终 ZIP 和服务重启验收已完成；Windows x64 Native AOT / EXE 按用户要求 **Waived**。没有新增前端自动化测试套件。浏览器操作使用临时 Playwright 控制台，原因是当前环境未提供 Browser 插件。

## 环境与构建

| 项目 | 状态 | 实际环境 / 证据 |
|---|---|---|
| 前端 typecheck / lint / build | Pass | `npm run typecheck`、`npm run lint`、`npm run build`；打包时再执行相同门禁 |
| Linux Native AOT | Pass | .NET SDK 10.0.402 / runtime 10.0.13；Release、linux-x64、PublishAot=true；直接运行 ELF |
| MySQL | Pass | 隔离 MySQL 8.0.44，127.0.0.1:13306，独立数据目录 |
| MinIO | Pass | 官方源码 RELEASE.2025-09-07T16-13-09Z，锁定提交 `07c3a429bfed433e49018cb0f78a52145d4bedeb`；真实 S3 读写 |
| 现有引擎基准工具 | Pass | 调度去重、资源引用释放、帧率无关阻尼；迁移为唯一的资源对象入口 |
| 共享契约 | Pass | 15 项 TypeScript / 原生 API 一致性用例，包含未完成草稿与发布完整性检查 |
| 浏览器 | Pass | Chromium 154.0.8037.57、真实 WebGL / SwiftShader；桌面 1440×1000，窄屏 390×844 |
| Windows 发布及 EXE | Waived | 用户明确指定 Linux 环境验收，Windows 豁免 |

原生程序使用源生成 JSON DTO、关闭反射式 JSON、短生命周期 SqlSugarClient、MySqlConnector 和 AWSSDK.S3 v4 path-style。认证、查询、事务、版本和资源操作均通过原生进程访问真实持久化服务。

## 原文 12 项 UAT

| # | 项目 | 状态 | 操作与结果 |
|---|---|---|---|
| 1 | O2VR 导入后模型、变换、灯光贴图和作品绑定一致 | Pass | 实际展厅 80 节点、70 Mesh、57 作品绑定，144 个归档资产，缺失 0；UUID 可追溯，实际展厅与贴图已浏览器显示 |
| 2 | 场景树与视口选择同步 | Pass | 鼠标点击作品后，树和 Inspector 同步选择；隐藏、锁定生效；Shift 框选得到 16 个节点 |
| 3 | Gizmo 移动、旋转、缩放与 Inspector 同步 | Pass | 三种工具均实际鼠标拖动；拖动期间文档不提交，释放提交一次；撤销整次拖动，Escape 恢复原值 |
| 4 | 新增、复制、删除、重组及撤销重做 | Pass | 界面节点数 80→81，删除及撤销恢复；父节点修改、子树稳定 ID 和内部引用重映射通过域契约验证 |
| 5 | 材质修改不影响无关联对象 | Pass | 副本改为 ff0000，原作品保持 ffffff；材质 ID 分离，运行对象保持局部更新 |
| 6 | 导入 GLB，调整变换，保存后重新加载 | Pass | 真实 character.glb，70 个可编辑子节点、2 个 SkinnedMesh、7 个动画；位置 X=1234 保存刷新后仍为 [1234,0,0] |
| 7 | 热点、内容和行为立即生效 | Pass | 创建“欢迎参观 UAT”，配置 OpenInfo 和 DisplayMode 有序动作；点击显示配置标题及内容并切换 X-Ray |
| 8 | 巡航路径编辑与预览 | Pass | Inspector 修改首点，视口拖动路径点；一次撤销恢复；预览相机沿修改路线移动，停止恢复初始视点 |
| 9 | 碰撞范围编辑立即更新导航 | Pass | 前方包围盒将相机阻挡于 Z=-74；偏移 X 改为 6000 后可前进至 Z=-1870；运行对象 UUID 未变 |
| 10 | 保存、刷新、重新打开完整还原 | Pass | 真实云端保存及页面刷新，155 节点验收场景、GLB 层级、骨骼与配置恢复；历史恢复另验证 80/70/57 |
| 11 | 发布 Player 无编辑工具和辅助节点 | Pass | 匿名独立浏览器加载；Editor 元素 0、canvas 1、登录 token 为 null；依赖图不含 Editor、React、Zustand、Dockview、OrbitControls、Gizmo、O2VR 解码器 |
| 12 | 重复开关场景无持续泄漏 | Pass | 通过工程菜单实际打开/关闭 10 轮，各轮指标一致；见下表与 browser.json |

标题、材质、变换修改使用 ChangeSet 局部同步；标题修改时观察到运行根对象和材质 UUID 不变。没有用整场景重新加载代替属性更新。

## 业务专项

| 能力 | 状态 | 结果 |
|---|---|---|
| 背景音乐 | Pass | 实际 bgm.mp3，时长 59.036688 秒，播放时间递增，循环和音量生效；停止后暂停且 currentTime=0 |
| 语音 | Pass | 上传实际语音 WAV，时长 5.095 秒，非循环；播放时间递增。Player 中对应播放/停止控件由真实 media 事件更新 |
| Avatar | Pass | 第三人称按需加载真实角色，2 个骨骼网格，idle 动画运行；切换回第一人称并停止预览恢复文档状态 |
| 展示分层 / X-Ray | Pass | shell 分层透明度从 1 变为 0.18，停止预览恢复为 1 |
| 模型挂载及动画 | Pass | 7 个片段可选择，播放/暂停；动画目标改名后四元数仍变化；复制整模型后几何共享、材质和骨骼独立，保留 70 子节点 |
| 展区视点 | Pass | 入口、A、B、C、D 共 5 个视点完成飞行，实际坐标逐一等于配置坐标 |
| 全景配置与快照 | Pass | 配置观察点和 2048×1024 输出，实际导出 PNG；编辑网格、路线、Gizmo 等辅助节点未进入图像 |
| 工作台与窄屏 | Pass | 桌面五区 Dockview；390px 下五个面板均可切换，页面宽度保持 390，无横向溢出 |

原 `edit_info.voice` 不属于旧 main 实际启用的语音路径，源地址返回 HTTP 403，已列为未支持迁移字段；没有将该文件冒充为已迁移资源。语音能力用 FFmpeg flite 生成的真实 5.095 秒语音 WAV 验收。迁移报告保留 4 项实际设置冲突与全部未支持字段；57 张作品图片均已下载到 MinIO，正式展厅不存在缺失引用。

## 故障与持久化

| 场景 | 状态 | 结果 |
|---|---|---|
| 断网保存 | Pass | 浏览器实际断网；已提交事务留在 IndexedDB，显示云端保存失败；恢复网络后同名草稿保存到云端 |
| 版本冲突 | Pass | 另一真实请求先提交；本地保存返回 409，保留本地名称；另存后云端原稿仍为并发提交版本 |
| 未同步事务恢复 | Pass | 重新打开旧工程显示本地 revision 22 / 云端 23 的恢复提示，没有静默覆盖 |
| 缺失资源 / 无效文档 | Pass | 拒绝发布 / 保存；无效事务不推进 revision，不改变已有发布 |
| 发布中断 | Pass | 实际停止 MinIO 容器，发布失败；恢复 MinIO 后原发布指针仍有效 |
| MySQL 并发事务 | Pass | 两个相同 expectedRevision 的保存恰有一个成功、一个 409 |
| 不可变版本与恢复 | Pass | 界面恢复历史快照生成 revision 24，新草稿为 80 节点 / 70 Mesh / 57 绑定，原快照仍存在 |
| 工程 ZIP 导入导出 | Pass | 集成检查归档哈希一致；真实展厅另导出 21,387,339 字节工程 ZIP，含 document.json 与 144 个资产包 |
| 资源引用检查 | Pass | 已引用资源删除返回 409；集成测试的工程删除后引用释放 |
| 取消发布 | Pass | 公开 Manifest 和资源访问均撤销 |
| 服务重启与恢复 | Pass | API、MySQL、MinIO 全部停止并重启；发布版本 ID、Manifest SHA-256、草稿修订、工程数及实际作品图片 SHA-256 均保持一致，见 restart.json |

故障注入期间预期的浏览器控制台项仅为断网和 HTTP 409；正常操作的 Editor、Player JavaScript 错误及警告均为 0。

## 10 轮生命周期

全部 10 轮通过真实工程菜单打开、关闭同一真实展厅。数值在每轮一致：

| 指标 | 加载后 | 关闭后 |
|---|---:|---:|
| 场景实体实例 | 80 | 0 |
| 受管 GPU 资源 | 340 | 0 |
| renderer 纹理 | 27 | 0 |
| renderer 几何体 | 47 | 19 |
| 未完成异步任务 | 0 | 0 |
| 渲染上下文 | 1 | 1 |
| Runtime 固定监听/回调 | 4 | 4 |

关闭后 19 个几何体属于保留的编辑设备、网格与工具；数量没有增长。CDP 另统计 window=19、document=2、canvas=26 个事件监听器，10 轮保持一致。最终构建另经冷启动复查：唯一资源对象入口生效，受管资源仍为 340→0、纹理 27→0，未绘制过 Gizmo 的设备几何为 29→1，控制台错误 0。最终设备销毁会释放设备并主动丢失渲染上下文。窄屏面板切换也实际触发了设备销毁与重建。

## 证据与复现

交付包 `acceptance/` 包含 contracts.json、integration.json、browser.json、restart.json、report.json、player-dependencies.json、构建日志、engine-benchmark.log、桌面/窄屏截图及 panorama.png。Linux ZIP 已包含真实展厅工程包，压缩数据与文件 SHA-256 校验通过。源记录在忽略目录 `.local/acceptance/`，凭据与数据目录不进入交付 ZIP。

```bash
bash scripts/services.sh build
bash scripts/services.sh up
bash scripts/package-linux.sh
bash scripts/start-linux.sh
# 另一终端执行
node test/benchmark.js
npm run verify:contracts
STUDIO_FAULTS=1 npm run verify:integration
NODE_USE_ENV_PROXY=1 npm run import:showroom
```

本机 Editor：`http://127.0.0.1:18080/editor/`。管理员凭据位于权限 0600 的 `.local/config.json`。

- 正式迁移展厅：`/player/?scene=f6d4ee76d21b42b89b6376b4cd44c16f`。
- 含热点、语音和 GLB 动画的验收场景：`/player/?scene=a598c109ae40412c940ea110a982cbe7`。
- 可移植工程：`examples/showroom.studio.zip`，从工程菜单导入。

## 实际限制与保留事项

Native AOT 编译成功，第三方 SqlSugar 及传递依赖仍发出 IL2104 / IL3053 / IL3000 / IL3002 裁剪、动态代码或程序集路径警告；日志保留，已执行的查询、事务、JSON、MinIO 和发布路径通过真实原生程序验证，不能据此推断未使用的 ORM API 均兼容 AOT。Vite 保留 Three.js 主包超过 500kB 的体积提示。

浏览器使用软件 WebGL，验收证明功能和资源生命周期，不作为硬件 GPU 帧率基准。原语音地址 403 与未支持的旧配置字段见迁移说明。Windows 为 Waived。

自动审批拒绝清理早期测试导入工程，原因是未明确授权不可逆删除；该工程已保留。此可选清理不影响 Linux 功能验收和交付。
