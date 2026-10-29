#include "primitives.hpp"
#include "occtio.hpp"
#include "recipe.hpp"

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <GeomAPI_Interpolate.hxx>
#include <Geom_Ellipse.hxx>
#include <TColgp_HArray1OfPnt.hxx>
#include <gp_Circ.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <gp_Ax1.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include <BRepBuilderAPI_Copy.hxx>

#include <algorithm>
#include <cmath>
#include <list>
#include <mutex>
#include <utility>
#include <vector>

namespace {

constexpr double kEps = 5e-4;

bool nearly(double a, double b) {
  return std::abs(a - b) < kEps;
}

using Uv = std::pair<double, double>;

TopoDS_Face faceFromXz(const std::vector<Uv>& xz) {
  BRepBuilderAPI_MakePolygon poly;
  for (const auto& p : xz) poly.Add(gp_Pnt(p.first, 0, p.second));
  poly.Close();
  return BRepBuilderAPI_MakeFace(poly.Wire(), true).Face();
}

TopoDS_Face faceFromXy(const std::vector<Uv>& xy, const gp_Pnt& origin) {
  BRepBuilderAPI_MakePolygon poly;
  for (const auto& p : xy) poly.Add(gp_Pnt(origin.X() + p.first, origin.Y() + p.second, origin.Z()));
  poly.Close();
  return BRepBuilderAPI_MakeFace(poly.Wire(), true).Face();
}

TopoDS_Shape prism(const TopoDS_Shape& profile, const gp_Vec& dir) {
  return BRepPrimAPI_MakePrism(profile, dir).Shape();
}

TopoDS_Shape centerOnY(const TopoDS_Shape& shape, double height) {
  gp_Trsf move;
  move.SetTranslation(gp_Vec(0, -height / 2.0, 0));
  return BRepBuilderAPI_Transform(shape, move, true).Shape();
}

TopoDS_Shape ellipseAlongY(double rx, double rz, double height) {
  const double major = std::max(rx, rz);
  const double minor = std::max(1e-6, std::min(rx, rz));
  gp_Ax2 ax(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0), rx >= rz ? gp_Dir(1, 0, 0) : gp_Dir(0, 0, 1));
  Handle(Geom_Ellipse) ellipse = new Geom_Ellipse(ax, major, minor);
  const TopoDS_Edge edge = BRepBuilderAPI_MakeEdge(ellipse).Edge();
  const TopoDS_Wire wire = BRepBuilderAPI_MakeWire(edge).Wire();
  const TopoDS_Face face = BRepBuilderAPI_MakeFace(wire, true).Face();
  return prism(face, gp_Vec(0, height, 0));
}

bool cutShape(const TopoDS_Shape& a, const TopoDS_Shape& b, TopoDS_Shape& out) {
  return kernelBoolean(KernelBooleanOp::Cut, a, b, out);
}

bool extrudeXz(const std::vector<Uv>& xz, double height, TopoDS_Shape& out) {
  if (xz.size() < 3) return false;
  out = centerOnY(prism(faceFromXz(xz), gp_Vec(0, height, 0)), height);
  return true;
}

bool extrudeXy(const std::vector<Uv>& xy, double height, double depth, TopoDS_Shape& out) {
  if (xy.size() < 3) return false;
  out = centerOnY(prism(faceFromXy(xy, gp_Pnt(0, 0, -depth / 2)), gp_Vec(0, 0, depth)), height);
  return true;
}

