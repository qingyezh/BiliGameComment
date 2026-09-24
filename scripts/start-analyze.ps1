# Start analyze server
param()
$root = Split-Path $PSScriptRoot -Parent
function Find-Procs([string]$pattern) {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match $pattern }
}
Write-Host "=== ANALYZE ===" -ForegroundColor Cyan
if (-not (Find-Procs 'analyze-server\.js')) {
  Start-Process -FilePath "node" -ArgumentList 'src/analyze-server.js' -WorkingDirectory $root -WindowStyle Normal
  Write-Host "STARTED src/analyze-server.js" -ForegroundColor Green
} else {
  Write-Host "analyze-server already running"
}
Start-Sleep -Milliseconds 400
& (Join-Path $PSScriptRoot 'status.ps1') -NoPause
Write-Host ""
Write-Host "Analyze started in a visible window. Close the window to stop it." -ForegroundColor Yellow
Write-Host "Press any key to exit..."
[void][System.Console]::ReadKey($true)
