#pragma once

#include <nlohmann/json.hpp>

nlohmann::json handleModifierJob(const nlohmann::json& job);

/** True once a blend build had to be abandoned mid-way: the engine should exit after its reply. */
bool kernelNeedsRestart();
