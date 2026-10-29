# vcpkg triplet for the browser build of the Mintr engine: the standard Emscripten one,
# with C++ exceptions on.
set(VCPKG_ENV_PASSTHROUGH_UNTRACKED EMSCRIPTEN_ROOT EMSDK PATH)

if(NOT DEFINED ENV{EMSCRIPTEN_ROOT})
   find_path(EMSCRIPTEN_ROOT "emcc")
else()
   set(EMSCRIPTEN_ROOT "$ENV{EMSCRIPTEN_ROOT}")
endif()

if(NOT EMSCRIPTEN_ROOT)
   if(NOT DEFINED ENV{EMSDK})
      message(FATAL_ERROR "The emcc compiler not found in PATH")
   endif()
   set(EMSCRIPTEN_ROOT "$ENV{EMSDK}/upstream/emscripten")
endif()

if(NOT EXISTS "${EMSCRIPTEN_ROOT}/cmake/Modules/Platform/Emscripten.cmake")
   message(FATAL_ERROR "Emscripten.cmake toolchain file not found")
endif()

set(VCPKG_TARGET_ARCHITECTURE wasm32)
set(VCPKG_CRT_LINKAGE dynamic)
set(VCPKG_LIBRARY_LINKAGE static)
set(VCPKG_CHAINLOAD_TOOLCHAIN_FILE "${VCPKG_ROOT_DIR}/scripts/toolchains/emscripten.cmake")
# OCCT reports a failed fillet or boolean by throwing. Emscripten switches C++ exceptions
# off unless asked, which would turn every such failure into a crash of the whole engine.
# OCCT also turns on OCC_CONVERT_SIGNALS on every non-Windows build. Its setjmp-based
# recovery, mixed with wasm exceptions, makes clang emit invalid code in
# ShapeUpgrade_ShapeDivide::Perform ("br_table: label arity inconsistent"), and the browser
# then refuses the whole engine. A browser has no crash signals to convert, so it is undone
# here; these flags come after OCCT's own definitions.
set(VCPKG_C_FLAGS "-fwasm-exceptions -UOCC_CONVERT_SIGNALS")
set(VCPKG_CXX_FLAGS "-fwasm-exceptions -UOCC_CONVERT_SIGNALS")
set(VCPKG_LINKER_FLAGS "-fwasm-exceptions")
set(VCPKG_BUILD_TYPE release)
