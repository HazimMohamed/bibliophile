[CmdletBinding()]
param(
    [string]$WslDistro,
    [string]$WslRepoPath,
    [string]$DeviceId,
    [string]$AvdName,
    [string]$ProxyTargetBase,
    [int]$ProxyPort = 8787,
    [switch]$SkipClean,
    [switch]$SkipUninstall,
    [switch]$SkipProxy
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"

function Write-Step($Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Info($Message) {
    Write-Host "    $Message" -ForegroundColor DarkGray
}

function Write-Good($Message) {
    Write-Host "    $Message" -ForegroundColor Green
}

function Write-WarnLine($Message) {
    Write-Host "    $Message" -ForegroundColor Yellow
}

function Write-Phase($Message) {
    Write-Host ""
    Write-Host "-- $Message" -ForegroundColor DarkCyan
}

function Invoke-Checked {
    param(
        [string]$Label,
        [scriptblock]$Action
    )

    Write-Info $Label
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed during: $Label"
    }
}

function Invoke-CmdInDir {
    param(
        [string]$WorkingDir,
        [string]$CommandText
    )

    $escapedDir = $WorkingDir.Replace('"', '\"')
    $fullCommand = "pushd `"$escapedDir`" && $CommandText"
    & cmd.exe /d /c $fullCommand
    if ($LASTEXITCODE -ne 0) {
        throw "cmd.exe failed while running: $CommandText"
    }
}

function Get-GradleJavaHome {
    $javaHome = $env:JAVA_HOME
    if (-not $javaHome) {
        return $null
    }

    $trimmed = $javaHome.TrimEnd('\')
    $candidate = $trimmed

    if ($trimmed.ToLower().EndsWith("\bin")) {
        $candidate = Split-Path -Parent $trimmed
    }

    if (Test-Path (Join-Path $candidate "bin\java.exe")) {
        return $candidate
    }

    return $javaHome
}

function Prepare-WindowsBuildCopy {
    param(
        [string]$SourceFrontendDir
    )

    $buildRoot = Join-Path $env:TEMP "bibliophile-android-build"
    $targetFrontendDir = Join-Path $buildRoot "frontend"
    $sourceAndroidDir = Join-Path $SourceFrontendDir "android"
    $targetAndroidDir = Join-Path $targetFrontendDir "android"
    $targetCapacitorNodeModules = Join-Path $targetFrontendDir "node_modules\@capacitor"

    if (Test-Path $buildRoot) {
        Remove-Item -Recurse -Force $buildRoot
    }

    New-Item -ItemType Directory -Path $buildRoot | Out-Null
    New-Item -ItemType Directory -Path $targetFrontendDir | Out-Null
    Copy-Item -Recurse -Force $sourceAndroidDir $targetAndroidDir

    New-Item -ItemType Directory -Path $targetCapacitorNodeModules -Force | Out-Null
    Copy-Item -Recurse -Force (Join-Path $SourceFrontendDir "node_modules\@capacitor\android") (Join-Path $targetCapacitorNodeModules "android")
    Copy-Item -Recurse -Force (Join-Path $SourceFrontendDir "node_modules\@capacitor\status-bar") (Join-Path $targetCapacitorNodeModules "status-bar")

    return $targetFrontendDir
}

function Get-AndroidSdkPath {
    $candidates = @(@(
        "$env:LOCALAPPDATA\Android\Sdk",
        $env:ANDROID_SDK_ROOT,
        $env:ANDROID_HOME
    ) | Where-Object { $_ -and (Test-Path (Join-Path $_ "platform-tools\adb.exe")) })

    if ($candidates.Count -gt 0) {
        return $candidates[0]
    }

    throw "Could not find Android SDK root. Set ANDROID_SDK_ROOT or install the Android SDK."
}

function Write-AndroidLocalProperties {
    param(
        [string]$AndroidDir,
        [string]$SdkPath
    )

    $normalizedSdk = $SdkPath -replace '\\', '/'
    $content = "sdk.dir=$normalizedSdk`n"
    Set-Content -Path (Join-Path $AndroidDir "local.properties") -Value $content -NoNewline
}

function Get-RepoLocationFromScriptRoot {
    param([string]$ScriptRoot)

    $normalized = $ScriptRoot -replace '/', '\'

    if ($normalized -match '^\\\\wsl(?:\.localhost)?\\([^\\]+)\\(.+)$') {
        return @{
            Distro = $Matches[1]
            RepoWindowsPath = $normalized
            RepoWslPath = '/' + (($Matches[2] -replace '\\', '/'))
        }
    }

    return $null
}

function Get-AdbPath {
    $candidates = @(@(
        "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
        "$env:ANDROID_SDK_ROOT\platform-tools\adb.exe",
        "$env:ANDROID_HOME\platform-tools\adb.exe"
    ) | Where-Object { $_ -and (Test-Path $_) })

    if ($candidates.Count -gt 0) {
        return $candidates[0]
    }

    throw "Could not find adb.exe. Install Android platform-tools or set ANDROID_SDK_ROOT."
}

function Get-NodePath {
    $command = Get-Command node -ErrorAction SilentlyContinue
    if ($command -and $command.Source) {
        return $command.Source
    }

    $candidates = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
    ) | Where-Object { $_ -and (Test-Path $_) }

    if ($candidates.Count -gt 0) {
        return $candidates[0]
    }

    throw "Could not find node.exe on Windows. Install Node.js or add it to PATH."
}

