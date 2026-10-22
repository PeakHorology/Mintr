#pragma once

#include <nlohmann/json.hpp>
#include <TopoDS_Shape.hxx>

bool buildKernelSolid(const nlohmann::json& solid, TopoDS_Shape& out);
bool assembleKernelShape(const nlohmann::json& solids, TopoDS_Shape& out);
