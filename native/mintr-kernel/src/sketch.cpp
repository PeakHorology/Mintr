#include "sketch.hpp"
#include "occtio.hpp"

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepBuilderAPI_TransitionMode.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <GProp_GProps.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <Geom_BezierCurve.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

namespace {

gp_Pnt jsonPnt(const nlohmann::json& value) {
  if (value.is_array() && value.size() >= 3) {
    return gp_Pnt(value[0].get<double>(), value[1].get<double>(), value[2].get<double>());
  }
  return gp_Pnt(value.value("x", 0.0), value.value("y", 0.0), value.value("z", 0.0));
}

gp_Dir jsonDir(const nlohmann::json& value) {
  gp_Vec vec(jsonPnt(value).XYZ());
  if (vec.Magnitude() < 1e-12) return gp_Dir(0, 1, 0);
  return gp_Dir(vec);
}

gp_Pnt planeAt(const nlohmann::json& plane, double u, double v) {
  const gp_Pnt origin = jsonPnt(plane["origin"]);
  const gp_Vec uu(jsonDir(plane["uAxis"]));
  const gp_Vec vv(jsonDir(plane["vAxis"]));
  return origin.Translated(uu * u + vv * v);
}

bool wireFromLoop(const nlohmann::json& loop, const nlohmann::json& plane, TopoDS_Wire& wire) {
  const std::string kind = loop.value("kind", "wire");
  if (kind == "circle") {
    const gp_Pnt center = planeAt(plane, loop.value("cx", 0.0), loop.value("cz", 0.0));
    const gp_Circ circ(gp_Ax2(center, jsonDir(plane["normal"])), std::max(0.05, loop.value("radius", 1.0)));
    const TopoDS_Edge edge = BRepBuilderAPI_MakeEdge(circ).Edge();
    wire = BRepBuilderAPI_MakeWire(edge).Wire();
    return true;
  }
  BRepBuilderAPI_MakeWire maker;
  gp_Pnt start;
  if (loop.contains("start") && loop["start"].is_array() && loop["start"].size() >= 2) {
    start = planeAt(plane, loop["start"][0].get<double>(), loop["start"][1].get<double>());
  } else {
    return false;
  }
  gp_Pnt current = start;
  if (!loop.contains("steps") || !loop["steps"].is_array()) return false;
  for (const auto& step : loop["steps"]) {
    const std::string stepKind = step.value("kind", "line");
    const auto& toUv = step["to"];
    const gp_Pnt to = planeAt(plane, toUv[0].get<double>(), toUv[1].get<double>());
    if (current.Distance(to) < 1e-8) continue;
    if (stepKind == "arc" && step.contains("mid")) {
      const gp_Pnt mid = planeAt(plane, step["mid"][0].get<double>(), step["mid"][1].get<double>());
      GC_MakeArcOfCircle arc(current, mid, to);
      if (!arc.IsDone()) return false;
      maker.Add(BRepBuilderAPI_MakeEdge(arc.Value()).Edge());
    } else if (stepKind == "bezier" && step.contains("c1") && step.contains("c2")) {
      const gp_Pnt c1 = planeAt(plane, step["c1"][0].get<double>(), step["c1"][1].get<double>());
      const gp_Pnt c2 = planeAt(plane, step["c2"][0].get<double>(), step["c2"][1].get<double>());
      TColgp_Array1OfPnt poles(1, 4);
      poles.SetValue(1, current);
      poles.SetValue(2, c1);
      poles.SetValue(3, c2);
      poles.SetValue(4, to);
      Handle(Geom_BezierCurve) curve = new Geom_BezierCurve(poles);
      maker.Add(BRepBuilderAPI_MakeEdge(curve).Edge());
    } else {
      maker.Add(BRepBuilderAPI_MakeEdge(current, to).Edge());
    }
    current = to;
  }
  if (current.Distance(start) > 1e-6) maker.Add(BRepBuilderAPI_MakeEdge(current, start).Edge());
  if (!maker.IsDone()) return false;
  wire = maker.Wire();
  return true;
}

bool prismFromWire(const TopoDS_Wire& wire, const gp_Vec& dir, TopoDS_Shape& out) {
  const TopoDS_Face face = BRepBuilderAPI_MakeFace(wire, true).Face();
  if (face.IsNull()) return false;
  out = BRepPrimAPI_MakePrism(face, dir).Shape();
  return !out.IsNull();
}

bool pointInXzLoop(const nlohmann::json& loop, double x, double z) {
  std::vector<std::pair<double, double>> pts;
  if (loop.value("kind", "") == "circle") {
    const double cx = loop.value("cx", 0.0);
    const double cz = loop.value("cz", 0.0);
    const double r = loop.value("radius", 0.0);
    return (x - cx) * (x - cx) + (z - cz) * (z - cz) <= r * r;
  }
  if (loop.contains("start") && loop["start"].is_array()) {
    pts.emplace_back(loop["start"][0].get<double>(), loop["start"][1].get<double>());
  }
  if (loop.contains("steps")) {
    for (const auto& step : loop["steps"]) {
      if (step.contains("to") && step["to"].is_array()) {
        pts.emplace_back(step["to"][0].get<double>(), step["to"][1].get<double>());
      }
    }
  }
  bool inside = false;
  // Even-odd ray cast over consecutive edges (i, j = i-1). The previous loop
  // paired vertex i with vertex n-1-i — chords, not edges — so every chord was
  // visited twice, parity cancelled, and wire loops never counted as "inside".
  const size_t count = pts.size();
  if (count < 3) return false;
  for (size_t i = 0, j = count - 1; i < count; j = i++) {
    const double xi = pts[i].first;
    const double zi = pts[i].second;
    const double xj = pts[j].first;
    const double zj = pts[j].second;
    const bool hit = ((zi > z) != (zj > z)) && (x < (xj - xi) * (z - zi) / ((zj - zi) + 1e-18) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

nlohmann::json okShape(const TopoDS_Shape& shape) {
  if (!kernelShapeIsValid(shape)) {
    return kernelFail("native sketch solid failed validation", true);
  }
  nlohmann::json positions, normals, indices;
  if (!kernelTessellateIndexed(shape, positions, normals, indices, 0.12)) {
    return kernelFail("native tessellation failed", true);
  }
  return {
    { "ok", true },
    { "positions", positions },
    { "normals", normals },
    { "indices", indices },
    { "cadBrep", kernelExportBrep(shape) },
    { "brepStep", kernelExportStep(shape, false) },
    { "quality", "exact" },
  };
}

gp_Pnt jsonPlaced(const nlohmann::json& value) {
  return jsonPnt(value);
}

bool edgeFromPlaced(const nlohmann::json& edge, TopoDS_Edge& out) {
  const std::string kind = edge.value("kind", "line");
  const gp_Pnt from = jsonPlaced(edge["from"]);
  const gp_Pnt to = jsonPlaced(edge["to"]);
  if (kind == "arc" && edge.contains("mid")) {
    GC_MakeArcOfCircle arc(from, jsonPlaced(edge["mid"]), to);
    if (!arc.IsDone()) return false;
    out = BRepBuilderAPI_MakeEdge(arc.Value()).Edge();
    return true;
  }
  if (kind == "bezier" && edge.contains("c1") && edge.contains("c2")) {
    TColgp_Array1OfPnt poles(1, 4);
    poles.SetValue(1, from);
    poles.SetValue(2, jsonPlaced(edge["c1"]));
    poles.SetValue(3, jsonPlaced(edge["c2"]));
    poles.SetValue(4, to);
    Handle(Geom_BezierCurve) curve = new Geom_BezierCurve(poles);
    out = BRepBuilderAPI_MakeEdge(curve).Edge();
    return true;
  }
  if (from.Distance(to) < 1e-8) return false;
  out = BRepBuilderAPI_MakeEdge(from, to).Edge();
  return true;
}

bool wireFromPlaced(const nlohmann::json& loop, bool closed, TopoDS_Wire& wire) {
  if (loop.contains("circle") && loop["circle"].is_object()) {
    const auto& circle = loop["circle"];
    const gp_Pnt center = jsonPlaced(circle["center"]);
    gp_Dir axis = jsonDir(circle.contains("axis") ? circle["axis"] : nlohmann::json::array({ 0, 1, 0 }));
    const gp_Circ circ(gp_Ax2(center, axis), std::max(0.05, circle.value("radius", 1.0)));
    wire = BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(circ).Edge()).Wire();
    return true;
  }
  if (!loop.contains("edges") || !loop["edges"].is_array() || loop["edges"].empty()) return false;
  BRepBuilderAPI_MakeWire maker;
  for (const auto& edge : loop["edges"]) {
    TopoDS_Edge built;
    if (!edgeFromPlaced(edge, built)) return false;
    maker.Add(built);
  }
  if (!maker.IsDone()) return false;
  wire = maker.Wire();
  (void)closed;
  return true;
}

// A capped solid. The plain pipe (BRepOffsetAPI_MakePipe) builds only the walls, so the part was an
// open skin. Sharp bends become a rounded joint: the mitred and "transformed" joints build an invalid
// corner or silently drop the leg after it. Matches sweepWires in apps/web/src/lib/sketchSweep.ts.
bool pipeSolid(const TopoDS_Wire& profile, const TopoDS_Wire& path, TopoDS_Shape& out) {
  BRepOffsetAPI_MakePipeShell pipe(path);
  pipe.SetTransitionMode(BRepBuilderAPI_RoundCorner);
  pipe.Add(profile, false, true);
  pipe.Build();
  if (!pipe.IsDone() || !pipe.MakeSolid()) return false;
  out = pipe.Shape();
  if (out.IsNull() || !BRepCheck_Analyzer(out).IsValid()) return false;
  GProp_GProps props;
  BRepGProp::VolumeProperties(out, props);
  return std::abs(props.Mass()) > 1e-6;
}

} // namespace

nlohmann::json handleSketchExtrude(const nlohmann::json& job) {
  if (!job.contains("plane") || !job.contains("loops") || !job["loops"].is_array() || job["loops"].empty()) {
    return kernelFail("native sketch extrude is missing loops", true);
  }
  const double distance = std::max(0.05, job.value("distance", 1.0));
  const bool cutIntoFace = job.value("cutIntoFace", false);
  const nlohmann::json& plane = job["plane"];
  const gp_Vec dir(jsonDir(plane["normal"]));
  const auto& loops = job["loops"];
  TopoDS_Shape acc;
  bool have = false;
  for (size_t i = 0; i < loops.size(); ++i) {
    TopoDS_Wire wire;
    if (!wireFromLoop(loops[i], plane, wire)) continue;
    TopoDS_Shape prism;
    if (!prismFromWire(wire, dir * distance, prism)) continue;
    int depth = 0;
    double sampleX = loops[i].value("cx", 0.0);
    double sampleZ = loops[i].value("cz", 0.0);
    if (loops[i].contains("start") && loops[i]["start"].is_array()) {
      sampleX = loops[i]["start"][0].get<double>();
      sampleZ = loops[i]["start"][1].get<double>();
    }
    for (size_t j = 0; j < i; ++j) {
      if (pointInXzLoop(loops[j], sampleX, sampleZ)) depth += 1;
    }
    if (!have) {
      acc = prism;
      have = true;
      continue;
    }
    if (depth % 2 == 1) {
      BRepAlgoAPI_Cut cut(acc, prism);
      cut.SetRunParallel(true);
      cut.Build();
      if (!cut.IsDone()) return kernelFail("native sketch hole cut failed", true);
      acc = cut.Shape();
    } else {
      BRepAlgoAPI_Fuse fuse(acc, prism);
      fuse.SetRunParallel(true);
      fuse.Build();
      if (!fuse.IsDone()) return kernelFail("native sketch fuse failed", true);
      acc = fuse.Shape();
    }
  }
  if (!have) return kernelFail("native sketch extrude built nothing", true);
  if (cutIntoFace) {
    const double overshoot = std::max(0.5, distance * 0.02);
    const double pull = std::max(0.0, distance - overshoot);
    gp_Trsf move;
    move.SetTranslation(dir * -pull);
    acc = BRepBuilderAPI_Transform(acc, move, true).Shape();
  }
  return okShape(kernelUnify(acc));
}

nlohmann::json handleSketchSweep(const nlohmann::json& job) {
  if (!job.contains("outer") || !job.contains("path")) {
    return kernelFail("native sketch sweep is missing profile or path", true);
  }
  TopoDS_Wire outer;
  TopoDS_Wire path;
  if (!wireFromPlaced(job["outer"], true, outer)) return kernelFail("native sweep profile failed", true);
  if (!wireFromPlaced(job["path"], job.value("pathClosed", false), path)) {
    return kernelFail("native sweep path failed", true);
  }
  TopoDS_Shape solid;
  if (!pipeSolid(outer, path, solid)) return kernelFail("Sweep could not follow that curve.", true);
  if (job.contains("hole") && job["hole"].is_object()) {
    // A hole that cannot be swept fails the sweep, so the part never comes back without it.
    TopoDS_Wire hole;
    TopoDS_Shape inner;
    if (!wireFromPlaced(job["hole"], true, hole) || !pipeSolid(hole, path, inner)) {
      return kernelFail("Sweep could not cut the hole in this outline.", true);
    }
    BRepAlgoAPI_Cut cut(solid, inner);
    cut.SetRunParallel(true);
    cut.Build();
    if (!cut.IsDone()) return kernelFail("Sweep could not cut the hole in this outline.", true);
    solid = cut.Shape();
  }
  return okShape(kernelUnify(solid));
}

nlohmann::json handleImportStep(const nlohmann::json& job) {
  const std::string text = job.value("step", job.value("text", ""));
  if (text.empty()) return kernelFail("STEP import is missing file text", true);
  TopoDS_Shape imported;
  if (!kernelReadStep(text, imported)) return kernelFail("Could not read STEP", false);
  gp_Trsf rot;
  rot.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0)), -90.0 * kKernelDeg);
  imported = BRepBuilderAPI_Transform(imported, rot, true).Shape();

  std::vector<TopoDS_Shape> solids;
  for (TopExp_Explorer exp(imported, TopAbs_SOLID); exp.More(); exp.Next()) {
    solids.push_back(exp.Current());
  }
  if (solids.empty()) solids.push_back(imported);

  const std::string stem = job.value("fileName", "Imported STEP");
  nlohmann::json bodies = nlohmann::json::array();
  const size_t total = solids.size();
  for (size_t i = 0; i < solids.size(); ++i) {
    const TopoDS_Shape& part = solids.size() > 1 ? solids[i] : imported;
    nlohmann::json positions, normals, indices;
    if (!kernelTessellateIndexed(part, positions, normals, indices, 0.25)) continue;
    std::string name = stem;
    if (solids.size() > 1) name += " " + std::to_string(i + 1);
    bodies.push_back({
      { "name", name },
      { "stepText", kernelExportStep(part, false) },
      { "positions", positions },
      { "normals", normals },
      { "indices", indices },
    });
    (void)total;
  }
  if (bodies.empty()) return kernelFail("STEP file has no solid geometry to import", false);
  return { { "ok", true }, { "bodies", bodies } };
}