bool buildLoopsSolid(const nlohmann::json& solid, double height, TopoDS_Shape& out) {
  if (!solid.contains("profileLoops") || !solid["profileLoops"].is_object()) return false;
  const auto& loops = solid["profileLoops"];
  if (!loops.contains("outer") || !loops["outer"].is_array()) return false;
  std::vector<Uv> outer;
  for (const auto& point : loops["outer"]) {
    if (!point.is_array() || point.size() < 2) continue;
    outer.emplace_back(point[0].get<double>(), point[1].get<double>());
  }
  if (!extrudeXz(outer, height, out)) return false;
  if (loops.contains("holes") && loops["holes"].is_array()) {
    for (const auto& hole : loops["holes"]) {
      std::vector<Uv> pts;
      for (const auto& point : hole) {
        if (!point.is_array() || point.size() < 2) continue;
        pts.emplace_back(point[0].get<double>(), point[1].get<double>());
      }
      TopoDS_Shape cavity;
      if (!extrudeXz(pts, height + 2, cavity)) continue;
      TopoDS_Shape cut;
      if (cutShape(out, cavity, cut)) out = cut;
    }
  }
  return true;
}

// True involute gear teeth, as the browser builds them (brepjs gear module,
// Apache-2.0): each flank is a spline through points on the involute, joined by
// a tip arc and a root arc, so the teeth are smooth curves, not short lines.
struct GearTeeth {
  double rPitch, rb, rTip, rRoot, alphaPitch, halfToothAngle, alphaTip, toothPitch;
  bool internal;
};

GearTeeth gearTeeth(int teeth, double module, double alpha, double backlashHalf, bool internal) {
  const double clearance = 0.25;
  GearTeeth g{};
  g.internal = internal;
  g.rPitch = teeth * module / 2.0;
  g.rb = g.rPitch * std::cos(alpha);
  g.rTip = internal ? g.rPitch - module : g.rPitch + module;
  g.rRoot = internal ? g.rPitch + module * (1.0 + clearance) : g.rPitch - module * (1.0 + clearance);
  g.halfToothAngle = (kKernelPi / 2.0) / teeth + (internal ? 1.0 : -1.0) * backlashHalf / g.rPitch;
  const double rOuter = internal ? g.rRoot : g.rTip;
  g.alphaPitch = alpha;
  g.alphaTip = rOuter <= g.rb ? 0.0 : std::acos(std::min(1.0, g.rb / rOuter));
  g.toothPitch = 2.0 * kKernelPi / teeth;
  return g;
}

double involuteAngle(double alpha) { return std::tan(alpha) - alpha; }

gp_Pnt polarPoint(double radius, double angle) { return gp_Pnt(radius * std::cos(angle), radius * std::sin(angle), 0.0); }

std::vector<gp_Pnt> flankPoints(const GearTeeth& g, double theta0, int count, double sign) {
  std::vector<gp_Pnt> points;
  for (int i = 0; i <= count; ++i) {
    const double t = 0.5 - 0.5 * std::cos(static_cast<double>(i) / count * kKernelPi);
    const double alpha = t * g.alphaTip;
    points.push_back(polarPoint(g.rb / std::cos(alpha), theta0 + sign * involuteAngle(alpha)));
  }
  return points;
}

bool splineEdge(const std::vector<gp_Pnt>& points, double tolerance, BRepBuilderAPI_MakeWire& wire) {
  Handle(TColgp_HArray1OfPnt) array = new TColgp_HArray1OfPnt(1, static_cast<int>(points.size()));
  for (size_t i = 0; i < points.size(); ++i) array->SetValue(static_cast<int>(i) + 1, points[i]);
  GeomAPI_Interpolate interpolate(array, false, tolerance);
  interpolate.Perform();
  if (!interpolate.IsDone()) return false;
  wire.Add(BRepBuilderAPI_MakeEdge(interpolate.Curve()).Edge());
  return wire.IsDone();
}

bool arcEdge(const gp_Pnt& a, const gp_Pnt& middle, const gp_Pnt& b, BRepBuilderAPI_MakeWire& wire) {
  GC_MakeArcOfCircle arc(a, middle, b);
  if (!arc.IsDone()) return false;
  wire.Add(BRepBuilderAPI_MakeEdge(arc.Value()).Edge());
  return wire.IsDone();
}