function Prompt-ProxyTarget {
    Write-Step "Choose dev proxy backend"
    Write-Host "    1. Local backend on another port" -ForegroundColor Gray
    Write-Host "    2. Tailnet HTTPS backend" -ForegroundColor Gray
    Write-Host "    3. Other" -ForegroundColor Gray

    while ($true) {
        $choice = (Read-Host "    Select backend [1/2/3]").Trim()
        switch ($choice) {
            "1" {
                $port = (Read-Host "    Local backend port [8000]").Trim()
                if (-not $port) {
                    $port = "8000"
                }
                return "http://127.0.0.1:$port"
            }
            "2" {
                return "https://zerver.ribbon-fir.ts.net/api"
            }
            "3" {
                $other = (Read-Host "    Enter full backend base URL").Trim()
                if (-not $other) {
                    Write-WarnLine "Please enter a full URL like https://example.com/api"
                    continue
                }
                return $other
            }
            default {
                Write-WarnLine "Please choose 1, 2, or 3."
            }
        }
    }
}

function Start-DevProxy {
    param(
        [string]$NodePath,
        [string]$ProxyScriptPath,
        [string]$TargetBase,
        [int]$Port
    )

    $proxyRoot = Join-Path $env:TEMP "bibliophile-dev-proxy"
    $logPath = Join-Path $proxyRoot "proxy.log"
    $errPath = Join-Path $proxyRoot "proxy.err.log"
    $pidPath = Join-Path $proxyRoot "proxy.pid"

    if (Test-Path $proxyRoot) {
        if (Test-Path $pidPath) {
            $existingPid = (Get-Content $pidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
            if ($existingPid -and ($existingPid -as [int])) {
                try {
                    Stop-Process -Id ([int]$existingPid) -Force -ErrorAction Stop
                    Write-Info "Stopped previous dev proxy process $existingPid"
                } catch {
                    Write-WarnLine "Previous dev proxy process was not running cleanly. Continuing."
                }
            }
        }
    } else {
        New-Item -ItemType Directory -Path $proxyRoot | Out-Null
    }

    $proxyProcess = Start-Process `
        -FilePath $NodePath `
        -ArgumentList @($ProxyScriptPath, "--target-base", $TargetBase, "--port", "$Port") `
        -WorkingDirectory (Split-Path -Parent $ProxyScriptPath) `
        -RedirectStandardOutput $logPath `
        -RedirectStandardError $errPath `
        -PassThru

    Set-Content -Path $pidPath -Value $proxyProcess.Id -NoNewline

    Start-Sleep -Milliseconds 750

    if ($proxyProcess.HasExited) {
        $stderr = if (Test-Path $errPath) { Get-Content $errPath -Raw } else { "" }
        throw "Dev proxy exited immediately. $stderr"
    }

    return @{
        Pid = $proxyProcess.Id
        LogPath = $logPath
        ErrorLogPath = $errPath
    }
}

function Get-TargetDevice {
    param([string]$AdbPath, [string]$PreferredDeviceId)

    if ($PreferredDeviceId) {
        return $PreferredDeviceId
    }

    Write-Phase "Querying connected adb devices"
    Write-Info "Using adb at $AdbPath"
    $lines = & "$AdbPath" devices | Select-Object -Skip 1
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to query adb devices."
    }

    $devices = @()
    foreach ($line in $lines) {
        if ($line -match '^\s*([^\s]+)\s+device\s*$') {
            $devices += $Matches[1]
        }
    }

    if ($devices.Count -eq 0) {
        return $null
    }

    if ($devices.Count -eq 1) {
        return $devices[0]
    }

    Write-Host ""
    Write-Host "    Multiple ADB devices found:" -ForegroundColor Yellow
    for ($i = 0; $i -lt $devices.Count; $i++) {
        Write-Host "    $($i + 1). $($devices[$i])" -ForegroundColor Gray
    }

    while ($true) {
        $input = (Read-Host "    Select device [1-$($devices.Count)]").Trim()
        $index = $input -as [int]
        if ($index -ge 1 -and $index -le $devices.Count) {
            return $devices[$index - 1]
        }
        Write-WarnLine "Please enter a number between 1 and $($devices.Count)."
    }
}

