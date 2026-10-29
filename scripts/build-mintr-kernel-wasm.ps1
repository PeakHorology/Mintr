$ErrorActionPreference = "Stop"
# The Mintr engine for the browser: the same C++ as MintrKernel.exe, built to WebAssembly.
# Needs the Emscripten SDK 5.0.3 (https://github.com/emscripten-core/emsdk; 6.0 miscompiles
# OCCT's exception handling) and OCCT built by
#   vcpkg install opencascade[core]:wasm32-emscripten-mintr --overlay-triplets=native/mintr-kernel/triplets
$root = Split-Path -Parent $PSScriptRoot
$vcpkg = if ($env:VCPKG_ROOT) { $env:VCPKG_ROOT } else { Join-Path $env:USERPROFILE "vcpkg" }
$emsdk = if ($env:EMSDK) { $env:EMSDK } else { Join-Path $env:USERPROFILE "emsdk" }
if (-not (Test-Path (Join-Path $emsdk "emsdk_env.ps1"))) {
  throw "Emscripten SDK not found at $emsdk. Clone https://github.com/emscripten-core/emsdk, then: emsdk install 5.0.3; emsdk activate 5.0.3"
}
# Found before the Emscripten environment rewrites PATH.
$cmakeExe = (Get-Command cmake -ErrorAction SilentlyContinue).Source
if (-not $cmakeExe) { $cmakeExe = Join-Path $env:ProgramFiles "CMake/bin/cmake.exe" }
$ninjaExe = (Get-Command ninja -ErrorAction SilentlyContinue).Source
if (-not $ninjaExe) { throw "Ninja not found. Install it with: winget install Ninja-build.Ninja" }
$env:EMSDK_QUIET = "1"
& (Join-Path $emsdk "emsdk_env.ps1") | Out-Null
$src = Join-Path $root "native\mintr-kernel"
$build = Join-Path $src "build-wasm"
$triplets = Join-Path $src "triplets"
$emscriptenCmake = Join-Path $emsdk "upstream\emscripten\cmake\Modules\Platform\Emscripten.cmake"
& $cmakeExe -S $src -B $build -G Ninja -DCMAKE_BUILD_TYPE=Release "-DCMAKE_MAKE_PROGRAM=$ninjaExe" `
  "-DCMAKE_TOOLCHAIN_FILE=$(Join-Path $vcpkg 'scripts\buildsystems\vcpkg.cmake')" `
  "-DVCPKG_CHAINLOAD_TOOLCHAIN_FILE=$emscriptenCmake" `
  "-DVCPKG_TARGET_TRIPLET=wasm32-emscripten-mintr" `
  "-DVCPKG_OVERLAY_TRIPLETS=$triplets"
if ($LASTEXITCODE -ne 0) { throw "MintrKernel wasm configure failed" }
& $cmakeExe --build $build
if ($LASTEXITCODE -ne 0) { throw "MintrKernel wasm build failed" }
$dist = Join-Path $src "dist-wasm"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
Copy-Item (Join-Path $build "MintrKernel.mjs") $dist -Force
Copy-Item (Join-Path $build "MintrKernel.wasm") $dist -Force
Write-Host "MintrKernel.mjs + MintrKernel.wasm -> $dist"