bool gearToothWire(int teeth, double module, double alpha, double backlashHalf, bool internal, TopoDS_Wire& out) {
  if (teeth < 4 || module <= 0.0) return false;
  const GearTeeth g = gearTeeth(teeth, module, alpha, backlashHalf, internal);
  const int samples = std::max(16, static_cast<int>(std::lround(8.0 * std::sqrt(module))));
  const double tolerance = g.rPitch * 1e-5;
  // Flanks run from the base circle out to rOut; arcs close them at rOut and rIn.
  // On a ring gear the outline is the tooth spaces, so the outer arc sits at the
  // root and the inner one at the tips. (brepjs swaps these for a ring, which
  // makes its outline cross itself.)
  const double rOut = internal ? g.rRoot : g.rTip;
  const double rIn = internal ? g.rTip : g.rRoot;
  const bool bridge = g.rb > rIn;
  const double invPitch = involuteAngle(g.alphaPitch);
  BRepBuilderAPI_MakeWire wire;
  for (int i = 0; i < teeth; ++i) {
    const double center = i * g.toothPitch;
    const double nextCenter = ((i + 1) % teeth) * g.toothPitch;
    const double thetaLeft = center - g.halfToothAngle - invPitch;
    const double thetaRight = center + g.halfToothAngle + invPitch;
    const std::vector<gp_Pnt> left = flankPoints(g, thetaLeft, samples, 1.0);
    std::vector<gp_Pnt> right = flankPoints(g, thetaRight, samples, -1.0);
    std::reverse(right.begin(), right.end());
    if (bridge) wire.Add(BRepBuilderAPI_MakeEdge(polarPoint(rIn, thetaLeft), left.front()).Edge());
    if (!splineEdge(left, tolerance, wire)) return false;
    if (!arcEdge(left.back(), polarPoint(rOut, center), right.front(), wire)) return false;
    if (!splineEdge(right, tolerance, wire)) return false;
    if (bridge) wire.Add(BRepBuilderAPI_MakeEdge(right.back(), polarPoint(rIn, thetaRight)).Edge());
    const double rootEnd = nextCenter - g.halfToothAngle - invPitch;
    double middle = 0.5 * (thetaRight + rootEnd);
    if (rootEnd < thetaRight) middle += kKernelPi;
    const gp_Pnt from = bridge ? polarPoint(rIn, thetaRight) : right.back();
    const gp_Pnt to = bridge ? polarPoint(rIn, rootEnd) : polarPoint(g.rb, rootEnd);
    if (!arcEdge(from, polarPoint(rIn, middle), to, wire)) return false;
  }
  if (!wire.IsDone()) return false;
  out = wire.Wire();
  return true;
}

TopoDS_Wire circleWire(double radius) {
  const gp_Circ circle(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), radius);
  return BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(circle).Edge()).Wire();
}

