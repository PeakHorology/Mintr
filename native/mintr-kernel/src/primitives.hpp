#pragma once

#include <nlohmann/json.hpp>
#include <TopoDS_Shape.hxx>

#include <vector>

bool buildKernelSolid(const nlohmann::json& solid, TopoDS_Shape& out);
bool assembleKernelShape(const nlohmann::json& solids, TopoDS_Shape& out);
/** Two solids → one fuse. Three or more → one fuse after another. */
bool kernelFuseSolids(const std::vector<TopoDS_Shape>& solids, TopoDS_Shape& out);
/** One hole → one cut. Two or more → one cut after another. Same loop either way. */
bool kernelCutHoles(const TopoDS_Shape& solid, const std::vector<TopoDS_Shape>& holes, TopoDS_Shape& out);
