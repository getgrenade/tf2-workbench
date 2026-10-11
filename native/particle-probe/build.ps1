param([string]$SdkRoot = 'C:\Projects\Source SDK 2013\source-sdk-2013\src', [string]$ExecutableName = 'particle-probe')
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$taskOutput = Join-Path $taskRoot 'target\particle-probe'
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$installation) { throw 'MSVC C++ build tools are required.' }
$vcvars = Join-Path $installation 'VC\Auxiliary\Build\vcvars64.bat'
$environmentScript = Join-Path $taskOutput 'compiler-env.cmd'
[IO.File]::WriteAllText($environmentScript, "@call `"$vcvars`" >nul`r`n@if errorlevel 1 exit /b 1`r`n@set`r`n")
$compilerEnvironment = & cmd.exe /d /c $environmentScript
if ($LASTEXITCODE) { throw 'Could not initialize MSVC environment.' }
foreach ($line in $compilerEnvironment) {
    if ($line -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}
$sdkLib = Join-Path $SdkRoot 'lib\public\x64'
$commonArgs = @('/nologo', '/std:c++17', '/MT', '/O2', '/EHsc', '/DWIN32', '/DWIN64', '/D_WIN32', '/D_WIN64', '/DCOMPILER_MSVC', '/DCOMPILER_MSVC64', '/DNDEBUG', '/D_CRT_SECURE_NO_WARNINGS',
    "/I$SdkRoot\public", "/I$SdkRoot\public\tier0", "/I$SdkRoot\public\tier1", "/I$SdkRoot\public\mathlib", "/I$SdkRoot\common", "/I$SdkRoot")
foreach ($dependency in @('mathlib', 'tier1')) {
    $objectFolder = Join-Path $taskOutput $dependency
    New-Item -ItemType Directory -Force -Path $objectFolder | Out-Null
    $project = Get-Content (Join-Path $SdkRoot "$dependency\$dependency.vpc")
    $sources = foreach ($line in $project) {
        if ($line -match '\$File\s+"([^"\\]+\.cpp)"' -and $line -notmatch '\$POSIX|\$LINUXALL|!\$SOURCESDK') {
            Join-Path $SdkRoot "$dependency\$($matches[1])"
        }
    }
    $library = Join-Path $taskOutput "$dependency.lib"
    if (!(Test-Path $library) -or (Get-Item $library).LastWriteTimeUtc -lt (Get-Item $PSCommandPath).LastWriteTimeUtc) {
        $log = Join-Path $objectFolder 'build.log'
        & cl.exe @commonArgs /c /DTIER1_STATIC_LIB /DMATHLIB_LIB "/Fo$objectFolder\" @sources *> $log
        if ($LASTEXITCODE) { Get-Content $log -Tail 40; throw "Could not build SDK $dependency." }
        & lib.exe /nologo "/OUT:$library" (Get-ChildItem $objectFolder -Filter '*.obj' | ForEach-Object FullName) *> $log
        if ($LASTEXITCODE) { Get-Content $log -Tail 40; throw "Could not archive SDK $dependency." }
    }
}
$compileArgs = $commonArgs + @(
    "/Fo$taskOutput\main.obj", "/Fe$taskOutput\$ExecutableName.exe", "$PSScriptRoot\main.cpp", '/link', "/LIBPATH:$sdkLib",
    "$taskOutput\mathlib.lib", "$taskOutput\tier1.lib", 'particles.lib', 'dmxloader.lib', 'tier2.lib', 'tier0.lib', 'vstdlib.lib', 'rpcrt4.lib', 'ws2_32.lib', 'winmm.lib', 'dbghelp.lib', '/DEBUG', "/PDB:$taskOutput\$ExecutableName.pdb")
$linkLog = Join-Path $taskOutput 'link.log'
& cl.exe @compileArgs *> $linkLog
if ($LASTEXITCODE) { Get-Content $linkLog -Tail 35; throw 'Native particle probe build failed.' }
Write-Output "Built $taskOutput\$ExecutableName.exe"
