# Studio 2.3 Linux 验收

本轮从 main `457eda90cba9b377216d17d6146835e00e8d6365` 开始，覆盖 S0–S6。验收日期为 2026-10-16；交付目录 `SOURCE.json` 标明实际打包提交、树、原生程序摘要和契约 Hash。Linux 是交付目标，Windows 按用户要求豁免。原文是研究及范围输入，实际代码、失败复现和运行结果是判断依据。

S0–S5 分别完成审计、共享契约、作者工作台、工业语义、配置器和资产处理链路；S6 收敛规模验收及交付证据。没有增加另一套文档、运行时、渲染 Canvas 或格式兼容桥。原始资产和历史发布保留，模板、项目、目录、场景编辑继续经过共享事务内核。

## 实际门禁与结果

| 范围 | 实际结果 | 证据 / 复现 |
|---|---|---|
| Native AOT、JSON、MySQL、MinIO | Pass：原生 Linux 程序直接运行；39 组跨语言契约、既有 9 组集成及 2.3 readiness/reference 套件通过 | `npm run verify:contracts`、`verify:studio22`、`verify:studio23`；`s5-aot.log` |
| 工业 / IFC | Pass：IFC2x3、IFC4、拥有来源的 IFC4x3；24 实例共享一份网格，一/四线程 GLB 一致；坐标、法线、GUID、空值、单位、端口及错误记录核对 | `npm run verify:ifc`；`ifc/results.json`，保留原输入许可与摘要 |
| 语义规模 | Pass：真实 MySQL 10 万条并发幂等索引、搜索、分页、严格单位映射与非法数字负例 | `semantic100k.json`；索引约 7.15 s，末页查询约 642 ms；是本机观测，不是统一性能保证 |
| 模板 | Pass：删除/重命名影响分析、显式保留/重定向、嵌套 Apply、撤销重做；浏览器 Worker 1000 实例规划和取消 | `s6-studio23.log`、`browser/results.json`；计划约 1.29 s |
| 项目图 | Pass：100 节点 / 300 边实际浏览器拖动、保存、撤销保存及自动布局；楼层 1000 次坐标往返核对 | `graph-browser.json`、`s6-studio23.log` |
| 故事板 | Pass：真实浏览器 Runtime 100 轨×100 片段，500 seek、100 倒序求值、50 loop；50 Scratch 恢复，文档不变 | `browser/results.json`；CPU seek P95 0.5 ms，纯采样 P95 0.3 ms |
| 配置器 | Pass：1000 seeded random + 两两/三元/边界报告；三个 primitive 中两者分别蓝/绿，第三者保持红色；宽高分别为 [2,3,1]；旧异步部件取消不覆盖已提交状态 | `configuration-coverage.json`、`browser/results.json`；同优先级、缺失变体、全局变体作用域及重复轴冲突均阻止发布预检 |
| 资源预算 / 质量 | Pass：UI 参数、规范化 Hash、源/派生报告、场景固定报告、权威账本准入；不可达无损预算返回 UnmetBudget | `npm run verify:processing`；`processing.json`。GPU 字节为保守 RGBA8+mip 估算，不是实测显存 |
| 多实例故障 | Pass：两个原生 API，当前 owner kill -9、另一实例租约接管；旧 owner SIGSTOP 至过期后 SIGCONT，不能覆盖结果；每作业只提交一组 model/semantic 输出 | `npm run verify:leases`；`leases/results.json`，15 秒 DB 租约 / 2 秒心跳 / epoch fencing |
| 真实业务 / 解码 | Pass：六工作空间创建、实际 IFC 清单及剖切、配置器、骨骼来源模型及真实 Meshopt/KTX2 解码；随包 IFC/toktx/Node Worker 实际执行 | `s6-workspaces-browser.log`、`s6-model-revision.log`、`s6-bundle-converters.log` |
| 导览 / 独立 Player | Pass：20 轮 3D/全景/3D，固定版本、快速切换取消、失败回退、路线暂停停止、匿名及响应式 Player | `s6-project-browser.log`；软件浏览器手机视口不等于真实手机 |
| 断网 / 并发 / 发布 | Pass：断网编辑保留、联网保存、409 保留本地、IndexedDB 刷新恢复；缺失资源、MinIO 中断保持旧发布；历史恢复、工程导入导出及取消发布 | `s6-offline.log`、`s6-integration-faults.log` |
| 生命周期 | Pass：真实展厅 80 节点 / 70 Mesh / 57 绑定；10 预览 + 10 关闭重开。前后均 80 对象、345 资源、62 纹理、34 几何、1 上下文、6 监听器；关闭时对象/资源/pending 均 0 | `s6-showroom-delivery.log`、`showroom-lifecycle.json`；生产静态浏览器另完成 100 次保留 Canvas 循环 |

