# Stop crawl / analysis node processes
# Usage: .\scripts\stop-services.ps1 [-Crawl] [-Analyze] [-All]
param(
  [switch]$Crawl,
  [switch]$Analyze,
  [switch]$All
)
if (-not ($Crawl -or $Analyze -or $All)) { $All = $true }

function Kill-Re([string]$pattern, [string]$exclude = '') {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match $pattern -and (-not $exclude -or $_.CommandLine -notmatch $exclude) } |
    ForEach-Object {
      Write-Host ("STOP pid={0} {1}" -f $_.ProcessId, $_.CommandLine)
      Stop-Process -Id $_.ProcessId -Force
    }
}

if ($All -or $Crawl) {
  Kill-Re 'crawl-daemon\.js'
  Kill-Re 'ingest-daemon\.js'
  Kill-Re 'src[/\\]server\.js'
}
if ($All -or $Analyze) {
  Kill-Re 'analyze-server\.js'
}
Write-Host "DONE"

Write-Host ""
Write-Host "Press any key to exit..."
[void][System.Console]::ReadKey($true)
