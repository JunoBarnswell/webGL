param([string]$ConfigPath,[int]$Port=18080)
$ErrorActionPreference = 'Stop'
if (-not $ConfigPath) { throw 'Pass -ConfigPath to a local config.json containing mysqlPassword, adminUser, adminPassword, jwtKey, s3AccessKey, s3SecretKey. Credentials are never bundled.' }
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$packageApi = Join-Path $PSScriptRoot 'api'
$repoApi = Join-Path $PSScriptRoot '..\artifacts\studio-windows\api'
$apiRoot = if (Test-Path (Join-Path $packageApi 'Studio.Api.exe')) { $packageApi } else { $repoApi }
$apiRoot = (Resolve-Path $apiRoot).Path
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw "Port $Port is already in use." }
$env:STUDIO_MYSQL = "Server=127.0.0.1;Port=3306;Database=webgl_studio;User ID=webgl_studio_app;Password=$($config.mysqlPassword);Allow User Variables=True;Maximum Pool Size=20"
$env:STUDIO_ADMIN_USER=$config.adminUser
$env:STUDIO_ADMIN_PASSWORD=$config.adminPassword
$env:STUDIO_JWT_KEY=$config.jwtKey
$env:STUDIO_S3_ENDPOINT='http://127.0.0.1:19000'
$env:STUDIO_S3_BUCKET='webgl-studio'
$env:STUDIO_S3_ACCESS_KEY=$config.s3AccessKey
$env:STUDIO_S3_SECRET_KEY=$config.s3SecretKey
$logRoot=Join-Path (Split-Path (Resolve-Path $ConfigPath).Path) 'logs'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$process=Start-Process -FilePath (Join-Path $apiRoot 'Studio.Api.exe') -ArgumentList @('--urls',"http://127.0.0.1:$Port",'--contentRoot',$apiRoot) -WorkingDirectory $apiRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot "api-$Port.stdout.log") -RedirectStandardError (Join-Path $logRoot "api-$Port.stderr.log")
"API_PID=$($process.Id)"
