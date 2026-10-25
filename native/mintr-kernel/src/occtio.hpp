#pragma once

#include <nlohmann/json.hpp>
#include <TopoDS_Shape.hxx>
#include <gp_Trsf.hxx>

#include <string>
#include <vector>

constexpr double kKernelPi = 3.14159265358979323846;
constexpr double kKernelDeg = kKernelPi / 180.0;

gp_Trsf kernelPoseTrsf(const nlohmann::json& solid, double height);
TopoDS_Shape kernelPlaced(const TopoDS_Shape& shape, const nlohmann::json& solid, double height);
TopoDS_Shape kernelUnify(const TopoDS_Shape& shape);
TopoDS_Shape kernelScale(const TopoDS_Shape& shape, double sx, double sy, double sz);
/** Move a world-space or leftover Group STEP into the local mesh frame (XZ centered, Y from 0). */
TopoDS_Shape kernelRecenterToLocalMeshFrame(const TopoDS_Shape& shape);
/** Recenter, scale to the shape size, then Y-center so kernelPlaced matches the JS path. */
TopoDS_Shape kernelFitImportedLocal(const TopoDS_Shape& shape, const nlohmann::json& solid);
bool kernelReadStep(const std::string& text, TopoDS_Shape& out);
bool kernelReadBrep(const std::string& text, TopoDS_Shape& out);
std::string kernelExportStep(const TopoDS_Shape& shape, bool zUp);
std::string kernelExportBrep(const TopoDS_Shape& shape);
bool kernelTessellate(const TopoDS_Shape& shape, std::vector<double>& positions, double deflection = 0.12);
/**
 * Picture of an exact solid. Vertices stay unwelded and each corner keeps the
 * surface normal, so a curve lights smoothly and a sharp edge stays sharp.
 * `angular` <= 0 uses 0.32 rad (about 20 flats). Callers that know a side
 * count pass 2π/sides. Chord error stays the caller's `linear`.
 */
bool kernelTessellateIndexed(
  const TopoDS_Shape& shape,
  nlohmann::json& positions,
  nlohmann::json& normals,
  nlohmann::json& indices,
  double linear,
  double angular = 0.32
);
/** World-space polylines of real edges. Near-tangent seams are left out. */
nlohmann::json kernelDisplayEdges(const TopoDS_Shape& shape);
double kernelVolume(const TopoDS_Shape& shape);
double kernelArea(const TopoDS_Shape& shape);
nlohmann::json kernelFail(const std::string& message, bool fallback = true);
/**
 * BRepCheck validity gate for results we are about to hand back as exact
 * geometry. Shapes with more than maxFaces faces are assumed valid (the check
 * would cost more than the operation). A false here means "fall back", never
 * "ship it anyway" — silent-wrong geometry is the bug we are guarding against.
 */
bool kernelShapeIsValid(const TopoDS_Shape& shape, int maxFaces = 4000);
