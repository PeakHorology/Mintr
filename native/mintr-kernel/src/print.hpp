#pragma once

#include <nlohmann/json.hpp>

nlohmann::json handlePrintOverlay(const nlohmann::json& job);
nlohmann::json handleMeasure(const nlohmann::json& job);