// A spur or ring gear lying on XY, extruded up Z, then stood up and centred on Y
// like every other primitive. False when the spec cannot make a gear.
bool buildInvoluteGear(const nlohmann::json& spec, double height, TopoDS_Shape& out) {
  const std::string form = spec.value("form", "spur");
  if (form != "spur" && form != "ring") return false;
  const int teeth = spec.value("teeth", 0);
  const double module = spec.value("module", 0.0);
  const double alpha = spec.value("pressureAngle", 20.0) * kKernelPi / 180.0;
  const double backlashHalf = spec.value("backlash", 0.0) / 2.0;
  TopoDS_Wire toothed;
  if (!gearToothWire(teeth, module, alpha, backlashHalf, form == "ring", toothed)) return false;
  TopoDS_Shape gear;
  if (form == "ring") {
    const double wall = module * 1.25 + spec.value("rim", 0.0);
    // The ring is a disc with the toothed shape cut through it.
    BRepBuilderAPI_MakeFace disc(circleWire(teeth * module / 2.0 + wall), true);
    BRepBuilderAPI_MakeFace inner(toothed, true);
    if (!disc.IsDone() || !inner.IsDone()) return false;
    const TopoDS_Shape outer = BRepPrimAPI_MakePrism(disc.Face(), gp_Vec(0, 0, height)).Shape();
    TopoDS_Shape cavity = BRepPrimAPI_MakePrism(inner.Face(), gp_Vec(0, 0, height + 1.0)).Shape();
    gp_Trsf down;
    down.SetTranslation(gp_Vec(0, 0, -0.5));
    cavity = BRepBuilderAPI_Transform(cavity, down, true).Shape();
    if (!cutShape(outer, cavity, gear)) return false;
  } else {
    BRepBuilderAPI_MakeFace face(toothed, true);
    if (!face.IsDone()) return false;
    gear = BRepPrimAPI_MakePrism(face.Face(), gp_Vec(0, 0, height)).Shape();
    const double bore = spec.value("bore", 0.0);
    if (bore > 0.0) {
      const GearTeeth g = gearTeeth(teeth, module, alpha, backlashHalf, false);
      if (bore >= 2.0 * g.rRoot) return false;
      BRepBuilderAPI_MakeFace boreFace(circleWire(bore / 2.0), true);
      if (!boreFace.IsDone()) return false;
      TopoDS_Shape boreSolid = BRepPrimAPI_MakePrism(boreFace.Face(), gp_Vec(0, 0, height + 1.0)).Shape();
      gp_Trsf down;
      down.SetTranslation(gp_Vec(0, 0, -0.5));
      boreSolid = BRepBuilderAPI_Transform(boreSolid, down, true).Shape();
      TopoDS_Shape bored;
      if (!cutShape(gear, boreSolid, bored)) return false;
      gear = bored;
    }
  }
  gp_Trsf stand;
  stand.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0)), -kKernelPi / 2.0);
  gp_Trsf lower;
  lower.SetTranslation(gp_Vec(0, -height / 2.0, 0));
  out = BRepBuilderAPI_Transform(gear, lower * stand, true).Shape();
  return !out.IsNull() && kernelShapeIsValid(out);
}

bool filletAll(TopoDS_Shape& shape, double radius) {
  if (radius <= 1e-6) return true;
  BRepFilletAPI_MakeFillet fillet(shape);
  for (TopExp_Explorer exp(shape, TopAbs_EDGE); exp.More(); exp.Next()) {
    fillet.Add(radius, TopoDS::Edge(exp.Current()));
  }
  fillet.Build();
  if (!fillet.IsDone()) return false;
  shape = fillet.Shape();
  return true;
}

