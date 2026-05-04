#!/usr/bin/env pwsh
# Stop all Wrangler dev server processes.

$procs = Get-Process -Name "node" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*wrangler*" }

if ($procs) {
  $procs | Stop-Process -Force
  Write-Host "已停止 $($procs.Count) 個 Wrangler 程序。"
} else {
  # Fallback: kill by port 8787
  $conn = netstat -ano 2>$null |
    Select-String ":8787\s" |
    Select-Object -First 1

  if ($conn) {
    $pid = ($conn.Line -split '\s+')[-1]
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    Write-Host "已停止 PID $pid（佔用 port 8787）。"
  } else {
    Write-Host "找不到執行中的 Wrangler 程序。"
  }
}
