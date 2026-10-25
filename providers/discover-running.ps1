$ErrorActionPreference = 'Stop'
try {
 $all = @(Get-Process -ErrorAction Stop)
 $codex = @($all | Where-Object { $_.ProcessName -eq 'codex' } | ForEach-Object { $_.Id })
 $agy = @($all | Where-Object { $_.ProcessName -match '^(Antigravity|Antigravity IDE|agy)$' -or ($_.ProcessName -match '^language_server' -and $_.Path -match '[\\/]Antigravity(?: IDE)?[\\/]') } | ForEach-Object { $_.Id })
 $claude = @($all | Where-Object { $_.ProcessName -eq 'claude' } | ForEach-Object { $_.Id })
 $claudeKnown = $true
 if (-not $claude.Count -and @($all | Where-Object { $_.ProcessName -eq 'node' }).Count) {
  try {
   $claude = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop | Where-Object { $_.CommandLine -match '[\\/]@anthropic-ai[\\/]claude-code[\\/](?:cli\.js|bin[\\/])' } | ForEach-Object { $_.ProcessId })
  } catch { $claudeKnown = $false }
 }
 @{ codex = @{ known = $true; pids = $codex }; antigravity = @{ known = $true; pids = $agy }; claude = @{ known = $claudeKnown; pids = $claude } } | ConvertTo-Json -Depth 4 -Compress | ForEach-Object { [Console]::WriteLine($_) }
} catch { [Console]::WriteLine('{}') }
