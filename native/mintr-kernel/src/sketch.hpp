#pragma once

#include <nlohmann/json.hpp>

nlohmann::json handleSketchExtrude(const nlohmann::json& job);
nlohmann::json handleSketchSweep(const nlohmann::json& job);
nlohmann::json handleImportStep(const nlohmann::json& job);
