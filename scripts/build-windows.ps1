param(
  [string]$NodePath,
  [string]$WebView2Dir,
  [string]$RuntimeTemplateDir,
  [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workspaceRoot = Split-Path (Split-Path $projectRoot -Parent) -Parent
$versionFile = Join-Path $projectRoot 'version.json'
$outputDir = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $workspaceRoot 'outputs' }

if (-not $RuntimeTemplateDir) {
  $RuntimeTemplateDir = Join-Path $env:LOCALAPPDATA 'Rhine Music\app-v0.5.0-desktop'
}
if (-not $WebView2Dir) {
  $WebView2Dir = if ($env:RHINE_WEBVIEW2_DIR) { $env:RHINE_WEBVIEW2_DIR } else { $RuntimeTemplateDir }
}
if (-not $NodePath) {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($nodeCommand) { $NodePath = $nodeCommand.Source }
  elseif (Test-Path -LiteralPath (Join-Path $RuntimeTemplateDir 'node.exe')) { $NodePath = Join-Path $RuntimeTemplateDir 'node.exe' }
}
if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
  throw 'Node.js 22.12+ was not found. Pass -NodePath with the full path to node.exe.'
}
$nodeVersionText = (& $NodePath --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersionText -notmatch '^v(\d+)\.(\d+)\.(\d+)') { throw "Cannot read Node.js version: $nodeVersionText" }
$nodeMajor = [int]$Matches[1]; $nodeMinor = [int]$Matches[2]
if ($nodeMajor -lt 22 -or ($nodeMajor -eq 22 -and $nodeMinor -lt 12)) { throw "Node.js 22.12+ is required; found $nodeVersionText." }

$requiredWebViewFiles = @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll')
foreach ($name in $requiredWebViewFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $WebView2Dir $name) -PathType Leaf)) {
    throw "Missing $name under '$WebView2Dir'. Pass -WebView2Dir to the folder containing the WebView2 SDK assemblies."
  }
}
$cscPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $cscPath -PathType Leaf)) { throw "The 64-bit .NET Framework compiler was not found at '$cscPath'." }
$esbuild = Join-Path $projectRoot 'node_modules\.bin\esbuild.cmd'
foreach ($name in @('debug', 'ms')) {
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules\$name\package.json") -PathType Leaf)) {
    throw "Missing npm dependency '$name'; run npm ci first."
  }
}
if (-not (Test-Path -LiteralPath $esbuild -PathType Leaf)) { throw 'esbuild was not found; run npm ci first.' }

