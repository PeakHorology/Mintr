#pragma once

#include <nlohmann/json.hpp>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>

#include <string>
#include <vector>

constexpr double kKernelPi = 3.14159265358979323846;
constexpr double kKernelDeg = kKernelPi / 180.0;

gp_Trsf kernelPoseTrsf(const nlohmann::json& solid, double height);
TopoDS_Shape kernelPlaced(const TopoDS_Shape& shape, const nlohmann::json& solid, double height);
/**
 * A true helix: a straight line on the unrolled cylinder, one smooth edge, as OCCT and
 * the browser kernel build it. Starts at origin + radius·u and climbs along axis.
 */
bool kernelHelixWire(const gp_Pnt& origin, const gp_Dir& axis, const gp_Dir& u, double radius, double pitch, double length, bool left, TopoDS_Wire& wire);
/** Tight bounds of a shape, without face tolerance. False for an empty shape. */
bool kernelBounds(const TopoDS_Shape& shape, double& xmin, double& ymin, double& zmin, double& xmax, double& ymax, double& zmax);
/** Sweep a closed profile along a helix into a solid (the browser's pipe, then a binormal shell). */
bool kernelSweepAlongHelix(const TopoDS_Wire& helix, const TopoDS_Wire& profile, const gp_Dir& axis, TopoDS_Shape& out);
/** The bodies of an assemble group, each placed on its own, for a STEP file that keeps them apart. */
bool kernelGroupParts(const nlohmann::json& group, std::vector<TopoDS_Shape>& parts);
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
struct KernelMeshOptions {
  /** Share corners within each face (the caller reads `indices`). Off for callers that read positions as loose triangles. */
  bool shareNodes = false;
  /** Mesh a copy so the caller's solid keeps no triangulation. */
  bool copyFirst = true;
  /** Coarsest angle the triangle-budget retries may reach. */
  double maxAngular = 0.5;
};
bool kernelTessellateIndexed(
  const TopoDS_Shape& shape,
  nlohmann::json& positions,
  nlohmann::json& normals,
  nlohmann::json& indices,
  double linear,
  double angular = 0.32,
  const KernelMeshOptions& options = KernelMeshOptions()
);
inline KernelMeshOptions sharedCorners() {
  KernelMeshOptions options;
  options.shareNodes = true;
  return options;
}
/** World-space polylines of real edges. Near-tangent seams are left out. */
nlohmann::json kernelDisplayEdges(const TopoDS_Shape& shape);
double kernelVolume(const TopoDS_Shape& shape);
double kernelArea(const TopoDS_Shape& shape);
enum class KernelBooleanOp { Fuse, Cut, Common };
/**
 * One boolean, built once, with every setting applied before it runs. It tries an exact
 * boolean first (as the browser kernel does), then a tolerance scaled to the parts, then
 * the old 0.04 mm, so a hard case still goes through and a clean one keeps fine detail.
 * The inputs are never changed (non-destructive), so a part used again stays as it was.
 * On failure `error`, when given, says why.
 */
bool kernelBoolean(KernelBooleanOp op, const TopoDS_Shape& base, const TopTools_ListOfShape& tools, TopoDS_Shape& out, std::string* error = nullptr);
bool kernelBoolean(KernelBooleanOp op, const TopoDS_Shape& base, const TopoDS_Shape& tool, TopoDS_Shape& out, std::string* error = nullptr);
nlohmann::json kernelFail(const std::string& message, bool fallback = true);
/**
 * BRepCheck validity gate for results we are about to hand back as exact
 * geometry. Shapes with more than maxFaces faces are assumed valid (the check
 * would cost more than the operation). A false here means "fall back", never
 * "ship it anyway" — silent-wrong geometry is the bug we are guarding against.
 */
bool kernelShapeIsValid(const TopoDS_Shape& shape, int maxFaces = 4000);
