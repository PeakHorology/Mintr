$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$vcpkg = if ($env:VCPKG_ROOT) { $env:VCPKG_ROOT } else { Join-Path $env:USERPROFILE "vcpkg" }
$toolchain = Join-Path $vcpkg "scripts\buildsystems\vcpkg.cmake"
if (-not (Test-Path $toolchain)) {
  throw "vcpkg not found at $vcpkg. Clone https://github.com/microsoft/vcpkg and run bootstrap-vcpkg.bat, then: vcpkg install opencascade[core]:x64-windows"
}
$vs = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw "Visual Studio Build Tools with C++ was not found." }
$vcvars = Join-Path $vs "VC\Auxiliary\Build\vcvars64.bat"
$src = Join-Path $root "native\mintr-kernel"
$build = Join-Path $src "build"
New-Item -ItemType Directory -Force -Path $build | Out-Null
$cmake = @"
call `"$vcvars`"
cmake -S `"$src`" -B `"$build`" -G `"Visual Studio 17 2022`" -A x64 -DCMAKE_TOOLCHAIN_FILE=`"$toolchain`" -DVCPKG_TARGET_TRIPLET=x64-windows
if errorlevel 1 exit /b 1
cmake --build `"$build`" --config Release
if errorlevel 1 exit /b 1
"@
$bat = Join-Path $env:TEMP "mintr-kernel-build.bat"
Set-Content -Path $bat -Value $cmake -Encoding ASCII
cmd /c $bat
if ($LASTEXITCODE -ne 0) { throw "MintrKernel build failed" }
$release = Join-Path $build "Release"
$exe = Join-Path $release "MintrKernel.exe"
$dist = Join-Path $src "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
Copy-Item (Join-Path $release "MintrKernel.exe") (Join-Path $dist "MintrKernel.exe") -Force
Get-ChildItem $release -Filter *.dll | Copy-Item -Destination $dist -Force
Write-Host "MintrKernel.exe -> $dist"