浏览器为 Chromium 154 / SwiftShader，Linux x64，5 个可见逻辑 CPU，CPU 型号 AMD EPYC 9V74。上述 seek 是浏览器 CPU 求值及运行对象更新耗时；不包含等价的实体 GPU 帧时承诺。小型公开 IFC 与合成资料的计时不能外推至授权汽车或工厂生产模型。原始 12 项 UAT 的历史记录保留在 `ACCEPTANCE.md`；本轮补充上述明确列出的回归，不把未重跑项目重新标成新运行结果。

有限规则覆盖报告保留未覆盖数量、预算截断及目录快照。两两/三元覆盖不是全局可满足性证明。默认 primitive 准入和配置组合采样也不等于穷举全部模型/部件组合。

S6 验收还修正了统一语义问题：模式切换等待既有文档同步队列，避免新轨道尚未挂载就开始预览；数值组的旧选项绑定/defaults 在 Schema、TS 与 Native 一致休眠，重新激活后再验证引用；样例目录复用同一所有权检查，避免自动让两个目录控制同一模型。

## Blocked / Waived

| 必要验收 | 状态 | 原因与复测条件 |
|---|---|---|
| Windows x64 AOT / EXE | Waived | 用户明确采用 Linux 验收 |
| 实体桌面 GPU、真实手机 / 平板和 VR | Blocked | 环境无物理 GPU、移动设备和头显。提供目标设备后加载同一 ZIP 和项目，登记型号、驱动、浏览器、画质、CPU/GPU timer 与显存；不以 RAF 代替 GPU timer |
| 授权生产汽车 5000/20000 可交互零件、数十万元素工厂 | Blocked | 未提供许可明确的代表性生产资料；导入后重跑身份/差分、交互和设备预算，登记原始摘要及授权来源 |
| 10/30 分钟生产长会话和增长斜率 | Blocked | 缺少上述设备与生产资料。提供后持续运行同一场景 30 分钟，记录冷/热加载、P50/P95 帧时、每轮切换后的资源/监听器/上下文及内存斜率 |

复测入口：先按 `README.md` 启动包，`STUDIO_CHROMIUM=/path/to/physical/browser npm run verify:browser` 验证通用交互；`npm run benchmark:studio` 只提供现有合成统计入口，不能自动满足生产长会话门禁。一次性浏览器操作脚本保留于 `acceptance/studio-2.3/reproduce/`，需同一源码、Vite 和本地隔离配置，先将记录脚本拷贝回源码 `.local/`，再运行 `node --import tsx .local/<脚本名>`；浏览器记录中的 Vite `/@fs/workspace/webGL` 地址对应本轮源码位置，换目录时需要调整。图和性能原始记录位于同目录；缺少设备或资料时继续保持 Blocked。

G2 实例化 / LOD 与 G3 流式加载本轮交付准入研究，未声称实现自动转换或运行时切换，见 `ASSET-PIPELINE.md`。Native AOT 保留 SqlSugar / Newtonsoft.Json 等依赖分析警告；实际查询、事务和处理路径通过原生运行核验。Vite 的大块提示保留。没有隐藏这些局限或重置用户数据。

浮点边界复现：输入 `0.49999999999999994`、步长 1 时，JS 结果为 0；发布端原先先加 0.5 会因 IEEE 舍入得到 1，进而错误拒绝后续透明度绑定。原生离散索引改为比较 floor 的余数，避免中点前驱被抬高；跨语言套件同时覆盖该前驱和精确中点 0.5。复现及修正后报告为 `numeric-rounding-before.json` / `numeric-rounding-after.json`，不通过容差或兼容分支掩盖差异。