function Ensure-AdbServer {
    param([string]$AdbPath)

    Write-Phase "Ensuring adb server is running"
    Write-Info "Starting adb server if needed"
    & "$AdbPath" start-server | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to start adb server."
    }

    Write-Good "adb server is ready."
}

function Get-EmulatorPath {
    param([string]$SdkPath)

    $candidate = Join-Path $SdkPath "emulator\emulator.exe"
    if (Test-Path $candidate) {
        return $candidate
    }

    throw "Could not find emulator.exe under $SdkPath"
}

function Get-BestGuessAvd {
    param(
        [string]$EmulatorPath,
        [string]$PreferredAvd
    )

    if ($PreferredAvd) {
        return $PreferredAvd
    }

    $avds = & "$EmulatorPath" -list-avds
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to list Android virtual devices."
    }

    $choices = @($avds | Where-Object { $_ -and $_.Trim() })
    if ($choices.Count -eq 0) {
        throw "No Android virtual devices were found."
    }

    if ($choices.Count -eq 1) {
        return $choices[0].Trim()
    }

    $preferred = $choices | Where-Object { $_ -match 'Pixel[_ ]?5' } | Select-Object -First 1
    if ($preferred) {
        return $preferred.Trim()
    }

    $pixel = $choices | Where-Object { $_ -match 'Pixel' } | Select-Object -First 1
    if ($pixel) {
        return $pixel.Trim()
    }

    return $choices[0].Trim()
}

function Start-EmulatorIfNeeded {
    param(
        [string]$AdbPath,
        [string]$EmulatorPath,
        [string]$PreferredAvd,
        [int]$BootTimeoutSeconds = 180
    )

    $existing = Get-TargetDevice -AdbPath $AdbPath -PreferredDeviceId $null
    if ($existing) {
        return $existing
    }

    Write-Phase "Starting Android emulator"
    $avd = Get-BestGuessAvd -EmulatorPath $EmulatorPath -PreferredAvd $PreferredAvd
    Write-Info "Launching AVD $avd"
    Start-Process -FilePath $EmulatorPath -ArgumentList @("-avd", $avd)

    $deadline = (Get-Date).AddSeconds($BootTimeoutSeconds)
    do {
        Start-Sleep -Seconds 3
        $device = Get-TargetDevice -AdbPath $AdbPath -PreferredDeviceId $null
        if ($device) {
            Write-Info "Waiting for $device to finish booting"
            $boot = & "$AdbPath" -s $device shell getprop sys.boot_completed 2>$null
            if ($LASTEXITCODE -eq 0 -and ($boot | Out-String).Trim() -eq "1") {
                Write-Good "Emulator $device is booted and ready."
                return $device
            }
        }
    } while ((Get-Date) -lt $deadline)

    throw "Timed out waiting for the emulator to boot."
}

