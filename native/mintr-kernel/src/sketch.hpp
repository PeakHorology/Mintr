#pragma once

#include <TopoDS_Shape.hxx>
#include <nlohmann/json.hpp>

#include <string>

nlohmann::json handleSketchExtrude(const nlohmann::json& job);
nlohmann::json handleSketchSweep(const nlohmann::json& job);
nlohmann::json handleImportStep(const nlohmann::json& job);
nlohmann::json handleBuildLoft(const nlohmann::json& job);
bool buildLoftLocal(const nlohmann::json& loft, TopoDS_Shape& out, std::string& error);
