param()

# 保留旧脚本作为实现入口，已有启动方式与正在运行的服务无需迁移。
& (Join-Path $PSScriptRoot 'Start-Morrow.ps1')