Write-Phase "Resolving repository paths"
$repoInfo = Get-RepoLocationFromScriptRoot -ScriptRoot $PSScriptRoot

if (-not $WslDistro) {
    $WslDistro = $repoInfo.Distro
}

if (-not $WslRepoPath) {
    $WslRepoPath = ($repoInfo.RepoWslPath -replace '/scripts$','')
}

if (-not $repoInfo) {
    throw "Could not infer repo paths from script location. Run this script from inside the repo on a \\wsl$ path, or pass -WslDistro and -WslRepoPath."
}

if (-not $WslDistro) {
    throw "Could not infer WSL distro name. Pass -WslDistro explicitly."
}

if (-not $WslRepoPath) {
    throw "Could not infer WSL repo path. Pass -WslRepoPath explicitly."
}

Write-Phase "Computing local Windows and WSL paths"
$repoWindowsPath = Split-Path -Parent $repoInfo.RepoWindowsPath
$frontendWindowsPath = Join-Path $repoWindowsPath "frontend"
$androidWindowsPath = Join-Path $frontendWindowsPath "android"
$scriptsWindowsPath = Join-Path $repoWindowsPath "scripts"
$proxyScriptPath = Join-Path $scriptsWindowsPath "dev-proxy.js"
$workingAndroidPath = $androidWindowsPath
$gradleBat = Join-Path $workingAndroidPath "gradlew.bat"
$apkPath = Join-Path $workingAndroidPath "app\build\outputs\apk\debug\app-debug.apk"

Write-Phase "Locating Android platform tools"
$adbPath = Get-AdbPath
Write-Info "adb.exe found at $adbPath"
Ensure-AdbServer -AdbPath $adbPath

Write-Phase "Locating Android SDK"
$androidSdkPath = Get-AndroidSdkPath
Write-Info "Android SDK found at $androidSdkPath"
$emulatorPath = Get-EmulatorPath -SdkPath $androidSdkPath
Write-Info "emulator.exe found at $emulatorPath"

Write-Phase "Locating Windows Node.js"
$nodePath = Get-NodePath
Write-Info "node.exe found at $nodePath"

Write-Phase "Selecting target device"
$device = Get-TargetDevice -AdbPath $adbPath -PreferredDeviceId $DeviceId
if (-not $device) {
    $device = Start-EmulatorIfNeeded -AdbPath $adbPath -EmulatorPath $emulatorPath -PreferredAvd $AvdName
}

$IsEmulator = $device -like "emulator-*"
if ($IsEmulator) {
    Write-Info "Target is an emulator — will use proxy relay and android build mode."
} else {
    Write-Info "Target is a physical device — will hit tailnet directly and skip proxy."
}

if (-not (Test-Path $gradleBat)) {
    throw "Could not find gradlew.bat at $gradleBat"
}

if ($IsEmulator -and -not $SkipProxy) {
    if (-not (Test-Path $proxyScriptPath)) {
        throw "Could not find dev proxy script at $proxyScriptPath"
    }

    if (-not $ProxyTargetBase) {
        $ProxyTargetBase = Prompt-ProxyTarget
    }

    Write-Step "Starting Windows dev proxy"
    $proxyInfo = Start-DevProxy -NodePath $nodePath -ProxyScriptPath $proxyScriptPath -TargetBase $ProxyTargetBase -Port $ProxyPort
    Write-Info "Proxy target: $ProxyTargetBase"
    Write-Info "Proxy URL:    http://10.0.2.2:$ProxyPort/api"
    Write-Info "Proxy log:    $($proxyInfo.LogPath)"
    Write-Good "Dev proxy is running in the background."
}

Write-Host ""
Write-Host "Bibliophile Android Deploy" -ForegroundColor Magenta
Write-Host "From WSL to emulator, with ceremony." -ForegroundColor DarkMagenta

