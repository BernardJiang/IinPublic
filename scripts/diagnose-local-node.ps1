# Windows counterpart to diagnose-local-node.sh — run against a running IinPublic.exe
# to answer, without hunting through raw logs: is this device actually talking to the
# shared hub?
#
# Usage: powershell -File scripts\diagnose-local-node.ps1 [-LocalPort 8088] [-HubHost 192.168.10.50] [-HubPort 8080]

param(
  [int]$LocalPort = 8088,
  [string]$HubHost = "192.168.10.50",
  [int]$HubPort = 8080
)

$LocalBase = "http://127.0.0.1:$LocalPort"
Write-Host "== IinPublic local-node diagnostic =="
Write-Host "Checking $LocalBase ..."

try {
  $storage = Invoke-RestMethod -Uri "$LocalBase/api/debug/storage" -TimeoutSec 5
  Write-Host "OK: Local embedded node is up on port $LocalPort." -ForegroundColor Green
} catch {
  Write-Host "FAIL: Local embedded node is not responding on port $LocalPort." -ForegroundColor Red
  Write-Host "  Is the app running? Is this the right port (8088 desktop / 8080 dev:server)?"
  exit 1
}

Write-Host ""
Write-Host "-- Chatroom membership (this device's own view) --"
$selfId = $null
try {
  $members = Invoke-RestMethod -Uri "$LocalBase/api/chatrooms/global/members" -TimeoutSec 5
  foreach ($m in $members) {
    Write-Host "  - $($m.stageName) ($($m.userId))"
    if ($m.userId -ne "iinpublic-root-techsupport" -and -not $selfId) { $selfId = $m.userId }
  }
  Write-Host "  Total: $($members.Count)"
} catch {
  Write-Host "  (could not fetch: $_)"
}

Write-Host ""
Write-Host "-- Live TCP connection to hub ${HubHost}:${HubPort} --"
$conns = Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue |
  Where-Object { $_.RemoteAddress -eq $HubHost -and $_.RemotePort -eq $HubPort }
if ($conns) {
  Write-Host "OK: An established TCP connection to ${HubHost}:${HubPort} exists." -ForegroundColor Green
  $conns | ForEach-Object {
    $proc = (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    Write-Host "  $proc -> $($_.RemoteAddress):$($_.RemotePort)"
  }
} else {
  Write-Host "FAIL: No established TCP connection to ${HubHost}:${HubPort} found." -ForegroundColor Red
  Write-Host "  If membership above only shows yourself + TechSupport, this is almost"
  Write-Host "  certainly why - the app isn't actually connected to the shared hub."
  Write-Host "  Check: IINPUBLIC_HUB_GUN_URL points at the hub, IINPUBLIC_EMBEDDED_HUB_MODE=gun-peer"
  Write-Host "  is set (explicit-http mode alone won't sync talks/mesh data), and the relay's"
  Write-Host "  protocol (http/https) matches what you configured."
}

Write-Host ""
if ($selfId) {
  Write-Host "-- Own profile --"
  Write-Host "  Your device's user id: $selfId"
  Write-Host "  (Can't check the HUB's copy of your profile from here directly -- if others"
  Write-Host "   can't see your name/avatar, re-save Settings -> Profile to re-push it.)"
}

Write-Host ""
Write-Host "== done =="