bool buildPrimitiveLocal(const nlohmann::json& solid, TopoDS_Shape& out) {
  const std::string kind = solid.value("kind", "");
  const double width = solid.value("width", 0.0);
  const double depth = solid.value("depth", width);
  const double height = solid.value("height", 0.0);
  if (width <= 1e-6 || depth <= 1e-6 || height <= 1e-6) return false;

  if (kind == "box") {
    out = BRepPrimAPI_MakeBox(gp_Pnt(-width / 2, -height / 2, -depth / 2), width, height, depth).Shape();
    const double radius = solid.value("radius", 0.0);
    if (radius > 1e-6) {
      const double maxR = std::min({ width, height, depth }) / 2 - 1e-4;
      filletAll(out, std::min(radius, std::max(1e-4, maxR)));
    }
    return true;
  }

  if (kind == "cylinder") {
    if (nearly(width, depth)) {
      gp_Ax2 ax(gp_Pnt(0, -height / 2, 0), gp_Dir(0, 1, 0));
      out = BRepPrimAPI_MakeCylinder(ax, width / 2, height).Shape();
      return true;
    }
    out = centerOnY(ellipseAlongY(width / 2, depth / 2, height), height);
    return true;
  }

  if (kind == "sphere") {
    const double rx = width / 2;
    const double ry = height / 2;
    const double rz = depth / 2;
    // A round sphere stays a true sphere (as in the browser); only a stretched one is scaled.
    if (nearly(rx, ry) && nearly(ry, rz)) out = BRepPrimAPI_MakeSphere(rx).Shape();
    else out = kernelScale(BRepPrimAPI_MakeSphere(1.0).Shape(), rx, ry, rz);
    return true;
  }

  if (kind == "cone") {
    const double baseR = std::max(1e-6, solid.value("baseRadius", width / 2));
    const double topR = std::max(0.0, solid.value("topRadius", 0.0));
    const double maxR = std::max({ baseR, topR, 1e-6 });
    gp_Ax2 ax(gp_Pnt(0, -height / 2, 0), gp_Dir(0, 1, 0));
    if (nearly(baseR, topR)) out = BRepPrimAPI_MakeCylinder(ax, baseR, height).Shape();
    else out = BRepPrimAPI_MakeCone(ax, baseR, topR, height).Shape();
    out = kernelScale(out, (width / 2) / maxR, 1.0, (depth / 2) / maxR);
    return true;
  }

  if (kind == "pyramid") {
    const int sides = std::max(3, solid.value("sides", 4));
    BRepBuilderAPI_MakePolygon poly;
    if (sides == 4) {
      const double w = width / 2;
      const double d = depth / 2;
      poly.Add(gp_Pnt(-w, 0, -d));
      poly.Add(gp_Pnt(w, 0, -d));
      poly.Add(gp_Pnt(w, 0, d));
      poly.Add(gp_Pnt(-w, 0, d));
    } else {
      const double radius = std::min(width, depth) / 2;
      // First corner on +Z, as the viewport and the browser draw it.
      for (int i = 0; i < sides; ++i) {
        const double a = kKernelPi / 2.0 + (2.0 * kKernelPi * i) / sides;
        poly.Add(gp_Pnt(std::cos(a) * radius, 0, std::sin(a) * radius));
      }
    }
    poly.Close();
    BRepOffsetAPI_ThruSections loft(true, true);
    loft.AddWire(poly.Wire());
    loft.AddVertex(BRepBuilderAPI_MakeVertex(gp_Pnt(0, height, 0)).Vertex());
    loft.Build();
    if (!loft.IsDone()) return false;
    out = centerOnY(loft.Shape(), height);
    return true;
  }

  if (kind == "wedge") {
    const double w = width / 2;
    return extrudeXy({ { -w, 0 }, { w, 0 }, { w, height } }, height, depth, out);
  }

  if (kind == "roof") {
    const double w = width / 2;
    const double ridgeX = solid.value("ridgeX", 0.0);
    return extrudeXy({ { -w, 0 }, { w, 0 }, { ridgeX, height } }, height, depth, out);
  }

  if (kind == "roundRoof") {
    // Half-oval at the final width and height. A later non-uniform scale turns
    // the arch into a general surface and fillet/chamfer refuse the corners.
    // The ellipse seam stays off the flat face: a wide arch uses the upper
    // half directly, a tall arch rotates that half up so the join sits on the crown.
    const double rx = width / 2.0;
    const double ry = height;
    const double major = std::max(rx, ry);
    const double minor = std::max(1e-6, std::min(rx, ry));
    const bool tall = ry > rx + 1e-9;
    const gp_Pnt origin(0, 0, -depth / 2.0);
    const gp_Ax2 ax(origin, gp_Dir(0, 0, 1), gp_Dir(1, 0, 0));
    Handle(Geom_Ellipse) ellipse = new Geom_Ellipse(ax, major, minor);
    const double u0 = tall ? -kKernelPi / 2.0 : 0.0;
    const double u1 = tall ? kKernelPi / 2.0 : kKernelPi;
    const TopoDS_Edge arc = BRepBuilderAPI_MakeEdge(new Geom_TrimmedCurve(ellipse, u0, u1)).Edge();
    const TopoDS_Edge chord = BRepBuilderAPI_MakeEdge(ellipse->Value(u1), ellipse->Value(u0)).Edge();
    BRepBuilderAPI_MakeWire wire;
    wire.Add(arc);
    wire.Add(chord);
    if (!wire.IsDone()) return false;
    BRepBuilderAPI_MakeFace face(wire.Wire(), true);
    if (!face.IsDone()) return false;
    TopoDS_Shape solid = prism(face.Face(), gp_Vec(0, 0, depth));
    if (tall) {
      gp_Trsf rot;
      rot.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), kKernelPi / 2.0);
      solid = BRepBuilderAPI_Transform(solid, rot, true).Shape();
    }
    out = centerOnY(solid, height);
    return !out.IsNull();
  }

  if (kind == "halfSphere") {
    const double rx = width / 2;
    const double ry = height;
    const double rz = depth / 2;
    TopoDS_Shape ball = nearly(rx, ry) && nearly(ry, rz)
      ? BRepPrimAPI_MakeSphere(rx).Shape()
      : kernelScale(BRepPrimAPI_MakeSphere(1.0).Shape(), rx, ry, rz);
    const TopoDS_Shape cutter = BRepPrimAPI_MakeBox(
      gp_Pnt(-rx * 2, -ry * 2, -rz * 2),
      rx * 4,
      ry * 2,
      rz * 4
    ).Shape();
    if (!cutShape(ball, cutter, out)) return false;
    out = centerOnY(out, height);
    return true;
  }

  if (kind == "torus") {
    const double maxTube = std::max(0.1, std::min(width, depth) / 2 - 0.2);
    const double tube = std::min(std::max(0.1, solid.value("radius", height / 2)), maxTube);
    const double major = std::max(0.2, std::min(width, depth) / 2 - tube);
    gp_Ax2 ax(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0));
    out = BRepPrimAPI_MakeTorus(ax, major, tube).Shape();
    const double outer = (major + tube) * 2;
    out = kernelScale(
      out,
      width / std::max(1e-6, outer),
      height / std::max(1e-6, tube * 2),
      depth / std::max(1e-6, outer)
    );
    return true;
  }

  if (kind == "tube" || kind == "ring") {
    const double outerX = width / 2;
    const double outerZ = depth / 2;
    const double thickness = std::min(
      std::max(0.1, solid.value("bevel", 4.0)),
      std::max(0.1, std::min(outerX, outerZ) - 0.1)
    );
    const double innerX = std::max(0.1, outerX - thickness);
    const double innerZ = std::max(0.1, outerZ - thickness);
    TopoDS_Shape outer;
    TopoDS_Shape inner;
    if (nearly(width, depth)) {
      gp_Ax2 ax(gp_Pnt(0, -height / 2, 0), gp_Dir(0, 1, 0));
      outer = BRepPrimAPI_MakeCylinder(ax, outerX, height).Shape();
      gp_Ax2 axInner(gp_Pnt(0, -(height + 2) / 2, 0), gp_Dir(0, 1, 0));
      inner = BRepPrimAPI_MakeCylinder(axInner, innerX, height + 2).Shape();
    } else {
      outer = centerOnY(ellipseAlongY(outerX, outerZ, height), height);
      inner = centerOnY(ellipseAlongY(innerX, innerZ, height + 2), height + 2);
    }
    return cutShape(outer, inner, out);
  }

  if (kind == "polygon") {
    const int sides = std::max(3, solid.value("sides", 6));
    // Same vertices as CylinderGeometry: first vertex on +Z, still counterclockwise.
    std::vector<Uv> pts;
    for (int i = 0; i < sides; ++i) {
      const double a = kKernelPi / 2.0 + (2.0 * kKernelPi * i) / sides;
      pts.emplace_back(std::cos(a), std::sin(a));
    }
    if (!extrudeXz(pts, height, out)) return false;
    out = kernelScale(out, width / 2, 1.0, depth / 2);
    return true;
  }

  if (kind == "gear") {
    if (solid.contains("gearSpec") && solid["gearSpec"].is_object() && buildInvoluteGear(solid["gearSpec"], height, out)) return true;
    return buildLoopsSolid(solid, height, out);
  }

  return false;
}

