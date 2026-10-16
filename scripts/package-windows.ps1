param([switch]$SkipFrontend)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outputRoot = Join-Path $repoRoot 'artifacts\studio-windows'
$publishRoot = Join-Path $outputRoot 'api'
$logRoot = Join-Path $env:TEMP 'webgl-studio-build'
New-Item -ItemType Directory -Force -Path $logRoot,$publishRoot | Out-Null
Push-Location $repoRoot
try {
    if (-not $SkipFrontend) {
        & npm.cmd run --silent build *> (Join-Path $logRoot 'frontend.log')
        if ($LASTEXITCODE -ne 0) { throw "Frontend build failed; log: $logRoot\frontend.log" }
    }
    & dotnet publish server/Studio.Api/Studio.Api.csproj -c Release -r win-x64 -p:PublishAot=true --nologo --verbosity:minimal -o $publishRoot *> (Join-Path $logRoot 'native-aot.log')
    if ($LASTEXITCODE -ne 0) { throw "Native AOT publish failed; log: $logRoot\native-aot.log" }
    Get-ChildItem -LiteralPath $publishRoot -Filter '*.pdb' -File | Remove-Item -Force
    $wwwRoot = Join-Path $publishRoot 'wwwroot'
    New-Item -ItemType Directory -Force -Path $wwwRoot | Out-Null
    foreach ($application in @('editor','player')) {
        $target = Join-Path $wwwRoot $application
        if (Test-Path $target) {
            $resolved = (Resolve-Path $target).Path
            if (-not $resolved.StartsWith($publishRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Output path escaped package root.' }
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
        Copy-Item -LiteralPath (Join-Path $repoRoot "apps\$application\dist") -Destination $target -Recurse
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'start-local.ps1') -Destination $outputRoot
    Copy-Item -LiteralPath (Join-Path $repoRoot 'docs\windows-delivery.md') -Destination (Join-Path $outputRoot 'README.md')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'docs\studio-creation-design.md') -Destination (Join-Path $outputRoot 'ARCHITECTURE.md')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'docs\studio-product-design.md') -Destination (Join-Path $outputRoot 'PRODUCT.md')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'docs\acceptance\windows.md') -Destination (Join-Path $outputRoot 'ACCEPTANCE.md')
    foreach ($folder in @('acceptance','examples')) {
        $source=Join-Path $repoRoot ('artifacts\'+$folder)
        if(Test-Path $source){Copy-Item -LiteralPath $source -Destination $outputRoot -Recurse -Force}
    }
    Get-ChildItem -LiteralPath $outputRoot -File -Recurse | Where-Object Name -ne 'SHA256SUMS.txt' | Sort-Object FullName | ForEach-Object {
        $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
        "$($hash.Hash.ToLowerInvariant())  $([IO.Path]::GetRelativePath($outputRoot,$_.FullName))"
    } | Set-Content -LiteralPath (Join-Path $outputRoot 'SHA256SUMS.txt') -Encoding utf8
    $zipPath = Join-Path $repoRoot 'artifacts\webgl-studio-windows.zip'
    Compress-Archive -Path (Join-Path $outputRoot '*') -DestinationPath $zipPath -Force
    "PACKAGE=$zipPath"
    "NATIVE_EXE=$publishRoot\Studio.Api.exe"
} finally { Pop-Location }
