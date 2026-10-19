param()

$ErrorActionPreference = 'Stop'
$projectDirectory = Join-Path $PSScriptRoot 'easy-speak'
$runtimeDirectory = Join-Path $projectDirectory '.sites-runtime'
$statusUrl = 'http://127.0.0.1:5173/api/v1/minimax/status'

function Get-EasySpeakStatus {
    try {
        $status = Invoke-RestMethod -Uri $statusUrl -TimeoutSec 2
        if ($status.configured -is [bool]) { return $status }
    }
    catch {
        # 服务尚未启动时继续启动流程，不输出请求细节或本机凭据。
    }
    return $null
}

function Show-EasySpeakStatus($status) {
    Write-Output '轻松说: http://127.0.0.1:5173/'
    Write-Output "MiniMax configured: $($status.configured)"
}

$existingStatus = Get-EasySpeakStatus
if ($null -ne $existingStatus) {
    Show-EasySpeakStatus $existingStatus
    exit 0
}

if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) {
    throw '5173 端口已被其他服务占用，轻松说未启动。'
}

$vitePath = Join-Path $projectDirectory 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $vitePath)) {
    throw 'Dependencies are missing. Run npm install --cache .npm-cache in the easy-speak folder.'
}
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$nodePath = (Get-Command node -ErrorAction Stop).Source
$previewProcess = Start-Process -FilePath $nodePath `
    -ArgumentList @('--use-system-ca', ('"' + $vitePath + '"'), '--host', '127.0.0.1', '--port', '5173', '--strictPort') `
    -WorkingDirectory $projectDirectory -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $runtimeDirectory 'preview.log') `
    -RedirectStandardError (Join-Path $runtimeDirectory 'preview-error.log') -PassThru

for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    $status = Get-EasySpeakStatus
    if ($null -ne $status) {
        Show-EasySpeakStatus $status
        exit 0
    }
    if ($previewProcess.HasExited) { break }
}
throw '轻松说未就绪，请查看 easy-speak/.sites-runtime/preview-error.log。'
