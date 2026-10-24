#pragma once

#include <nlohmann/json.hpp>
#include <TopoDS_Shape.hxx>

/**
 * Generator recipes: an ordered list of add / cut solids (stacks of rounded
 * rectangles, cylinders, cones, boxes, profile prisms) in a local frame resting
 * on y = 0. Mirrors apps/web/src/lib/recipeBrep.ts — keep the two in step.
 */
bool buildRecipeLocal(const nlohmann::json& recipe, TopoDS_Shape& out, std::string& error);

/** `type: "buildRecipe"` → indexed mesh + BREP + STEP of the finished body. */
nlohmann::json handleBuildRecipe(const nlohmann::json& job);
