# Detect and start crawl / analysis node processes (visible windows)
# Usage: .\scripts\start-services.ps1 [-Crawl] [-Analyze] [-All]
param(
  [switch]$Crawl,
  [switch]$Analyze,
  [switch]$All
)
if (-not ($Crawl -or $Analyze -or $All)) { $All = $true }

$root = Split-Path $PSScriptRoot -Parent

function Find-Procs([string]$pattern) {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match $pattern }
}

function Start-One([string]$rel, [string]$title) {
  $p = Join-Path $root $rel
  if (-not (Test-Path $p)) { Write-Host "MISSING $rel" -ForegroundColor Red; return }
  Start-Process -FilePath "node" -ArgumentList $rel -WorkingDirectory $root -WindowStyle Normal
  Write-Host "STARTED $rel ($title)" -ForegroundColor Green
}

if ($All -or $Crawl) {
  Write-Host "=== CRAWL ===" -ForegroundColor Cyan
  if (-not (Find-Procs 'ingest-daemon\.js')) { Start-One 'src/ingest-daemon.js' 'ingest' } else { Write-Host "ingest-daemon already running" }
  if (-not (Find-Procs 'crawl-daemon\.js')) { Start-One 'src/crawl-daemon.js' 'crawl' } else { Write-Host "crawl-daemon already running" }
  if (-not (Find-Procs 'src[/\\]server\.js')) { Start-One 'src/server.js' 'crawl-web' } else { Write-Host "crawl-web already running" }
}

if ($All -or $Analyze) {
  Write-Host "=== ANALYZE ===" -ForegroundColor Cyan
  if (-not (Find-Procs 'analyze-server\.js')) { Start-One 'src/analyze-server.js' 'analyze' } else { Write-Host "analyze-server already running" }
}

Start-Sleep -Milliseconds 400
& (Join-Path $PSScriptRoot 'status.ps1') -NoPause

Write-Host ""
Write-Host "Services started in visible windows. Close a window to stop that process." -ForegroundColor Yellow
Write-Host "Press any key to exit this script..."
[void][System.Console]::ReadKey($true)
