$ErrorActionPreference = 'SilentlyContinue'
$root = "C:\Users\chugaa boe\Documents\Default Project"
$exe = "$root\tools\cloudflared.exe"
$err = "$env:TEMP/cf.err"
$log = "$env:TEMP/cf.log"

Stop-Process -Name cloudflared -Force
Start-Sleep -Seconds 2
Remove-Item $log,$err -ErrorAction SilentlyContinue

Start-Process -FilePath $exe -ArgumentList "tunnel","--url","http://localhost:4000","--no-autoupdate" -RedirectStandardOutput $log -RedirectStandardError $err -WindowStyle Hidden

$url = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    $m = Select-String -Path $err -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value; break }
}
if ($url) {
    Set-Content -Path "$root\tunnel-url.txt" -Value $url
    Write-Output "TUNNEL: $url"
} else {
    Write-Output "TUNNEL_NOT_FOUND"
    Get-Content $err -Tail 5 | Out-String
}