Write-Step "Resolved paths and target"
Write-Info "WSL distro: $WslDistro"
Write-Info "WSL repo:    $WslRepoPath"
Write-Info "Windows repo: $repoWindowsPath"
Write-Info "ADB:         $adbPath"
Write-Info "Device:      $device"
Write-Info "Target type: $(if ($IsEmulator) { 'emulator' } else { 'physical device' })"
Write-Info "Build mode:  $buildMode"
if ($IsEmulator -and -not $SkipProxy) {
    Write-Info "Proxy target: $ProxyTargetBase"
}

Write-Step "Building web assets in WSL"
$buildMode = if ($IsEmulator) { "build:android" } else { "build:android-device" }
Write-Info "Build mode: $buildMode"
$wslNodeBin = "/home/zuzu/.nvm/versions/node/v22.20.0/bin"
$wslNpm = "$wslNodeBin/npm"
$wslLinuxPath = "${wslNodeBin}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
$wslCommand = "export PATH='$wslLinuxPath' && cd '$WslRepoPath/frontend' && '$wslNpm' run $buildMode && '$wslNpm' run cap:sync"
Invoke-Checked -Label "wsl.exe -d $WslDistro -- bash -lc `"$wslCommand`"" -Action {
    & wsl.exe -d $WslDistro -- bash -lc $wslCommand
}
Write-Good "Fresh Android-mode web bundle synced into Capacitor via WSL npm."

$gradleJavaHome = Get-GradleJavaHome
if ($gradleJavaHome) {
    Write-Phase "Preparing Gradle Java environment"
    Write-Info "Using JAVA_HOME=$gradleJavaHome"
    $env:JAVA_HOME = $gradleJavaHome
}

Write-Phase "Preparing Windows-local Android build workspace"
$workingFrontendPath = Prepare-WindowsBuildCopy -SourceFrontendDir $frontendWindowsPath
$workingAndroidPath = Join-Path $workingFrontendPath "android"
$gradleBat = Join-Path $workingAndroidPath "gradlew.bat"
$apkPath = Join-Path $workingAndroidPath "app\build\outputs\apk\debug\app-debug.apk"
Write-AndroidLocalProperties -AndroidDir $workingAndroidPath -SdkPath $androidSdkPath
Write-Info "Copied frontend workspace to $workingFrontendPath"
Write-Info "Wrote local.properties with sdk.dir"

if (-not $SkipClean) {
    Write-Step "Cleaning Android project"
    Invoke-Checked -Label "cmd.exe /c pushd <android-dir> && gradlew.bat clean" -Action {
        Invoke-CmdInDir -WorkingDir $workingAndroidPath -CommandText "gradlew.bat clean"
    }
    Write-Good "Clean slate achieved."
}

Write-Step "Assembling debug APK"
Invoke-Checked -Label "cmd.exe /c pushd <android-dir> && gradlew.bat assembleDebug" -Action {
    Invoke-CmdInDir -WorkingDir $workingAndroidPath -CommandText "gradlew.bat assembleDebug"
}
Write-Good "APK assembled."

if (-not (Test-Path $apkPath)) {
    throw "Expected APK was not found at $apkPath"
}

if (-not $SkipUninstall) {
    Write-Step "Removing previous app install"
    & $adbPath -s $device uninstall com.bibliophile.app | Out-Host
    if ($LASTEXITCODE -eq 0) {
        Write-Good "Old app removed."
    } else {
        Write-WarnLine "Uninstall reported no existing app or a non-fatal issue. Carrying on."
    }
}

Write-Step "Installing fresh APK"
Invoke-Checked -Label "adb install -r app-debug.apk" -Action {
    & $adbPath -s $device install -r $apkPath
}
Write-Good "Fresh APK installed."

Write-Step "Launching Bibliophile"
Invoke-Checked -Label "adb shell am start -n com.bibliophile.app/.MainActivity" -Action {
    & $adbPath -s $device shell am start -n com.bibliophile.app/.MainActivity
}
Write-Good "Bibliophile is launching now."

Write-Host ""
Write-Host "Deploy complete." -ForegroundColor Cyan
if ($IsEmulator -and -not $SkipProxy) {
    Write-Host "Proxy relay remains available at http://10.0.2.2:$ProxyPort/api" -ForegroundColor DarkYellow
}
