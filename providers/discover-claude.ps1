$ErrorActionPreference = 'Stop'
# Inspect only candidate Node command lines; emit process identity, never arguments.
$native = @(Get-Process -Name claude -ErrorAction SilentlyContinue | ForEach-Object { @{ id = $_.Id } })
if ($native.Count -gt 0) { $native | ConvertTo-Json -Compress; return }
if (@(Get-Process -Name node -ErrorAction SilentlyContinue).Count -eq 0) { '[]'; return }
$nodes = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop | Where-Object {
  $_.CommandLine -match '[\\/]@anthropic-ai[\\/]claude-code[\\/](?:cli\.js|bin[\\/])'
} | ForEach-Object { @{ id = $_.ProcessId } })
@($native + $nodes) | ConvertTo-Json -Compress
