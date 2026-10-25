# Private helper: stdout goes only to the Node adapter, never a log or terminal.
# Only local language-server metadata is returned. Google auth stores are untouched.
$ErrorActionPreference = 'Stop'
try {
 $apps = @(Get-Process -ErrorAction Stop | Where-Object {
  $_.ProcessName -match '^(Antigravity|Antigravity IDE|agy)$' -or
  ($_.ProcessName -match '^language_server' -and $_.Path -match '[\\/]Antigravity(?: IDE)?[\\/]')
 })
 if (-not $apps.Count) { [Console]::WriteLine('{"running":false,"servers":[]}'); exit }
 # agy embeds its server in the CLI process. IDE has separate language servers.
 # Query their own loopback page for CSRF; do not inspect command lines.
 $servers = @($apps | Where-Object { $_.ProcessName -eq 'agy' } | ForEach-Object { @{ id = $_.Id; startedAt = $_.StartTime.ToUniversalTime().ToString('o'); csrf = ''; kind = 'cli' } })
 $languageServers = @($apps | Where-Object { $_.ProcessName -match '^language_server' })
 foreach ($server in $languageServers) {
  $token = ''
  try {
   # IDE exposes this temporary local token in its own launch arguments.
   # The full command line never leaves this helper or enters a log.
   $metadata = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $server.Id) -ErrorAction Stop
   $match = [regex]::Match($metadata.CommandLine, '--csrf[_-]token(?:=|\s+)(?:"([^"]+)"|([^\s"]+))')
   $token = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
  } catch { }
  $servers += @{ id = $server.Id; csrf = $token; kind = 'ide' }
 }
 $products = @()
 if (@($apps | Where-Object { $_.ProcessName -eq 'agy' }).Count) { $products += 'cli' }
 if (@($apps | Where-Object { $_.ProcessName -ne 'agy' }).Count) { $products += 'ide' }
 @{ running = $true; servers = $servers; products = $products } | ConvertTo-Json -Depth 4 -Compress | ForEach-Object { [Console]::WriteLine($_) }
} catch {
 # Never emit a raw CIM exception: it could contain process metadata.
 [Console]::WriteLine('{"running":true,"code":"DISCOVERY_BLOCKED","servers":[]}')
}
