# Start crawl stack: ingest + crawl + crawl-web
param()
$root = Split-Path $PSScriptRoot -Parent
function Find-Procs([string]$pattern) {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match $pattern }
}
function Start-One([string]$rel) {
  $p = Join-Path $root $rel
  if (-not (Test-Path $p)) { Write-Host "MISSING $rel" -ForegroundColor Red; return }
  Start-Process -FilePath "node" -ArgumentList $rel -WorkingDirectory $root -WindowStyle Normal
  Write-Host "STARTED $rel" -ForegroundColor Green
}
Write-Host "=== CRAWL ===" -ForegroundColor Cyan
if (-not (Find-Procs 'ingest-daemon\.js')) { Start-One 'src/ingest-daemon.js' } else { Write-Host "ingest-daemon already running" }
if (-not (Find-Procs 'crawl-daemon\.js')) { Start-One 'src/crawl-daemon.js' } else { Write-Host "crawl-daemon already running" }
if (-not (Find-Procs 'src[/\\]server\.js')) { Start-One 'src/server.js' } else { Write-Host "crawl-web already running" }
Start-Sleep -Milliseconds 400
& (Join-Path $PSScriptRoot 'status.ps1') -NoPause
Write-Host ""
Write-Host "Crawl stack started in visible windows. Close a window to stop that process." -ForegroundColor Yellow
Write-Host "Press any key to exit..."
[void][System.Console]::ReadKey($true)
