#pragma once

#include <cstdint>
#include <nlohmann/json.hpp>
#include <string>

bool readFrame(std::string& payload);
bool writeFrame(const std::string& payload);
void setStdioBinary();

/**
 * Replaces mesh number lists (any key ending in "positions" or "normals", and "indices")
 * with {"$f32": base64} or {"$u32": base64}. Float32 is what the viewer draws with, and
 * the reply shrinks to a fraction of the text, which the desktop app parses at once.
 */
void packMeshArrays(nlohmann::json& reply);
