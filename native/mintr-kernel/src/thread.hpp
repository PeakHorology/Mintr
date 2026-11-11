#pragma once

#include <TopoDS_Shape.hxx>
#include <nlohmann/json.hpp>

#include <string>

/**
 * An exact thread (rod, screw with its head, nut, or tapped-hole cutter) from the numbers the
 * print mesh uses. Axis +Y, base at y = 0.
 */
bool buildThreadLocal(const nlohmann::json& thread, TopoDS_Shape& out, std::string& error);

/** `type: "buildThread"` → the exact thread's BREP, and its mesh when `mesh` is set. */
nlohmann::json handleBuildThread(const nlohmann::json& job);
