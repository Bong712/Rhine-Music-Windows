function Enter-RhineBuildLock {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [int]$TimeoutSeconds = 180
  )

  $lockDirectory = Join-Path $ProjectRoot 'work'
  New-Item -ItemType Directory -Force -Path $lockDirectory | Out-Null
  $lockPath = Join-Path $lockDirectory 'package-build.lock'
  $watch = [Diagnostics.Stopwatch]::StartNew()
  while ($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    try {
      $stream = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      $payload = [Text.Encoding]::UTF8.GetBytes((@{ pid = $PID; startedUtc = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress))
      $stream.Write($payload, 0, $payload.Length)
      $stream.Flush($true)
      return [pscustomobject]@{ Path = $lockPath; Stream = $stream }
    }
    catch [IO.IOException] {
      try {
        $item = Get-Item -LiteralPath $lockPath -ErrorAction Stop
        if ([DateTime]::UtcNow - $item.LastWriteTimeUtc -gt [TimeSpan]::FromMinutes(1)) {
          $canOpen = $false
          try {
            $probe = [IO.File]::Open($lockPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
            $probe.Dispose()
            $canOpen = $true
          } catch [IO.IOException] { $canOpen = $false }
          if ($canOpen) { Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue }
        }
      } catch { }
      Start-Sleep -Milliseconds 200
    }
  }
  throw "Timed out waiting for another Rhine Music package build to finish: $lockPath"
}

function Exit-RhineBuildLock {
  param([Parameter(Mandatory = $true)]$Lock)
  $Lock.Stream.Dispose()
  Remove-Item -LiteralPath $Lock.Path -Force -ErrorAction SilentlyContinue
}
