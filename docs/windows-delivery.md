# Windows 启动与发布

当前运行目标为 Windows x64。API 是 .NET 10 Native AOT 可执行文件，Editor / Player 由同一进程提供静态资源。数据库和 MinIO 独立运行；发布包不包含凭据、数据库目录或对象存储数据。

## 本机已配置的服务

| 服务 | 本机地址 | 持久化位置 |
| --- | --- | --- |
| MariaDB 12.3，MySQL 协议 | 127.0.0.1:3306 / webgl_studio | 既有 MariaDB 服务的数据目录 |
| MinIO | 127.0.0.1:19000，控制台 19001 | .local/data/minio |
| Studio API、Editor、Player | http://127.0.0.1:18080 | MySQL + MinIO；日志 .local/logs |

MinIO 从官方源码 https://github.com/minio/minio 构建，锁定提交 `07c3a429bfed433e49018cb0f78a52145d4bedeb`，构建 Go 为 `go1.26.5 windows/amd64`。源码位于忽略目录 `.tools/minio-src`，二进制 `.tools/minio.exe`。其原生版本字符串为 DEVELOPMENT.GOGET；提交及二进制 SHA-256 另记在验收凭据中。遵循源码附带的 AGPLv3 许可。

```powershell
# MariaDB 既有 Windows 服务须先运行。
.\scripts\minio-local.ps1 -Action start -ConfigPath .local/config.json
.\scripts\start-local.ps1 -ConfigPath .local/config.json -Port 18080
```

启动脚本检查端口及进程所有权，后台隐藏启动并输出 PID。MinIO 已运行时无需再次启动。API 配置仅从本机 JSON 读取 mysqlPassword、adminUser、adminPassword、jwtKey、s3AccessKey、s3SecretKey。脚本连接本机 webgl_studio 库及 webgl_studio_app 账号；其他部署使用进程环境变量配置，不把密码写入源码或 ZIP。

API 支持 `STUDIO_MYSQL`、`STUDIO_ADMIN_USER`、`STUDIO_ADMIN_PASSWORD`、`STUDIO_JWT_KEY`、`STUDIO_S3_ENDPOINT`、`STUDIO_S3_BUCKET`、`STUDIO_S3_ACCESS_KEY`、`STUDIO_S3_SECRET_KEY`。读取草稿、权限与发布指针以数据库为准；缓存容量 32 MiB，资产元数据 10 分钟、不可变 Manifest 30 分钟。

## 编译与打包

需要 Node.js / npm、.NET 10 SDK 和 Windows Native AOT 的 MSVC C++ 工具链。本机已实际完成原生编译。

```powershell
npm ci
npm run typecheck
npm run lint
npm run build
.\scripts\package-windows.ps1 -SkipFrontend
```

脚本执行以下原生发布并收集静态资源、启动脚本、说明和校验摘要：

```powershell
dotnet publish server/Studio.Api/Studio.Api.csproj -c Release -r win-x64 -p:PublishAot=true --nologo --verbosity:minimal
```

产物为 `artifacts/studio-windows/api/Studio.Api.exe` 与 `artifacts/webgl-studio-windows.zip`。完整日志写入系统临时目录 `webgl-studio-build`。打包前停止占用目标 exe 的本任务 API 进程；不要停止未经确认的其他服务。PDB 不进入 ZIP。

解压后使用包内 `start-local.ps1 -ConfigPath <本机配置文件> -Port 18080`。MySQL 协议服务和 MinIO 须按相同地址运行，数据不随 API 重启丢失。`/api/health` 会实际查询数据库；真实 MinIO 读写由集成检查证明，不能以健康接口替代。

## 原始素材导入与验证

不迁移既有展厅文档。`npx tsx scripts/prepare-showroom.mts` 将原始 O2VR 素材与作品图片打成 `.local/import/showroom-source.zip`，在 Editor 资源库导入，形成当前契约的新工程。已有旧工程保持原样；运行层不做自动兼容转换。

```powershell
npm run verify:experience
npm run verify:contracts
npm run verify:integration
# 仅在允许短暂停止本任务 MinIO 的本机验收窗口运行：
$env:STUDIO_FAULTS='1'
npm run verify:integration
Remove-Item Env:STUDIO_FAULTS
```

这些脚本读取 `.local/config.json`，连接真实数据库与 MinIO。故障注入会验证 MinIO 不可用时旧发布仍有效，随后重启本任务 MinIO。浏览器验收覆盖创作、预览、独立 Player、断网恢复和双窗口 409；详见 [验收记录](acceptance/windows.md)。
