#include "split.hpp"
#include "occtio.hpp"
#include "primitives.hpp"

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <Bnd_Box.hxx>
#include <BRepBuilderAPI_TransitionMode.hxx>
#include <Standard_Failure.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Quaternion.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <cmath>
#include <string>
#include <utility>
#include <vector>

namespace {

constexpr double kPi = 3.14159265358979323846;

bool vecFromJson(const nlohmann::json& value, gp_XYZ& out) {
  if (!value.is_array() || value.size() < 3) return false;
  out.SetCoord(value[0].get<double>(), value[1].get<double>(), value[2].get<double>());
  return true;
}

bool unitDir(const gp_XYZ& raw, gp_Dir& out) {
  if (raw.Modulus() < 1e-9) return false;
  out = gp_Dir(raw);
  return true;
}

gp_Dir orthonormalU(const gp_Dir& axis) {
  gp_Vec u = std::abs(axis.Y()) > 0.9 ? gp_Vec(1, 0, 0) : gp_Vec(0, 1, 0);
  u = u.Crossed(gp_Vec(axis));
  if (u.Magnitude() < 1e-9) u = gp_Vec(1, 0, 0);
  return gp_Dir(u);
}

bool bboxOf(const TopoDS_Shape& shape, double& xmin, double& ymin, double& zmin, double& xmax, double& ymax, double& zmax) {
  Bnd_Box box;
  BRepBndLib::Add(shape, box);
  if (box.IsVoid()) return false;
  box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
  return true;
}

double spanAlong(const TopoDS_Shape& shape, const gp_Dir& axis) {
  double xmin, ymin, zmin, xmax, ymax, zmax;
  if (!bboxOf(shape, xmin, ymin, zmin, xmax, ymax, zmax)) return 0;
  const gp_XYZ corners[8] = {
    {xmin, ymin, zmin}, {xmax, ymin, zmin}, {xmin, ymax, zmin}, {xmax, ymax, zmin},
    {xmin, ymin, zmax}, {xmax, ymin, zmax}, {xmin, ymax, zmax}, {xmax, ymax, zmax},
  };
  double lo = 1e100;
  double hi = -1e100;
  for (const auto& corner : corners) {
    const double d = corner.Dot(axis.XYZ());
    lo = std::min(lo, d);
    hi = std::max(hi, d);
  }
  return std::max(0.0, hi - lo);
}

bool cutHalf(const TopoDS_Shape& solid, const gp_Pnt& origin, const gp_Dir& discard, double span, TopoDS_Shape& out) {
  const double size = std::max(40.0, span);
  TopoDS_Shape box = BRepPrimAPI_MakeBox(gp_Pnt(-size / 2, -size / 2, -0.02), gp_Pnt(size / 2, size / 2, size - 0.02)).Shape();
  gp_Trsf trsf;
  trsf.SetDisplacement(gp_Ax3(gp::XOY()), gp_Ax3(origin, discard));
  box = BRepBuilderAPI_Transform(box, trsf, true).Shape();
  BRepAlgoAPI_Cut cut(solid, box);
  cut.SetRunParallel(true);
  cut.SetFuzzyValue(0.04);
  cut.Build();
  if (!cut.IsDone()) return false;
  out = cut.Shape();
  return !out.IsNull();
}

TopoDS_Wire rectWire(double u0, double u1, double v0, double v1, double z) {
  BRepBuilderAPI_MakePolygon poly;
  poly.Add(gp_Pnt(u0, v0, z));
  poly.Add(gp_Pnt(u1, v0, z));
  poly.Add(gp_Pnt(u1, v1, z));
  poly.Add(gp_Pnt(u0, v1, z));
  poly.Close();
  return poly.Wire();
}

bool makeDovetail(double length, double root, double tip, double z0, double z1, TopoDS_Shape& out) {
  BRepOffsetAPI_ThruSections loft(true, true);
  loft.AddWire(rectWire(-length / 2, length / 2, -root / 2, root / 2, z0));
  loft.AddWire(rectWire(-length / 2, length / 2, -tip / 2, tip / 2, z1));
  loft.Build();
  if (!loft.IsDone()) return false;
  out = loft.Shape();
  return !out.IsNull();
}

bool makeHelixWire(const gp_Pnt& origin, const gp_Dir& axis, const gp_Dir& u, double radius, double pitch, double length, TopoDS_Wire& wire) {
  const int turns = std::max(1, static_cast<int>(std::ceil(length / std::max(0.15, pitch))));
  const int segs = std::max(32, turns * 24);
  BRepBuilderAPI_MakeWire maker;
  gp_Vec ax(axis);
  ax.Normalize();
  gp_Vec uu(u);
  uu.Normalize();
  gp_Vec vv = ax.Crossed(uu);
  if (vv.Magnitude() < 1e-9) return false;
  vv.Normalize();
  uu = vv.Crossed(ax);
  uu.Normalize();
  gp_Pnt prev;
  bool hasPrev = false;
  for (int i = 0; i <= segs; ++i) {
    const double t = static_cast<double>(i) / segs;
    const double z = t * length;
    const double ang = (z / pitch) * 2.0 * kPi;
    const gp_Pnt p = origin.Translated(ax * z + uu * (radius * std::cos(ang)) + vv * (radius * std::sin(ang)));
    if (hasPrev && p.Distance(prev) > 1e-8) maker.Add(BRepBuilderAPI_MakeEdge(prev, p).Edge());
    prev = p;
    hasPrev = true;
  }
  if (!maker.IsDone()) return false;
  wire = maker.Wire();
  return true;
}

bool makeThread(double radius, double z0, double length, bool female, double extra, TopoDS_Shape& out) {
  const double major = std::max(3.0, radius * 2.0 + extra * 2.0);
  const double pitch = std::max(0.5, std::min(2.5, major * 0.125));
  const double depth = std::min(std::max(0.12, 0.54 * pitch), major * 0.18);
  const gp_Ax2 ax(gp_Pnt(0, 0, z0), gp_Dir(0, 0, 1));
  const double coreR = std::max(0.4, major / 2.0 - (female ? 0.0 : depth * 0.55));
  TopoDS_Shape core = BRepPrimAPI_MakeCylinder(ax, coreR, length).Shape();
  TopoDS_Wire helix;
  if (!makeHelixWire(gp_Pnt(0, 0, z0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0), major / 2.0, pitch, length, helix)) {
    out = core;
    return true;
  }
  const double innerR = std::max(0.05, major / 2.0 - depth * 0.55);
  const double tipR = major / 2.0 + depth;
  const double half = std::min(pitch * 0.34, length * 0.4);
  BRepBuilderAPI_MakeWire profile;
  profile.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(innerR, 0, -half), gp_Pnt(tipR, 0, 0)).Edge());
  profile.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(tipR, 0, 0), gp_Pnt(innerR, 0, half)).Edge());
  profile.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(innerR, 0, half), gp_Pnt(innerR, 0, -half)).Edge());
  if (!profile.IsDone()) {
    out = core;
    return true;
  }
  TopoDS_Shape ridge;
  BRepOffsetAPI_MakePipeShell shell(helix);
  shell.SetDiscreteMode();
  shell.SetTransitionMode(BRepBuilderAPI_Transformed);
  shell.Add(profile.Wire(), false, true);
  shell.Build();
  if (shell.IsDone()) ridge = shell.Shape();
  else {
    BRepOffsetAPI_MakePipe pipe(helix, profile.Wire());
    pipe.Build();
    if (pipe.IsDone()) ridge = pipe.Shape();
  }
  if (ridge.IsNull()) {
    out = core;
    return true;
  }
  if (female) {
    BRepAlgoAPI_Fuse fuse(core, ridge);
    fuse.SetRunParallel(true);
    fuse.SetFuzzyValue(0.04);
    fuse.Build();
    out = fuse.IsDone() ? fuse.Shape() : core;
  } else {
    BRepAlgoAPI_Fuse fuse(core, ridge);
    fuse.SetRunParallel(true);
    fuse.SetFuzzyValue(0.04);
    fuse.Build();
    out = fuse.IsDone() ? fuse.Shape() : core;
  }
  return !out.IsNull();
}

