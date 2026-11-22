[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
$rootPrefix = $projectRoot + [IO.Path]::DirectorySeparatorChar
$sourceFiles = [Collections.Generic.List[IO.FileInfo]]::new()

# 只允许明确的入口文件和源码目录，禁止把工作目录、环境文件或缓存整体归档。
$requiredFiles = @(
    'README.md', 'README.en.md', 'README.ja.md', 'README.ko.md',
    'README.es.md', 'README.fr.md', 'README.de.md',
    'LICENSE', 'NOTICE', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md',
    '.gitignore', '.gitattributes', 'Start-EasySpeak.ps1', 'Export-EasySpeak.ps1', 'Build-EasySpeakAndroid.ps1',
    'easy-speak/README.md', 'easy-speak/LICENSE', 'easy-speak/NOTICE', 'easy-speak/CONTRIBUTING.md',
    'easy-speak/DEPLOYMENT.md', 'easy-speak/.editorconfig', 'easy-speak/.env.example',
    'easy-speak/.gitignore', 'easy-speak/.npmrc', 'easy-speak/.prettierignore',
    'easy-speak/.prettierrc.json', 'easy-speak/eslint.config.js', 'easy-speak/index.html',
    'easy-speak/package.json', 'easy-speak/package-lock.json', 'easy-speak/tsconfig.json',
    'easy-speak/vite.config.ts', 'easy-speak/capacitor.config.json'
)
$sourceDirectories = @('easy-speak/src', 'easy-speak/server', 'easy-speak/public', 'easy-speak/tests', 'easy-speak/docs')
$allowedExtensions = @('.ts', '.tsx', '.css', '.svg', '.md')

function Add-PublicSourceFile([IO.FileSystemInfo]$Entry) {
    if (($Entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw '源码清单中存在符号链接，请先核对来源。'
    }
    if (-not $Entry.FullName.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw '源码清单中存在项目目录之外的路径。'
    }
    if ($Entry -is [IO.FileInfo]) { $sourceFiles.Add($Entry) }
}

foreach ($relativePath in $requiredFiles) {
    $entry = Get-Item -LiteralPath (Join-Path $projectRoot $relativePath) -Force
    if ($entry -isnot [IO.FileInfo]) { throw "发布入口不是普通文件：$relativePath" }
    Add-PublicSourceFile $entry
}
foreach ($relativeDirectory in $sourceDirectories) {
    $directory = Get-Item -LiteralPath (Join-Path $projectRoot $relativeDirectory) -Force
    Add-PublicSourceFile $directory
    foreach ($entry in Get-ChildItem -LiteralPath $directory.FullName -Recurse -Force) {
        if ($entry -is [IO.FileInfo] -and $entry.Extension -notin $allowedExtensions) {
            throw '源码目录出现清单以外的文件类型，请核对并更新发布清单。'
        }
        Add-PublicSourceFile $entry
    }
}

# 凭据只用于内存匹配，不写入归档、日志或异常；模式扫描不代替人工检查。
$knownSecrets = [Collections.Generic.List[string]]::new()
if ($env:MINIMAX_API_KEY -and $env:MINIMAX_API_KEY.Length -ge 16) {
    $knownSecrets.Add($env:MINIMAX_API_KEY)
}
$localEnvironment = Join-Path $projectRoot 'easy-speak/.env.local'
if (Test-Path -LiteralPath $localEnvironment -PathType Leaf) {
    foreach ($line in [IO.File]::ReadAllLines($localEnvironment)) {
        if ($line -match '^\s*MINIMAX_API_KEY\s*=\s*(.+?)\s*$') {
            $secret = $Matches[1].Trim().Trim([char]34).Trim([char]39)
            if ($secret.Length -ge 16 -and $secret -ne 'replace_with_your_key') {
                $knownSecrets.Add($secret)
            }
        }
    }
}
$sensitivePatterns = @(
    '\bsk-[A-Za-z0-9_-]{20,}',
    '\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
    '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'
)
$sourceSnapshots = [Collections.Generic.List[object]]::new()
foreach ($file in $sourceFiles) {
    # 检查和打包使用同一份字节快照，避免检查后文件被编辑导致归档内容变化。
    $bytes = [IO.File]::ReadAllBytes($file.FullName)
    $content = [Text.Encoding]::UTF8.GetString($bytes)
    foreach ($secret in $knownSecrets) {
        if ($content.Contains($secret)) { throw '发布中止：源码清单含已知凭据，请先移除。' }
    }
    foreach ($pattern in $sensitivePatterns) {
        if ($content -match $pattern) { throw '发布中止：源码清单命中敏感信息模式，请先检查。' }
    }
    $sourceSnapshots.Add([pscustomobject]@{
        Name = $file.FullName.Substring($rootPrefix.Length).Replace('\', '/')
        Bytes = $bytes
    })
}

$releaseDirectory = Join-Path $projectRoot 'release'
if (Test-Path -LiteralPath $releaseDirectory) {
    $releaseEntry = Get-Item -LiteralPath $releaseDirectory -Force
    if ($releaseEntry -isnot [IO.DirectoryInfo] -or
        ($releaseEntry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw '源码包输出目录不是项目内的普通目录。'
    }
} else {
    New-Item -ItemType Directory -Path $releaseDirectory | Out-Null
}
$archivePath = Join-Path $releaseDirectory 'easy-speak-source.zip'
$temporaryPath = Join-Path $releaseDirectory ('source-' + [Guid]::NewGuid().ToString('N') + '.tmp')
Add-Type -AssemblyName System.IO.Compression
try {
    $outputStream = [IO.File]::Open($temporaryPath, [IO.FileMode]::CreateNew)
    try {
        $archive = [IO.Compression.ZipArchive]::new(
            $outputStream, [IO.Compression.ZipArchiveMode]::Create, $true, [Text.Encoding]::UTF8
        )
        try {
            foreach ($snapshot in $sourceSnapshots) {
                $zipEntry = $archive.CreateEntry($snapshot.Name, [IO.Compression.CompressionLevel]::Optimal)
                $entryStream = $zipEntry.Open()
                try { $entryStream.Write($snapshot.Bytes, 0, $snapshot.Bytes.Length) }
                finally { $entryStream.Dispose() }
            }
        } finally { $archive.Dispose() }
    } finally { $outputStream.Dispose() }
    Move-Item -LiteralPath $temporaryPath -Destination $archivePath -Force
} finally {
    if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
}
Write-Output "已生成 $($sourceFiles.Count) 个文件的源码包：$archivePath"
Write-Output '不含本机环境文件、依赖、缓存或构建产物；未执行上传。'
