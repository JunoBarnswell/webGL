> 历史 Linux 交付记录；当前 Windows 说明与实际结果见 windows-delivery.md 和 acceptance/windows.md。

# WebGL Studio v1 · Linux x64

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

`ACCEPTANCE.md` 是实际验收记录。Blocked 不等于通过，Windows Waived 不影响 Linux 门禁。持久化服务重启后从数据库和对象存储恢复；内存缓存不是事实来源。

交付目录的 `acceptance/` 保存契约、集成、浏览器和生命周期数据及截图。`examples/showroom.studio.zip`（也单独提供）为已归档真实展厅的可移植工程包，可在工程菜单中导入；它包含 57 张作品图片，导入时无需再次访问原图片服务。

在解压目录执行 `sha256sum -c SHA256SUMS` 可核对全部交付文件。原始迁移输入仍在源码 `public/`；运行 Player 使用数据库和 MinIO 中已归档的版本资源。