bool makeJointTool(
  const std::string& joint,
  double radius,
  double depth,
  double embed,
  double length,
  double extra,
  bool male,
  TopoDS_Shape& out
) {
  const double z0 = male ? -embed : 0.0;
  const double z1 = depth + (male ? 0.0 : 0.4);
  if (joint == "dovetail") {
    const double root = radius * 1.5 + extra;
    const double tip = root * 1.45 + extra;
    return makeDovetail(length + extra * 2, root, tip, z0, z1, out);
  }
  if (joint == "snap") {
    const double shaftLen = (z1 - z0) * 0.72;
    TopoDS_Shape shaft = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, z0), gp_Dir(0, 0, 1)), radius + extra, shaftLen).Shape();
    TopoDS_Shape head = BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, z0 + shaftLen * 1.08), radius * 1.45 + extra).Shape();
    BRepAlgoAPI_Fuse fuse(shaft, head);
    fuse.SetRunParallel(true);
    fuse.SetFuzzyValue(0.04);
    fuse.Build();
    if (!fuse.IsDone()) return false;
    out = fuse.Shape();
    return true;
  }
  if (joint == "thread") {
    return makeThread(radius, z0, z1 - z0, !male, extra, out);
  }
  out = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, z0), gp_Dir(0, 0, 1)), radius + extra, z1 - z0).Shape();
  return !out.IsNull();
}

