param([ValidateSet('start','stop')][string]$Action='start',[string]$ConfigPath)
$ErrorActionPreference='Stop'
$repoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$binary=Join-Path $repoRoot '.tools\minio.exe'
$listener=Get-NetTCPConnection -State Listen -LocalPort 19000 -ErrorAction SilentlyContinue | Select-Object -First 1
if($Action -eq 'stop') {
    if(-not $listener){throw 'MinIO is not listening.'}
    $process=Get-Process -Id $listener.OwningProcess
    if($process.Path -ne $binary){throw 'MinIO process ownership mismatch.'}
    Stop-Process -Id $process.Id
    'MINIO=stopped'
    return
}
if($listener){throw 'MinIO port is already in use.'}
if(-not $ConfigPath){$ConfigPath=Join-Path $repoRoot '.local\config.json'}
$config=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$env:MINIO_ROOT_USER=$config.s3AccessKey
$env:MINIO_ROOT_PASSWORD=$config.s3SecretKey
$dataRoot=Join-Path $repoRoot '.local\data\minio'
$logRoot=Join-Path $repoRoot '.local\logs'
New-Item -ItemType Directory -Force -Path $dataRoot,$logRoot | Out-Null
$process=Start-Process -FilePath $binary -ArgumentList @('server',('"'+$dataRoot+'"'),'--address','127.0.0.1:19000','--console-address','127.0.0.1:19001') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'minio.stdout.log') -RedirectStandardError (Join-Path $logRoot 'minio.stderr.log')
"MINIO_PID=$($process.Id)"
