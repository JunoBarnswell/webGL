# WebGL Studio 2.2 · Linux x64

原生 API 使用 .NET 10 Native AOT。Editor、Player 在同一服务提供静态文件；MySQL 8、MinIO 为独立持久化服务。Windows 发布及 `.exe` 验收按用户要求豁免。

源码目录需要 Node.js 24、npm、Docker、Bash、curl、zip/unzip；SDK、Go、clang 由锁定的构建镜像提供。

源码目录启动：

```bash
npm ci
bash scripts/services.sh build
bash scripts/services.sh up
bash scripts/package-linux.sh
bash scripts/start-linux.sh
```

配置在 `.local/config.json`、`.local/config.env`、`.local/config.sh`，权限 0600，均不提交。管理员凭据从本地配置读取。地址 `http://127.0.0.1:18080/editor/`；MinIO Endpoint `http://127.0.0.1:19000`，MySQL 端口 13306。数据、缓存、暂存及日志在忽略的 `.local/`。

归档真实展厅（外部下载需允许代理，Node 24 使用环境代理）：

```bash
NODE_USE_ENV_PROXY=1 npm run import:showroom
npm run verify:contracts
STUDIO_FAULTS=1 npm run verify:integration
```

`STUDIO_FAULTS=1` 会停止并恢复本任务的 MinIO 容器，验证发布失败仍保留旧指针。

迁移报告 `.local/import/report.json`，缺失资源明确保留并阻止发布。Editor 导出的完整工程包包含文档及全部资产，重新导入保持内容摘要。

交付包解压后，注入以下环境变量，再运行 `bash run.sh`：

- `STUDIO_MYSQL`：MySqlConnector 连接字符串，数据库需预先创建。
- `STUDIO_S3_ENDPOINT`、`STUDIO_S3_ACCESS_KEY`、`STUDIO_S3_SECRET_KEY`、`STUDIO_S3_BUCKET`。
- `STUDIO_ADMIN_USER`（默认 admin）、`STUDIO_ADMIN_PASSWORD`（至少 12 字符）、`STUDIO_JWT_KEY`（至少 32 字节）。
- 可选 `STUDIO_URLS`（默认 `http://127.0.0.1:18080`）。

发布包不包含凭据、MySQL 数据目录或 MinIO 数据目录。Linux 需 glibc 2.39 或更新版本及 OpenSSL；Ubuntu 24.04 / Debian 13 可用。反向代理可提供 TLS，Editor/Player/API 维持同源。

`STUDIO-2.2-ACCEPTANCE.md` 是本轮验收记录；`ACCEPTANCE.md` 保留 v1 的历史记录。Blocked 不等于通过，Windows Waived 不影响 Linux 门禁。持久化服务重启后从数据库和对象存储恢复；内存缓存不是事实来源。

交付目录的 `acceptance/` 保存契约、集成、浏览器和生命周期数据及截图。`examples/showroom.studio.zip`（也单独提供）为已归档真实展厅的可移植工程包，可在工程菜单中导入；它包含 57 张作品图片，导入时无需再次访问原图片服务。`examples/` 另含多场景/全景/预制体/目录固定版工程、真实材质变体工程和合成装配/管网样例。

在解压目录执行 `sha256sum -c SHA256SUMS` 可核对全部交付文件。原始迁移输入仍在源码 `public/`；运行 Player 使用数据库和 MinIO 中已归档的版本资源。


## Studio 2.2 文档与处理工具

工作空间选择器打开预制体、项目漫游、故事板、工业审阅、配置器和资产优化设计器。项目编排拥有独立历史、IndexedDB 恢复与 CAS 修订；保存工程同时保存当前场景和活动的项目编排。SceneDocument 仍是场景的唯一事实来源，模板实例固定源版本，公开 Player 消费展开后的场景。`?scene=<id>` 为单场景发布，`?project=<id>` 为跨场景的原子发布。

启动时自动执行版本化 SQL 迁移。部署前备份现有 MySQL / MinIO 数据；迁移不重置工程或不可变历史。新 API 端点包括 `/api/library`、`/api/projects/{id}/scenes`、项目发布历史、分页属性索引和持久化处理作业。所有管理端点共用现有 JWT 边界。

资产处理需要 Node >=22.18（本机 24.19）和独立的转换工具。`workers/package-lock.json` 固定 Node 依赖；发布脚本将其安装到交付包。已安装在 `.local/tools` 的固定版 KTX-Software / IfcOpenShell 会连同许可文件复制到 `tools/`，`run.sh` 自动选择这些路径。IFC 工具包含 CPython 3.12 的 Linux 扩展，本机包需要 Python 3.12；可通过 `STUDIO_IFC_PYTHON`、`STUDIO_IFC_MODULES` 替换独立 Python 环境。转换器不链接进 Native AOT 或浏览器。工具源码、许可证和替换方式见 `CONVERTERS.md`。

源代码环境可在独立目录安装 IFC 依赖：`python3 -m pip install --target .local/tools/ifc -r workers/requirements-ifc.txt`。KTX-Software 使用 4.4.2 官方 Linux x86_64 发布包，保留完整发布目录及 NOTICE。`scripts/configure-converters.py` 只发现已安装工具，不下载或执行工程中的程序。未安装必需工具时作业明确 Failed，原始资产和已发布版本不受影响。

`npm run verify:studio22` 覆盖模板三方合并、视觉态、时间求值、约束规则、真实属性索引、项目版本固定、完整工程包和 Meshopt 作业；先启动原生 API。原有门禁仍可运行。当前原生构建保留 SqlSugar 等依赖的 AOT / 裁剪警告，运行证据和未完成的外部硬件验收分别记录，不将软件渲染数据称为硬件 GPU 性能。