TopoDS_Shape placeLocal(const TopoDS_Shape& local, const gp_Pnt& origin, const gp_Dir& tangent, const gp_Dir& direction, double zShift) {
  gp_Trsf trsf;
  trsf.SetDisplacement(gp_Ax3(gp::XOY()), gp_Ax3(origin.Translated(gp_Vec(direction) * zShift), direction, tangent));
  return BRepBuilderAPI_Transform(local, trsf, true).Shape();
}

TopoDS_Shape orientCutFaceDown(const TopoDS_Shape& shape, const gp_Dir& outward) {
  gp_Trsf rot;
  const gp_Dir from = outward;
  const gp_Dir to(0, -1, 0);
  if (from.IsParallel(to, 1e-6)) {
    if (from.Dot(to) < 0) rot.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0)), kPi);
  } else {
    rot.SetRotation(gp_Quaternion(from, to));
  }
  TopoDS_Shape turned = BRepBuilderAPI_Transform(shape, rot, true).Shape();
  double xmin, ymin, zmin, xmax, ymax, zmax;
  if (!bboxOf(turned, xmin, ymin, zmin, xmax, ymax, zmax)) return turned;
  gp_Trsf shift;
  shift.SetTranslation(gp_Vec(0, -ymin, 0));
  return BRepBuilderAPI_Transform(turned, shift, true).Shape();
}

nlohmann::json packPart(
  const TopoDS_Shape& world,
  const std::string& name,
  double angular = 0.32,
  double xOverride = 1e100,
  double zOverride = 1e100
) {
  double xmin, ymin, zmin, xmax, ymax, zmax;
  if (!bboxOf(world, xmin, ymin, zmin, xmax, ymax, zmax)) return {};
  gp_Trsf move;
  move.SetTranslation(gp_Vec(-(xmin + xmax) / 2.0, -ymin, -(zmin + zmax) / 2.0));
  const TopoDS_Shape local = BRepBuilderAPI_Transform(world, move, true).Shape();
  nlohmann::json positions = nlohmann::json::array();
  nlohmann::json normals = nlohmann::json::array();
  nlohmann::json indices = nlohmann::json::array();
  if (!kernelTessellateIndexed(local, positions, normals, indices, 0.12, angular)) return {};
  nlohmann::json part = {
    { "name", name },
    { "positions", positions },
    { "normals", normals },
    { "brepStep", kernelExportStep(local, false) },
    { "x", std::isfinite(xOverride) && xOverride < 1e99 ? xOverride : (xmin + xmax) / 2.0 },
    { "z", std::isfinite(zOverride) && zOverride < 1e99 ? zOverride : (zmin + zmax) / 2.0 },
    { "elevation", ymin },
    { "width", std::max(0.01, xmax - xmin) },
    { "height", std::max(0.01, ymax - ymin) },
    { "depth", std::max(0.01, zmax - zmin) },
  };
  return part;
}

std::string sideName(const std::string& axis, bool positive) {
  if (axis == "x") return positive ? "Right" : "Left";
  if (axis == "y") return positive ? "Top" : "Bottom";
  return positive ? "Back" : "Front";
}

std::pair<std::string, std::string> jointLabels(const std::string& joint) {
  if (joint == "dovetail") return { "tail", "socket" };
  if (joint == "snap") return { "snap", "socket" };
  if (joint == "thread") return { "thread", "socket" };
  return { "plug", "socket" };
}

} // namespace