. (Join-Path $PSScriptRoot 'build-lock.ps1')
$buildLock = Enter-RhineBuildLock -ProjectRoot $projectRoot
$buildRoot = $null
$temporaryOutputDirectory = $null
$publishedPaths = [System.Collections.Generic.List[string]]::new()
$buildSucceeded = $false
$previousLockEnvironment = $env:RHINE_BUILD_LOCK_HELD
try {
  New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
  $env:RHINE_BUILD_LOCK_HELD = '1'
  & $NodePath (Join-Path $projectRoot 'scripts\version.mjs') --allocate-dev --output-dir $outputDir
  $versionExitCode = $LASTEXITCODE
  if ($null -eq $previousLockEnvironment) { Remove-Item Env:\RHINE_BUILD_LOCK_HELD -ErrorAction SilentlyContinue }
  else { $env:RHINE_BUILD_LOCK_HELD = $previousLockEnvironment }
  if ($versionExitCode -ne 0) { throw 'Automatic unique version assignment failed.' }

  $versionState = Get-Content -LiteralPath $versionFile -Raw | ConvertFrom-Json
  $version = [string]$versionState.version
  if ($version -notmatch '^(\d+)\.(\d+)\.(\d+)-dev\.(\d+)$') {
    throw "A Windows development package needs a unique prerelease version; found '$version'."
  }
  $numericVersion = "{0}.{1}.{2}.{3}" -f $Matches[1], $Matches[2], $Matches[3], $Matches[4]
  $exeName = "Rhine-Music-Desktop-$version.exe"
  $readmeName = "README-Rhine-Music-Desktop-$version.txt"
  $releaseManifestName = "release-manifest-$version.json"
  $exePath = Join-Path $outputDir $exeName
  $readmePath = Join-Path $outputDir $readmeName
  $releaseManifestPath = Join-Path $outputDir $releaseManifestName
  foreach ($target in @($exePath, $readmePath, $releaseManifestPath)) {
    if (Test-Path -LiteralPath $target) { throw "Refusing to overwrite an existing versioned artifact: $target" }
  }

  $packageJson = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
  $packageLock = Get-Content -LiteralPath (Join-Path $projectRoot 'package-lock.json') -Raw | ConvertFrom-Json -AsHashtable
  $buildVersionSource = Get-Content -LiteralPath (Join-Path $projectRoot 'src\build-version.ts') -Raw
  $desktopSource = Get-Content -LiteralPath (Join-Path $projectRoot 'DesktopProgram.cs') -Raw
  $manifestSource = Get-Content -LiteralPath (Join-Path $projectRoot 'app.manifest') -Raw
  $escapedVersion = [regex]::Escape($version)
  $escapedNumericVersion = [regex]::Escape($numericVersion)
  $metadataChecks = @(
    ($packageJson.version -eq $version)
    ($packageLock['version'] -eq $version)
    ($packageLock['packages']['']['version'] -eq $version)
    ($buildVersionSource -match ('BUILD_VERSION = "' + $escapedVersion + '";'))
    ($desktopSource -match ('AssemblyFileVersion\("' + $escapedNumericVersion + '"\)'))
    ($desktopSource -match ('AssemblyInformationalVersion\("' + $escapedVersion + '"\)'))
    ($desktopSource -match ('AppVersion = "' + $escapedVersion + '";'))
    ($manifestSource -match ('assemblyIdentity version="' + $escapedNumericVersion + '"'))
  )
  if ($metadataChecks -contains $false) {
    throw 'Package, UI, Win32 version, payload path, or Windows manifest metadata are not synchronized.'
  }

  Push-Location $projectRoot
  try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'The web application build failed.' }
    $buildRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot "work\windows-build-$version"))
    $safeWorkRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'work')).TrimEnd('\') + '\'
    if (-not $buildRoot.StartsWith($safeWorkRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to use build directory outside the project work folder: $buildRoot"
    }
    if (Test-Path -LiteralPath $buildRoot) { throw "Build directory already exists; version reuse is forbidden: $buildRoot" }
    New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
    $payloadRoot = Join-Path $buildRoot 'payload'
    $scriptsRoot = Join-Path $payloadRoot 'scripts'
    $nodeModulesRoot = Join-Path $payloadRoot 'node_modules'
    New-Item -ItemType Directory -Force -Path $scriptsRoot, $nodeModulesRoot | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot 'dist') -Destination (Join-Path $payloadRoot 'dist') -Recurse
    Copy-Item -LiteralPath $NodePath -Destination (Join-Path $payloadRoot 'node.exe')
    foreach ($name in $requiredWebViewFiles) { Copy-Item -LiteralPath (Join-Path $WebView2Dir $name) -Destination (Join-Path $payloadRoot $name) }
    foreach ($name in @('debug', 'ms')) { Copy-Item -LiteralPath (Join-Path $projectRoot "node_modules\$name") -Destination (Join-Path $nodeModulesRoot $name) -Recurse }
    foreach ($name in @('LICENSE', 'NOTICE.md')) { Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination (Join-Path $payloadRoot $name) }
    $nodeLicense = Join-Path (Split-Path $NodePath -Parent) 'LICENSE'
    if (-not (Test-Path -LiteralPath $nodeLicense -PathType Leaf) -and (Test-Path -LiteralPath (Join-Path $RuntimeTemplateDir 'NODE-LICENSE.txt'))) {
      Copy-Item -LiteralPath (Join-Path $RuntimeTemplateDir 'NODE-LICENSE.txt') -Destination (Join-Path $payloadRoot 'NODE-LICENSE.txt')
    } elseif (Test-Path -LiteralPath $nodeLicense -PathType Leaf) {
      Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $payloadRoot 'NODE-LICENSE.txt')
    } else {
      throw 'Node.js license file was not found beside node.exe or in the runtime template.'
    }
    foreach ($name in @('WebView2-LICENSE.txt', 'WebView2-NOTICE.txt')) {
      $licenseSource = Join-Path $WebView2Dir $name
      if (-not (Test-Path -LiteralPath $licenseSource) -and (Test-Path -LiteralPath (Join-Path $RuntimeTemplateDir $name))) {
        $licenseSource = Join-Path $RuntimeTemplateDir $name
      }
      if (Test-Path -LiteralPath $licenseSource) { Copy-Item -LiteralPath $licenseSource -Destination (Join-Path $payloadRoot $name) }
    }

    $serverBundle = Join-Path $scriptsRoot 'music-server.mjs'
    & $esbuild (Join-Path $projectRoot 'scripts\music-server.mjs') '--bundle' '--platform=node' '--format=esm' '--target=node22' '--external:debug' "--outfile=$serverBundle"
    if ($LASTEXITCODE -ne 0) { throw 'Bundling the local music service failed.' }
    & $NodePath --check $serverBundle
    if ($LASTEXITCODE -ne 0) { throw 'The bundled music service did not pass Node syntax validation.' }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $payloadZip = Join-Path $buildRoot 'payload.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($payloadRoot, $payloadZip, [IO.Compression.CompressionLevel]::Optimal, $false)
    $stagedExePath = Join-Path $buildRoot $exeName
    $framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
    $references = @('System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll', 'System.Web.Extensions.dll', 'System.IO.Compression.dll', 'System.IO.Compression.FileSystem.dll') | ForEach-Object { "/reference:$(Join-Path $framework $_)" }
    $arguments = @(
      '/nologo', '/target:winexe', '/platform:x64', '/optimize+', "/out:$stagedExePath",
      "/win32manifest:$(Join-Path $projectRoot 'app.manifest')",
      "/resource:$payloadZip,RhineMusicPayload.zip",
      "/reference:$(Join-Path $WebView2Dir 'Microsoft.Web.WebView2.Core.dll')",
      "/reference:$(Join-Path $WebView2Dir 'Microsoft.Web.WebView2.WinForms.dll')"
    ) + $references + @((Join-Path $projectRoot 'DesktopProgram.cs'))
    & $cscPath @arguments
    if ($LASTEXITCODE -ne 0) { throw 'The Windows desktop executable did not compile.' }
    $versionInfo = (Get-Item -LiteralPath $stagedExePath).VersionInfo
    if ($versionInfo.FileVersion -ne $numericVersion -or $versionInfo.ProductVersion -ne $version) {
      throw "PE version mismatch: expected $numericVersion / $version, got $($versionInfo.FileVersion) / $($versionInfo.ProductVersion)."
    }

    $stagedReadmePath = Join-Path $buildRoot $readmeName
    Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $stagedReadmePath
    $pwaBuild = Get-Content -LiteralPath (Join-Path $projectRoot 'dist\pwa-build.json') -Raw | ConvertFrom-Json
    if ($pwaBuild.appVersion -ne $version -or $pwaBuild.version -notlike "$version-*") {
      throw 'The offline cache payload is not synchronized with the application version.'
    }
    $exeHash = (Get-FileHash -LiteralPath $stagedExePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $payloadHash = (Get-FileHash -LiteralPath $payloadZip -Algorithm SHA256).Hash.ToLowerInvariant()
    $releaseManifest = [ordered]@{
      application = 'Rhine Music Desktop'
      version = $version
      fileVersion = $versionInfo.FileVersion
      productVersion = $versionInfo.ProductVersion
      sequence = [int]$versionState.sequence
      dataSchema = [string]$versionState.dataSchema
      buildTimeUtc = [DateTime]::UtcNow.ToString('o')
      renderingBackend = 'WebView2 / WebGL 2 via ANGLE; genuine 4K display-frame acceptance remains pending.'
      offlineCache = @{ applicationVersion = $pwaBuild.appVersion; cacheVersion = $pwaBuild.version; files = $pwaBuild.files.Count; bytes = $pwaBuild.bytes }
      performanceAcceptance = 'PENDING'
      artifacts = @(
        @{ file = $exeName; sha256 = $exeHash },
        @{ file = [IO.Path]::GetFileName($payloadZip); sha256 = $payloadHash }
      )
    }
    $stagedManifestPath = Join-Path $buildRoot $releaseManifestName
    $releaseManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $stagedManifestPath -Encoding utf8

    $temporaryOutputDirectory = Join-Path $outputDir ".rhine-publish-$version-$PID"
    if (Test-Path -LiteralPath $temporaryOutputDirectory) { throw "Temporary publish folder already exists: $temporaryOutputDirectory" }
    New-Item -ItemType Directory -Path $temporaryOutputDirectory | Out-Null
    Copy-Item -LiteralPath $stagedExePath -Destination (Join-Path $temporaryOutputDirectory $exeName)
    Copy-Item -LiteralPath $stagedReadmePath -Destination (Join-Path $temporaryOutputDirectory $readmeName)
    Copy-Item -LiteralPath $stagedManifestPath -Destination (Join-Path $temporaryOutputDirectory $releaseManifestName)
    if ((Get-FileHash -LiteralPath (Join-Path $temporaryOutputDirectory $exeName) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $exeHash) {
      throw 'Staged executable hash changed during package copy.'
    }
    foreach ($name in @($exeName, $readmeName, $releaseManifestName)) {
      $source = Join-Path $temporaryOutputDirectory $name
      $destination = Join-Path $outputDir $name
      if (Test-Path -LiteralPath $destination) { throw "Refusing to overwrite an existing versioned artifact: $destination" }
      Move-Item -LiteralPath $source -Destination $destination
      $publishedPaths.Add($destination)
    }

    $checksumTempPath = Join-Path $temporaryOutputDirectory 'SHA256SUMS.txt'
    $sumLines = Get-ChildItem -LiteralPath $outputDir -Filter '*.exe' -File | Sort-Object Name | ForEach-Object {
      $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      "$hash  $($_.Name)"
    }
    Set-Content -LiteralPath $checksumTempPath -Value $sumLines -Encoding Ascii
    Move-Item -LiteralPath $checksumTempPath -Destination (Join-Path $outputDir 'SHA256SUMS.txt') -Force
    Write-Host "Built $exePath"
    Write-Host "Win32 file version: $($versionInfo.FileVersion); product version: $($versionInfo.ProductVersion)"
    Write-Host "SHA-256: $exeHash"
    Write-Host "Manifest: $releaseManifestPath"
    $buildSucceeded = $true
  } finally {
    Pop-Location
  }
} finally {
  if ($null -eq $previousLockEnvironment) { Remove-Item Env:\RHINE_BUILD_LOCK_HELD -ErrorAction SilentlyContinue }
  else { $env:RHINE_BUILD_LOCK_HELD = $previousLockEnvironment }
  if (-not $buildSucceeded) {
    foreach ($published in $publishedPaths) { Remove-Item -LiteralPath $published -Force -ErrorAction SilentlyContinue }
  }
  if ($temporaryOutputDirectory -and (Test-Path -LiteralPath $temporaryOutputDirectory)) {
    $safeOutputRoot = [IO.Path]::GetFullPath($outputDir).TrimEnd('\') + '\'
    $resolvedTemporary = [IO.Path]::GetFullPath($temporaryOutputDirectory)
    if ($resolvedTemporary.StartsWith($safeOutputRoot, [StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force
    }
  }
  if ($buildRoot -and (Test-Path -LiteralPath $buildRoot)) {
    $safeWorkRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'work')).TrimEnd('\') + '\'
    $resolvedBuildRoot = [IO.Path]::GetFullPath($buildRoot)
    if ($resolvedBuildRoot.StartsWith($safeWorkRoot, [StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolvedBuildRoot -Recurse -Force
    }
  }
  Exit-RhineBuildLock -Lock $buildLock
}