bool fuseOne(const TopoDS_Shape& a, const TopoDS_Shape& b, TopoDS_Shape& out) {
  return kernelBoolean(KernelBooleanOp::Fuse, a, b, out);
}

// Shapes read from STEP or BRep text, newest first. The same body comes back in
// request after request (every slider tick, every boolean preview), and reading the
// text is the slow part, so the last few are kept. The text itself is the key, compared
// in full, so a hit can never hand back the wrong body.
struct ReadShape {
  bool step;
  std::string text;
  TopoDS_Shape shape;
};
std::list<ReadShape> readShapes;
std::size_t readShapeBytes = 0;
std::mutex readShapesLock;
constexpr std::size_t kReadShapeEntries = 24;
constexpr std::size_t kReadShapeBytes = 96u * 1024u * 1024u;

bool readShapeText(const std::string& text, bool step, TopoDS_Shape& out) {
  {
    std::lock_guard<std::mutex> guard(readShapesLock);
    for (auto it = readShapes.begin(); it != readShapes.end(); ++it) {
      if (it->step != step || it->text.size() != text.size() || it->text != text) continue;
      readShapes.splice(readShapes.begin(), readShapes, it);
      // A copy, so later healing or tolerance fixes on this request never touch the kept one.
      out = BRepBuilderAPI_Copy(it->shape, true, false).Shape();
      return !out.IsNull();
    }
  }
  TopoDS_Shape read;
  if (!(step ? kernelReadStep(text, read) : kernelReadBrep(text, read)) || read.IsNull()) return false;
  if (text.size() <= kReadShapeBytes / 4) {
    std::lock_guard<std::mutex> guard(readShapesLock);
    readShapes.push_front({ step, text, read });
    readShapeBytes += text.size();
    while (readShapes.size() > kReadShapeEntries || readShapeBytes > kReadShapeBytes) {
      readShapeBytes -= readShapes.back().text.size();
      readShapes.pop_back();
    }
    out = BRepBuilderAPI_Copy(read, true, false).Shape();
    return !out.IsNull();
  }
  out = read;
  return true;
}

