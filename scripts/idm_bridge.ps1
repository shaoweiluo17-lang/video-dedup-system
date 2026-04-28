# IDM 下载桥接 - PowerShell 版本
# 用法: .\idm_bridge.ps1 -Url "https://..." -Path "D:\Downloads" [-Name "video.mp4"]

param(
    [Parameter(Mandatory=$true)] [string]$Url,
    [Parameter(Mandatory=$true)] [string]$Path,
    [string]$Name
)

$IDM_EXE = "C:\Program Files (x86)\Internet Download Manager\IDMan.exe"

if (-not (Test-Path $IDM_EXE)) {
    Write-Error "IDM not found at $IDM_EXE"
    exit 1
}

if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

$args = @('/d', $Url, '/p', $Path, '/n', '/q')
if ($Name) {
    $args += '/f'
    $args += $Name
}

Start-Process -FilePath $IDM_EXE -ArgumentList $args -Wait -NoNewWindow
exit $LASTEXITCODE