nlohmann::json handleSplit(const nlohmann::json& job) {
  if (!job.contains("solids") || !job["solids"].is_array()) {
    return kernelFail("native split needs a solid", true);
  }
  TopoDS_Shape solid;
  if (!assembleKernelShape(job["solids"], solid)) {
    return kernelFail("native split could not build the solid", true);
  }
  gp_XYZ originRaw;
  gp_XYZ normalRaw;
  if (!vecFromJson(job["origin"], originRaw) || !vecFromJson(job["normal"], normalRaw)) {
    return kernelFail("native split needs a cut plane", true);
  }
  gp_Dir normal;
  if (!unitDir(normalRaw, normal)) return kernelFail("native split needs a cut plane", true);
  const gp_Pnt origin(originRaw);
  double xmin, ymin, zmin, xmax, ymax, zmax;
  if (!bboxOf(solid, xmin, ymin, zmin, xmax, ymax, zmax)) return kernelFail("native split could not bound the solid", true);
  const double span = std::max({ xmax - xmin, ymax - ymin, zmax - zmin, 20.0 }) * 4.0 + 40.0;

  TopoDS_Shape negative;
  TopoDS_Shape positive;
  if (!cutHalf(solid, origin, normal, span, negative)) return kernelFail("native split failed", true);
  if (!cutHalf(solid, origin, gp_Dir(normal.Reversed()), span, positive)) return kernelFail("native split failed", true);

  const std::string joint = job.value("joint", "none");
  const std::string axis = job.value("axis", "x");
  const double angular = job.value("angularDeflection", 0.32);
  if (joint == "none" || joint.empty()) {
    const auto left = packPart(negative, sideName(axis, false), angular);
    const auto right = packPart(positive, sideName(axis, true), angular);
    if (left.empty() || right.empty()) return kernelFail("Move the line through the object. The cut has to cross it.", false);
    return { { "ok", true }, { "parts", nlohmann::json::array({ left, right }) } };
  }

  gp_Dir tangent = orthonormalU(normal);
  gp_Dir bitangent = gp_Dir(gp_Vec(normal).Crossed(gp_Vec(tangent)));
  const double face = std::min({
    spanAlong(positive, tangent),
    spanAlong(positive, bitangent),
    spanAlong(negative, tangent),
    spanAlong(negative, bitangent),
  });
  const double room = std::min(spanAlong(positive, normal), spanAlong(negative, normal));
  if (face < 6.0 || room < 4.0) {
    return kernelFail("Move the line. Each side needs room for the joint.", false);
  }
  const double radius = std::max(1.6, std::min(10.0, face * 0.16));
  const double depth = std::max(2.5, std::min(10.0, room * 0.45));
  const double embed = std::max(1.2, std::min(2.5, room * 0.25));
  const double length = std::max(8.0, std::min(28.0, face * 0.5));
  const double clearance = std::min(std::max(0.0, job.value("clearance", 0.2)), radius * 0.45);

  TopoDS_Shape maleTool;
  TopoDS_Shape femaleTool;
  if (!makeJointTool(joint, radius, depth, embed, length, 0.0, true, maleTool)) {
    return kernelFail("The joint did not fit that cut. Move the line or choose a smaller clearance.", false);
  }
  if (!makeJointTool(joint, radius, depth, embed, length, clearance, false, femaleTool)) {
    return kernelFail("The joint did not fit that cut. Move the line or choose a smaller clearance.", false);
  }
  const TopoDS_Shape maleWorldTool = placeLocal(maleTool, origin, tangent, gp_Dir(normal.Reversed()), 0.0);
  const TopoDS_Shape femaleWorldTool = placeLocal(femaleTool, origin, tangent, gp_Dir(normal.Reversed()), 0.35);

  BRepAlgoAPI_Fuse add(positive, maleWorldTool);
  add.SetRunParallel(true);
  add.SetFuzzyValue(0.04);
  add.Build();
  if (!add.IsDone()) return kernelFail("The joint did not fit that cut. Move the line or choose a smaller clearance.", false);
  BRepAlgoAPI_Cut sub(negative, femaleWorldTool);
  sub.SetRunParallel(true);
  sub.SetFuzzyValue(0.04);
  sub.Build();
  if (!sub.IsDone()) return kernelFail("The joint did not fit that cut. Move the line or choose a smaller clearance.", false);

  const TopoDS_Shape maleFlat = orientCutFaceDown(add.Shape(), gp_Dir(normal.Reversed()));
  const TopoDS_Shape femaleFlat = orientCutFaceDown(sub.Shape(), normal);
  const auto labels = jointLabels(joint);
  auto male = packPart(maleFlat, labels.first, angular);
  auto female = packPart(femaleFlat, labels.second, angular);
  if (male.empty() || female.empty()) {
    return kernelFail("The joint did not fit that cut. Move the line or choose a smaller clearance.", false);
  }
  const double gap = 8.0;
  male["x"] = -(male.value("width", 1.0) / 2.0 + gap / 2.0);
  female["x"] = female.value("width", 1.0) / 2.0 + gap / 2.0;
  male["z"] = 0.0;
  female["z"] = 0.0;
  male["elevation"] = 0.0;
  female["elevation"] = 0.0;
  return { { "ok", true }, { "parts", nlohmann::json::array({ male, female }) } };
}
