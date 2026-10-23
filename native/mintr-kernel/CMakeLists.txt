cmake_minimum_required(VERSION 3.24)
project(MintrKernel LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(OpenCASCADE CONFIG REQUIRED)

add_executable(MintrKernel
  src/main.cpp
  src/protocol.cpp
  src/occtio.cpp
  src/primitives.cpp
  src/sketch.cpp
  src/kernel.cpp
  src/fillet.cpp
  src/split.cpp
  src/print.cpp
)

target_include_directories(MintrKernel PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/src"
  "${CMAKE_CURRENT_SOURCE_DIR}/third_party"
)

target_link_libraries(MintrKernel PRIVATE
  TKernel
  TKMath
  TKBRep
  TKG3d
  TKGeomBase
  TKTopAlgo
  TKPrim
  TKBO
  TKShHealing
  TKMesh
  TKGeomAlgo
  TKFillet
  TKFeat
  TKOffset
  TKXSBase
  TKDE
  TKDESTEP
)

if(MSVC)
  target_compile_options(MintrKernel PRIVATE /EHsc /W3)
endif()

if(COMMAND target_runtime_dlls OR CMAKE_VERSION VERSION_GREATER_EQUAL "3.21")
  add_custom_command(TARGET MintrKernel POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      $<TARGET_RUNTIME_DLLS:MintrKernel>
      $<TARGET_FILE_DIR:MintrKernel>
    COMMAND_EXPAND_LISTS
  )
endif()
