param(
  [switch]$DryRun,
  [switch]$Final
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workspaceRoot = (Resolve-Path (Join-Path $projectRoot '..\..')).Path
$nativeRoot = Join-Path $workspaceRoot 'work\native-renderer'
$versionFile = Join-Path $projectRoot 'version.json'
$reportPath = Join-Path $nativeRoot 'STATUS.md'

if ($DryRun) {
  node (Join-Path $projectRoot 'scripts\version.mjs') --dry-run --output-dir (Join-Path $workspaceRoot 'outputs')
  exit $LASTEXITCODE
}
if ($Final) {
  if (-not (Select-String -LiteralPath $reportPath -Pattern '^Product integration: COMPLETE$' -Quiet)) {
    throw 'Final native builds require completed product integration in STATUS.md.'
  }
  if (-not (Select-String -LiteralPath $reportPath -Pattern '^Performance acceptance: PASS$' -Quiet)) {
    throw 'Final native builds require measured native-resolution/60 FPS acceptance in STATUS.md.'
  }
}

. (Join-Path $projectRoot 'scripts\build-lock.ps1')
$buildLock = Enter-RhineBuildLock -ProjectRoot $projectRoot
$previousLockEnvironment = $env:RHINE_BUILD_LOCK_HELD
try {
  $env:RHINE_BUILD_LOCK_HELD = '1'
  if ($Final) { node (Join-Path $projectRoot 'scripts\version.mjs') --finalize }
  else { node (Join-Path $projectRoot 'scripts\version.mjs') --allocate-dev --output-dir (Join-Path $workspaceRoot 'outputs') }
  $versionExitCode = $LASTEXITCODE
  if ($null -eq $previousLockEnvironment) { Remove-Item Env:\RHINE_BUILD_LOCK_HELD -ErrorAction SilentlyContinue }
  else { $env:RHINE_BUILD_LOCK_HELD = $previousLockEnvironment }
  if ($versionExitCode -ne 0) { throw 'Unique version assignment failed.' }

$state = Get-Content -LiteralPath $versionFile -Raw | ConvertFrom-Json
$version = [string]$state.version
$parts = $version -split '[-.]'
if ($parts.Count -eq 5) { $numericVersion = "$($parts[0]).$($parts[1]).$($parts[2]).$($parts[4])" }
else { $numericVersion = "$($parts[0]).$($parts[1]).$($parts[2]).65535" }
$stage = Join-Path $nativeRoot (Join-Path 'artifacts' $version)
$exeName = "Rhine-Music-Native-$version.exe"
$exePath = Join-Path $stage $exeName
if (Test-Path -LiteralPath $stage) { throw "Build directory already exists; version reuse is forbidden: $stage" }
New-Item -ItemType Directory -Force $stage | Out-Null

dotnet publish (Join-Path $nativeRoot 'native-renderer.csproj') -c Release --no-restore -o (Join-Path $stage 'publish') `
  "-p:Version=$version" "-p:AssemblyVersion=$numericVersion" "-p:FileVersion=$numericVersion" "-p:InformationalVersion=$version" `
  '-p:Product=Rhine Music' '-p:Company=RonaldDeng'
if ($LASTEXITCODE -ne 0) { throw 'Native renderer publish failed.' }
Move-Item -LiteralPath (Join-Path $stage 'publish\Rhine-Music-Native.exe') -Destination $exePath
if (Test-Path -LiteralPath (Join-Path $stage 'publish\Assets')) {
  Move-Item -LiteralPath (Join-Path $stage 'publish\Assets') -Destination (Join-Path $stage 'Assets')
}

$sourceStage = Join-Path $stage 'source'
New-Item -ItemType Directory -Force $sourceStage | Out-Null
Copy-Item -LiteralPath (Join-Path $nativeRoot 'Program.cs') -Destination $sourceStage
Copy-Item -LiteralPath (Join-Path $nativeRoot 'ArchiveModelRenderer.cs') -Destination $sourceStage
Copy-Item -LiteralPath (Join-Path $nativeRoot 'native-renderer.csproj') -Destination $sourceStage
Copy-Item -LiteralPath (Join-Path $nativeRoot 'Assets') -Destination (Join-Path $sourceStage 'Assets') -Recurse
Copy-Item -LiteralPath (Join-Path $nativeRoot 'app.manifest') -Destination $sourceStage -ErrorAction SilentlyContinue
Copy-Item -LiteralPath (Join-Path $nativeRoot 'STATUS.md') -Destination $sourceStage
Copy-Item -LiteralPath (Join-Path $projectRoot 'version.json'),(Join-Path $projectRoot 'package.json'),(Join-Path $projectRoot 'package-lock.json'),(Join-Path $projectRoot 'README.md'),(Join-Path $projectRoot 'CHANGELOG.md'),(Join-Path $projectRoot 'LICENSE'),(Join-Path $projectRoot 'NOTICE.md') -Destination $sourceStage
$sourceZip = Join-Path $stage "Rhine-Music-Source-$version.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($sourceStage,$sourceZip,[System.IO.Compression.CompressionLevel]::Optimal,$false)

$hashExe = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash.ToLowerInvariant()
$hashSource = (Get-FileHash -LiteralPath $sourceZip -Algorithm SHA256).Hash.ToLowerInvariant()
$sourceCommit = 'none; no commit checked out'
$sourceDirty = 'unknown'
try {
  $sourceCommit = (& git -C $workspaceRoot rev-parse HEAD 2>$null).Trim()
  $sourceDirty = if ((& git -C $workspaceRoot status --porcelain 2>$null).Length -gt 0) { 'true' } else { 'false' }
} catch { }
$manifest = [ordered]@{
  version = $version
  buildTimeUtc = [DateTime]::UtcNow.ToString('o')
  sourceCommit = $sourceCommit
  sourceDirty = $sourceDirty
  backend = 'Direct3D 11 native prototype; draws 12 music-cd GLB instances with cached demo covers and a selection-lift animation, but is not integrated into the player scene'
  gpuSelection = 'DXGI high-performance hardware adapter; software fallback is disabled'
  backBuffer = '3840x2160 observed on Intel Arc B390 prototype; see native-prototype-log'
  acceptance = 'PENDING; product scene integration and 3840x2160/60 FPS acceptance not met'
  tests = @('D3D11 hardware-device startup', 'music GLB buffer/accessor import and indexed instanced draw setup', 'cached demo-cover texture selection', '230 ms album selection-lift transition', 'DXGI swapchain dimensions', 'DXGI media frame statistics', 'CPU present timing')
  artifacts = @(
    @{ file = $exeName; sha256 = $hashExe },
    @{ file = [IO.Path]::GetFileName($sourceZip); sha256 = $hashSource }
  )
}
$manifestPath = Join-Path $stage "release-manifest-$version.json"
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8
@("$hashExe  $exeName", "$hashSource  $([IO.Path]::GetFileName($sourceZip))") | Set-Content -LiteralPath (Join-Path $stage 'SHA256SUMS.txt') -Encoding ascii
Write-Host "Built test-only native renderer $exePath"
Write-Host 'Native renderer builds remain test-only under work/native-renderer/artifacts and are not copied to outputs.'
Write-Host "SHA-256: $hashExe"
} finally {
  if ($null -eq $previousLockEnvironment) { Remove-Item Env:\RHINE_BUILD_LOCK_HELD -ErrorAction SilentlyContinue }
  else { $env:RHINE_BUILD_LOCK_HELD = $previousLockEnvironment }
  Exit-RhineBuildLock -Lock $buildLock
}