bool cutOne(const TopoDS_Shape& solid, const TopoDS_Shape& hole, TopoDS_Shape& out) {
  return kernelBoolean(KernelBooleanOp::Cut, solid, hole, out);
}

} // namespace

bool kernelFuseSolids(const std::vector<TopoDS_Shape>& solids, TopoDS_Shape& out) {
  if (solids.empty()) return false;
  TopoDS_Shape acc = solids[0];
  for (size_t i = 1; i < solids.size(); ++i) {
    TopoDS_Shape next;
    if (!fuseOne(acc, solids[i], next)) return false;
    acc = next;
  }
  out = acc;
  return !out.IsNull();
}

bool kernelCutHoles(const TopoDS_Shape& solid, const std::vector<TopoDS_Shape>& holes, TopoDS_Shape& out) {
  TopoDS_Shape acc = solid;
  for (const auto& hole : holes) {
    TopoDS_Shape next;
    if (!cutOne(acc, hole, next)) return false;
    acc = next;
  }
  out = acc;
  return !out.IsNull();
}

// A group is built the way the browser builds it: its children in the group's
// own frame, combined by the group's operation, then the group's pose. So a hole
// inside a group cuts only that group, and a tilted or mirrored group stays so.
bool buildKernelGroupLocal(const nlohmann::json& group, TopoDS_Shape& out) {
  std::vector<TopoDS_Shape> solids;
  std::vector<TopoDS_Shape> holes;
  for (const auto& child : group["children"]) {
    TopoDS_Shape shape;
    if (!buildKernelSolid(child, shape)) return false;
    if (child.value("hole", false)) holes.push_back(shape);
    else solids.push_back(shape);
  }
  const std::string op = group.value("op", "union");
  TopoDS_Shape acc;
  if (op == "intersect") {
    std::vector<TopoDS_Shape> all = solids;
    all.insert(all.end(), holes.begin(), holes.end());
    if (all.size() < 2) return false;
    acc = all[0];
    for (size_t i = 1; i < all.size(); ++i) {
      TopoDS_Shape shared;
      if (!kernelBoolean(KernelBooleanOp::Common, acc, all[i], shared)) return false;
      acc = shared;
    }
  } else {
    if (!kernelFuseSolids(solids, acc)) return false;
    if (op == "subtract" && !kernelCutHoles(acc, holes, acc)) return false;
    if (solids.size() + (op == "subtract" ? holes.size() : 0) >= 3) acc = kernelUnify(acc);
  }
  out = acc;
  return !out.IsNull();
}

