# Status: crawl / analysis node processes and ports
param([switch]$NoPause)

$ports = @{ 8787 = 'crawl web (usually off)'; 8788 = 'analyze-server' }
$names = @(
  @{ n = 'ingest-daemon';  re = 'ingest-daemon\.js';   role = 'ingest' },
  @{ n = 'crawl-daemon';   re = 'crawl-daemon\.js';    role = 'crawl' },
  @{ n = 'crawl-web';      re = 'src[/\\]server\.js';  role = 'crawl-web (default off)' },
  @{ n = 'analyze-server'; re = 'analyze-server\.js';  role = 'analyze' }
)

Write-Host "=== PROCESSES ===" -ForegroundColor Cyan
$all = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
foreach ($x in $names) {
  $hit = $all | Where-Object { $_.CommandLine -match $x.re }
  if ($hit) {
    foreach ($h in $hit) {
      Write-Host ("[OK]  {0,-15} pid={1,-7} {2}" -f $x.n, $h.ProcessId, $x.role) -ForegroundColor Green
    }
  } else {
    Write-Host ("[--]  {0,-15} down     {1}" -f $x.n, $x.role) -ForegroundColor Yellow
  }
}

Write-Host "=== PORTS ===" -ForegroundColor Cyan
foreach ($k in ($ports.Keys | Sort-Object)) {
  $c = Get-NetTCPConnection -LocalPort $k -State Listen -ErrorAction SilentlyContinue
  if ($c) {
    Write-Host ("[OK]  {0}  {1}  pid={2}" -f $k, $ports[$k], ($c | Select-Object -First 1).OwningProcess) -ForegroundColor Green
  } else {
    Write-Host ("[--]  {0}  {1}  not listening" -f $k, $ports[$k]) -ForegroundColor Yellow
  }
}

$rt = Join-Path (Split-Path $PSScriptRoot -Parent) 'app\data\103496\runtime.crawl.json'
if (Test-Path $rt) {
  Write-Host "=== CRAWL RUNTIME ===" -ForegroundColor Cyan
  Get-Content $rt -Raw
}

if (-not $NoPause) {
  Write-Host ""
  Write-Host "Press any key to exit..."
  [void][System.Console]::ReadKey($true)
}
