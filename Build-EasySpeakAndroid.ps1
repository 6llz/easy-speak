[CmdletBinding()]
param(
    [string]$ToolDirectory = 'F:\Android-Toolchain',
    [string]$JdkDirectory,
    [string]$SdkDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-BuildCommand([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "构建命令失败：$Command（退出码 $LASTEXITCODE）"
    }
}

$source = Join-Path $PSScriptRoot 'easy-speak'
$toolRoot = [IO.Path]::GetFullPath($ToolDirectory)
New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
if (-not $JdkDirectory) { $JdkDirectory = Join-Path $toolRoot 'Jdk/21' }
if (-not $SdkDirectory) { $SdkDirectory = Join-Path $toolRoot 'Sdk' }
$jdk = [IO.Path]::GetFullPath($JdkDirectory)
$sdk = [IO.Path]::GetFullPath($SdkDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $jdk 'bin/javac.exe') -PathType Leaf)) {
    throw "需要 JDK 21：$jdk"
}
if (-not (Test-Path -LiteralPath (Join-Path $sdk 'platforms/android-36/android.jar') -PathType Leaf)) {
    throw "需要 Android SDK Platform 36：$sdk"
}
$npm = (Get-Command npm.cmd -CommandType Application).Source
$npmCache = Join-Path $toolRoot 'npm-cache'
$buildTemp = Join-Path $toolRoot 'tmp'
$build = Join-Path $toolRoot ('builds/EasySpeak/' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $build, $buildTemp -Force | Out-Null

# 另建构建目录，只复制明确列出的源码。电脑的环境文件、缓存与用户数据不参与移动端构建。
$buildInputs = @(
    'src', 'server', 'public', 'index.html', 'vite.config.ts', 'tsconfig.json',
    'package.json', 'package-lock.json', '.npmrc', 'capacitor.config.json'
)
foreach ($relativePath in $buildInputs) {
    Copy-Item -LiteralPath (Join-Path $source $relativePath) -Destination $build -Recurse
}

$buildEnvironment = @{
    JAVA_HOME = $jdk
    ANDROID_HOME = $sdk
    ANDROID_SDK_ROOT = $sdk
    ANDROID_USER_HOME = Join-Path $toolRoot 'android-user'
    GRADLE_USER_HOME = Join-Path $toolRoot 'gradle-cache'
    TEMP = $buildTemp
    TMP = $buildTemp
}
$originalEnvironment = @{}
foreach ($name in $buildEnvironment.Keys) {
    $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $buildEnvironment[$name], 'Process')
}

Push-Location -LiteralPath $build
try {
    Invoke-BuildCommand $npm @('ci', '--cache', $npmCache)
    $capacitorVersion = '8.6.2'
    Invoke-BuildCommand $npm @(
        'install', '--save-exact', '--cache', $npmCache,
        "@capacitor/core@$capacitorVersion", "@capacitor/android@$capacitorVersion", "@capacitor/cli@$capacitorVersion"
    )
    Invoke-BuildCommand $npm @('run', 'build:android')
    $capacitor = Join-Path $build 'node_modules/.bin/cap.cmd'
    Invoke-BuildCommand $capacitor @('add', 'android')

    # 权限由 Capacitor 的 WebView 桥接按需申请。相机和麦克风是可选设备。
    $manifestPath = Join-Path $build 'android/app/src/main/AndroidManifest.xml'
    $manifest = [Xml.XmlDocument]::new()
    $manifest.Load($manifestPath)
    $root = $manifest.DocumentElement
    $namespace = 'http://schemas.android.com/apk/res/android'
    $permissions = @('CAMERA', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS')
    foreach ($permission in $permissions) {
        $qualifiedName = "android.permission.$permission"
        $existing = $root.SelectNodes('uses-permission') | Where-Object {
            $_.GetAttribute('name', $namespace) -eq $qualifiedName
        }
        if (-not $existing) {
            $entry = $manifest.CreateElement('uses-permission')
            $null = $entry.SetAttribute('name', $namespace, $qualifiedName)
            $null = $root.InsertBefore($entry, $root.SelectSingleNode('application'))
        }
    }
    foreach ($device in @('camera', 'camera.autofocus', 'microphone')) {
        $feature = $manifest.CreateElement('uses-feature')
        $null = $feature.SetAttribute('name', $namespace, "android.hardware.$device")
        $null = $feature.SetAttribute('required', $namespace, 'false')
        $null = $root.InsertBefore($feature, $root.SelectSingleNode('application'))
    }
    $null = $root.SelectSingleNode('application').SetAttribute('usesCleartextTraffic', $namespace, 'false')
    $manifest.Save($manifestPath)

    Push-Location -LiteralPath (Join-Path $build 'android')
    try {
        Invoke-BuildCommand '.\gradlew.bat' @('assembleDebug')
    } finally {
        Pop-Location
    }
    $apk = Join-Path $build 'android/app/build/outputs/apk/debug/app-debug.apk'
    Get-FileHash -LiteralPath $apk -Algorithm SHA256 | Format-List Path, Hash
} finally {
    Pop-Location
    foreach ($name in $originalEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process')
    }
}
