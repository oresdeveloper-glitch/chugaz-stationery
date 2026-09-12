$ErrorActionPreference = 'SilentlyContinue'
$root = "C:\Users\chugaa boe\Documents\Default Project"
$backend = "$root\backend"
$tools = "$root\tools"
$exe = "$tools\cloudflared.exe"
$node = "C:\Program Files\nodejs\node.exe"
$env:SERVE_FRONTEND = "1"

# --- Backend (Node) ---
$backListening = netstat -ano | Select-String ":4000\s+.*LISTENING"
if (-not $backListening) {
  Start-Process -FilePath $node -ArgumentList "server.js" -WorkingDirectory $backend -WindowStyle Hidden
  Start-Sleep -Seconds 4
}

# --- Cloudflare quick tunnel ---
Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
$log = "$root\tunnel.log"; $err = "$root\tunnel.err"
if (Test-Path $log) { Remove-Item $log -Force }
if (Test-Path $err) { Remove-Item $err -Force }
Start-Process -FilePath $exe -ArgumentList "tunnel","--url","http://localhost:4000","--no-autoupdate" -RedirectStandardOutput $log -RedirectStandardError $err -WindowStyle Hidden

# --- Capture the generated public URL ---
$url = $null
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 2
  $m = Select-String -Path $err -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($m) { $url = $m.Matches[0].Value; break }
}
if ($url) {
  Set-Content -Path "$root\tunnel-url.txt" -Value $url
  Write-Output "TUNNEL: $url"
} else {
  Write-Output "TUNNEL_NOT_FOUND"
}