bool kernelGroupParts(const nlohmann::json& group, std::vector<TopoDS_Shape>& parts) {
  const gp_Trsf pose = kernelPoseTrsf(group, 0.0);
  for (const auto& child : group["children"]) {
    if (child.value("hole", false)) continue;
    TopoDS_Shape shape;
    if (!buildKernelSolid(child, shape)) return false;
    parts.push_back(BRepBuilderAPI_Transform(shape, pose, true).Shape());
  }
  return !parts.empty();
}

bool buildKernelSolid(const nlohmann::json& solid, TopoDS_Shape& out) {
  if (solid.value("kind", "") == "group" && solid.contains("children") && solid["children"].is_array()) {
    TopoDS_Shape local;
    if (!buildKernelGroupLocal(solid, local)) return false;
    // A group's children sit on its floor, so its pose lifts by elevation only.
    out = BRepBuilderAPI_Transform(local, kernelPoseTrsf(solid, 0.0), true).Shape();
    return !out.IsNull();
  }
  if (solid.contains("brepStep") && solid["brepStep"].is_string()) {
    TopoDS_Shape imported;
    if (!readShapeText(solid["brepStep"].get<std::string>(), true, imported)) return false;
    const double height = solid.value("height", 0.0);
    out = kernelPlaced(kernelFitImportedLocal(imported, solid), solid, height > 1e-6 ? height : 0.0);
    return true;
  }
  if (solid.contains("cadBrep") && solid["cadBrep"].is_string()) {
    TopoDS_Shape imported;
    if (!readShapeText(solid["cadBrep"].get<std::string>(), false, imported)) return false;
    const double height = solid.value("height", 0.0);
    out = kernelPlaced(kernelFitImportedLocal(imported, solid), solid, height > 1e-6 ? height : 0.0);
    return true;
  }
  if (solid.value("kind", "") == "recipe" && solid.contains("recipe")) {
    // Generator body (Gridfinity) whose exact build is still pending on the JS side.
    TopoDS_Shape built;
    std::string error;
    if (!buildRecipeLocal(solid["recipe"], built, error)) return false;
    const double height = solid["recipe"].value("height", solid.value("height", 0.0));
    out = kernelPlaced(centerOnY(built, height), solid, height);
    return true;
  }
  TopoDS_Shape local;
  if (!buildPrimitiveLocal(solid, local)) return false;
  out = kernelPlaced(local, solid, solid.value("height", 0.0));
  return true;
}

bool assembleKernelShape(const nlohmann::json& solids, TopoDS_Shape& out) {
  if (!solids.is_array() || solids.empty()) return false;
  std::vector<TopoDS_Shape> bodies;
  std::vector<TopoDS_Shape> holes;
  for (const auto& item : solids) {
    TopoDS_Shape shape;
    if (!buildKernelSolid(item, shape)) return false;
    if (item.value("hole", false)) holes.push_back(shape);
    else bodies.push_back(shape);
  }
  if (bodies.empty()) return false;
  TopoDS_Shape acc;
  if (!kernelFuseSolids(bodies, acc)) return false;
  if (!kernelCutHoles(acc, holes, acc)) return false;
  out = kernelUnify(acc);
  return !out.IsNull();
}
