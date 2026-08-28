param (
    [switch]$Headless,
    [int]$Port = 9333,
    [string]$Address = "0.0.0.0",
    [string]$UserDataDir = ""
)

$ErrorActionPreference = "Stop"

# Determine profile directory
if ([string]::IsNullOrWhiteSpace($UserDataDir)) {
    $ProfileDir = Join-Path -Path $PSScriptRoot -ChildPath "chrome_profile"
} else {
    $ProfileDir = $UserDataDir
}

if (!(Test-Path -Path $ProfileDir)) {
    New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
}
$ProfileDir = (Resolve-Path $ProfileDir).Path

# Check if Chrome CDP is already running on the target port
$versionUrl = "http://127.0.0.1:$Port/json/version"
try {
    $existing = Invoke-RestMethod -Uri $versionUrl -TimeoutSec 2 -ErrorAction SilentlyContinue
    if ($null -ne $existing -and $existing.webSocketDebuggerUrl) {
        Write-Host "[INFO] Chrome CDP is ALREADY running and healthy on port $Port!" -ForegroundColor Green
        Write-Host "       Browser: $($existing.Browser)"
        Write-Host "       WebSocket: $($existing.webSocketDebuggerUrl)"
        exit 0
    }
} catch {
    # Not running yet, proceed with launch
}

# Locate Chrome executable
$candidatePaths = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)

$chromePath = $null
foreach ($path in $candidatePaths) {
    if ($path -and (Test-Path -Path $path)) {
        $chromePath = $path
        break
    }
}

if (-not $chromePath) {
    $cmd = Get-Command chrome.exe -ErrorAction SilentlyContinue
    if ($cmd) {
        $chromePath = $cmd.Source
    }
}

if (-not $chromePath) {
    Write-Error "[ERROR] Could not find Google Chrome installation. Please install Chrome or verify path."
    exit 1
}

Write-Host "Found Chrome at: $chromePath" -ForegroundColor Cyan

# Prepare arguments
$argList = @(
    "--remote-debugging-address=$Address",
    "--remote-debugging-port=$Port",
    "--remote-allow-origins=*",
    "--user-data-dir=`"$ProfileDir`"",
    "--no-first-run",
    "--no-default-browser-check",
    "--start-maximized",
    "--window-size=1920,1080",
    "--window-position=0,0",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding"
)

if ($Headless) {
    $argList += "--headless=new"
    $argList += "--disable-gpu"
    Write-Host "Launching Chrome CDP (Headless) on $Address`:$Port..." -ForegroundColor Yellow
} else {
    Write-Host "Launching Chrome CDP (GUI) on $Address`:$Port..." -ForegroundColor Yellow
}

$argString = $argList -join " "

# Launch Chrome process detached in background via Win32_Process
$fullCmd = "`"$chromePath`" $argString"
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $fullCmd } | Out-Null

Write-Host "Chrome process initiated. Verifying CDP health on $versionUrl..." -ForegroundColor Cyan

# 5-second connection health verification loop
$maxAttempts = 10
$delayMs = 500
$isHealthy = $false
$response = $null

for ($i = 1; $i -le $maxAttempts; $i++) {
    Start-Sleep -Milliseconds $delayMs
    try {
        $response = Invoke-RestMethod -Uri $versionUrl -TimeoutSec 1 -ErrorAction SilentlyContinue
        if ($null -ne $response -and $response.webSocketDebuggerUrl) {
            $isHealthy = $true
            break
        }
    } catch {
        # Retry until timeout
    }
}

if ($isHealthy) {
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "[SUCCESS] Chrome CDP is active, bound, and ready for connections!" -ForegroundColor Green
    Write-Host "  Address:     $Address" -ForegroundColor Green
    Write-Host "  Port:        $Port" -ForegroundColor Green
    Write-Host "  Browser:     $($response.Browser)" -ForegroundColor Green
    Write-Host "  Profile:     $ProfileDir" -ForegroundColor Green
    Write-Host "  Endpoint:    $versionUrl" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    exit 0
} else {
    Write-Host "============================================================" -ForegroundColor Yellow
    Write-Host "[WARNING] Chrome was launched, but did not respond on $versionUrl within 5 seconds." -ForegroundColor Yellow
    Write-Host "  Please verify that port $Port is not blocked by Windows Firewall or another application." -ForegroundColor Yellow
    Write-Host "============================================================" -ForegroundColor Yellow
    exit 1
}
