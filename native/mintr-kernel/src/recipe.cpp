#include "recipe.hpp"
#include "occtio.hpp"

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <Standard_Failure.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

namespace {

constexpr double kEps = 1e-6;
/** Fuzzy tolerance for recipe booleans: generator features are ≥ 0.7 mm apart. */
constexpr double kFuzzy = 0.02;

struct Section {
  double y = 0;
  double x0 = 0;
  double x1 = 0;
  double z0 = 0;
  double z1 = 0;
  double r[4] = { 0, 0, 0, 0 };
};

bool readSection(const nlohmann::json& json, Section& out) {
  if (!json.is_object()) return false;
  out.y = json.value("y", 0.0);
  out.x0 = json.value("x0", 0.0);
  out.x1 = json.value("x1", 0.0);
  out.z0 = json.value("z0", 0.0);
  out.z1 = json.value("z1", 0.0);
  if (out.x1 - out.x0 <= kEps || out.z1 - out.z0 <= kEps) return false;
  const double maxR = std::min((out.x1 - out.x0) / 2.0, (out.z1 - out.z0) / 2.0) - kEps;
  if (json.contains("r") && json["r"].is_array() && json["r"].size() >= 4) {
    for (int i = 0; i < 4; ++i) {
      out.r[i] = std::max(0.0, std::min(json["r"][i].get<double>(), maxR));
    }
  }
  return true;
}

bool sectionsEqual(const Section& a, const Section& b) {
  if (std::abs(a.x0 - b.x0) > kEps || std::abs(a.x1 - b.x1) > kEps) return false;
  if (std::abs(a.z0 - b.z0) > kEps || std::abs(a.z1 - b.z1) > kEps) return false;
  for (int i = 0; i < 4; ++i) {
    if (std::abs(a.r[i] - b.r[i]) > kEps) return false;
  }
  return true;
}

void addLine(BRepBuilderAPI_MakeWire& maker, const gp_Pnt& from, const gp_Pnt& to) {
  if (from.Distance(to) < 1e-9) return;
  maker.Add(BRepBuilderAPI_MakeEdge(from, to).Edge());
}

bool addArc(BRepBuilderAPI_MakeWire& maker, const gp_Pnt& from, const gp_Pnt& mid, const gp_Pnt& to) {
  GC_MakeArcOfCircle arc(from, mid, to);
  if (!arc.IsDone()) return false;
  maker.Add(BRepBuilderAPI_MakeEdge(arc.Value()).Edge());
  return true;
}

/**
 * Rounded rectangle in the XZ plane at height y. Corner order (x0,z0) → (x1,z0) →
 * (x1,z1) → (x0,z1); a zero radius leaves a sharp corner. Every section of a stack
 * must share the zero pattern so the ruled loft sees the same edge count.
 */
bool sectionWire(const Section& s, TopoDS_Wire& out) {
  const double k = std::sqrt(0.5);
  const double r00 = s.r[0];
  const double r10 = s.r[1];
  const double r11 = s.r[2];
  const double r01 = s.r[3];
  const double y = s.y;
  BRepBuilderAPI_MakeWire maker;
  gp_Pnt start(s.x0 + r00, y, s.z0);
  gp_Pnt cur = start;

  gp_Pnt next(s.x1 - r10, y, s.z0);
  addLine(maker, cur, next);
  cur = next;
  if (r10 > kEps) {
    next = gp_Pnt(s.x1, y, s.z0 + r10);
    if (!addArc(maker, cur, gp_Pnt(s.x1 - r10 + r10 * k, y, s.z0 + r10 - r10 * k), next)) return false;
    cur = next;
  }
  next = gp_Pnt(s.x1, y, s.z1 - r11);
  addLine(maker, cur, next);
  cur = next;
  if (r11 > kEps) {
    next = gp_Pnt(s.x1 - r11, y, s.z1);
    if (!addArc(maker, cur, gp_Pnt(s.x1 - r11 + r11 * k, y, s.z1 - r11 + r11 * k), next)) return false;
    cur = next;
  }
  next = gp_Pnt(s.x0 + r01, y, s.z1);
  addLine(maker, cur, next);
  cur = next;
  if (r01 > kEps) {
    next = gp_Pnt(s.x0, y, s.z1 - r01);
    if (!addArc(maker, cur, gp_Pnt(s.x0 + r01 - r01 * k, y, s.z1 - r01 + r01 * k), next)) return false;
    cur = next;
  }
  next = gp_Pnt(s.x0, y, s.z0 + r00);
  addLine(maker, cur, next);
  cur = next;
  if (r00 > kEps) {
    if (!addArc(maker, cur, gp_Pnt(s.x0 + r00 - r00 * k, y, s.z0 + r00 - r00 * k), start)) return false;
  } else {
    addLine(maker, cur, start);
  }
  if (!maker.IsDone()) return false;
  out = maker.Wire();
  return true;
}

bool buildStack(const nlohmann::json& json, TopoDS_Shape& out, std::string& error) {
  if (!json.contains("sections") || !json["sections"].is_array() || json["sections"].size() < 2) {
    error = "stack needs two sections";
    return false;
  }
  std::vector<Section> sections;
  for (const auto& item : json["sections"]) {
    Section s;
    if (!readSection(item, s)) {
      error = "stack section is degenerate";
      return false;
    }
    sections.push_back(s);
  }
  std::sort(sections.begin(), sections.end(), [](const Section& a, const Section& b) { return a.y < b.y; });
  const double height = sections.back().y - sections.front().y;
  if (height <= kEps) {
    error = "stack has no height";
    return false;
  }
  bool uniform = true;
  for (const auto& s : sections) {
    if (!sectionsEqual(s, sections.front())) {
      uniform = false;
      break;
    }
  }
  if (uniform) {
    TopoDS_Wire wire;
    if (!sectionWire(sections.front(), wire)) {
      error = "stack outline failed";
      return false;
    }
    const TopoDS_Face face = BRepBuilderAPI_MakeFace(wire, true).Face();
    if (face.IsNull()) {
      error = "stack face failed";
      return false;
    }
    out = BRepPrimAPI_MakePrism(face, gp_Vec(0, height, 0)).Shape();
    return !out.IsNull();
  }
  BRepOffsetAPI_ThruSections loft(true, true, 1e-6);
  loft.SetSmoothing(false);
  for (const auto& s : sections) {
    TopoDS_Wire wire;
    if (!sectionWire(s, wire)) {
      error = "stack section outline failed";
      return false;
    }
    loft.AddWire(wire);
  }
  loft.Build();
  if (!loft.IsDone()) {
    error = "stack loft failed";
    return false;
  }
  out = loft.Shape();
  return !out.IsNull();
}

bool buildPrism(const nlohmann::json& json, TopoDS_Shape& out, std::string& error) {
  const std::string axis = json.value("axis", "x");
  const double a0 = json.value("a0", 0.0);
  const double a1 = json.value("a1", 0.0);
  if (a1 - a0 <= kEps) {
    error = "prism has no length";
    return false;
  }
  if (!json.contains("start") || !json["start"].is_array() || json["start"].size() < 2
    || !json.contains("steps") || !json["steps"].is_array() || json["steps"].size() < 2) {
    error = "prism profile is incomplete";
    return false;
  }
  const bool alongX = axis == "x";
  const bool alongY = axis == "y";
  const auto point = [&](double u, double v) {
    if (alongX) return gp_Pnt(a0, v, u);
    if (alongY) return gp_Pnt(u, a0, v);
    return gp_Pnt(u, v, a0);
  };
  const auto uv = [&](const nlohmann::json& value) {
    return point(value[0].get<double>(), value[1].get<double>());
  };
  BRepBuilderAPI_MakeWire maker;
  const gp_Pnt start = uv(json["start"]);
  gp_Pnt cur = start;
  for (const auto& step : json["steps"]) {
    const gp_Pnt to = uv(step["to"]);
    if (step.value("kind", "line") == "arc" && step.contains("mid")) {
      if (!addArc(maker, cur, uv(step["mid"]), to)) {
        error = "prism arc failed";
        return false;
      }
    } else {
      addLine(maker, cur, to);
    }
    cur = to;
  }
  addLine(maker, cur, start);
  if (!maker.IsDone()) {
    error = "prism outline failed";
    return false;
  }
  const TopoDS_Face face = BRepBuilderAPI_MakeFace(maker.Wire(), true).Face();
  if (face.IsNull()) {
    error = "prism face failed";
    return false;
  }
  const gp_Vec dir = alongX ? gp_Vec(a1 - a0, 0, 0) : alongY ? gp_Vec(0, a1 - a0, 0) : gp_Vec(0, 0, a1 - a0);
  out = BRepPrimAPI_MakePrism(face, dir).Shape();
  return !out.IsNull();
}

bool buildPart(const nlohmann::json& solid, TopoDS_Shape& out, std::string& error) {
  const std::string kind = solid.value("kind", "");
  if (kind == "stack") return buildStack(solid, out, error);
  if (kind == "prism") return buildPrism(solid, out, error);
  if (kind == "cylinder") {
    const double y0 = solid.value("y0", 0.0);
    const double y1 = solid.value("y1", 0.0);
    const double r = solid.value("r", 0.0);
    if (y1 - y0 <= kEps || r <= kEps) {
      error = "cylinder is degenerate";
      return false;
    }
    gp_Ax2 ax(gp_Pnt(solid.value("cx", 0.0), y0, solid.value("cz", 0.0)), gp_Dir(0, 1, 0));
    out = BRepPrimAPI_MakeCylinder(ax, r, y1 - y0).Shape();
    return !out.IsNull();
  }
  if (kind == "cone") {
    const double y0 = solid.value("y0", 0.0);
    const double y1 = solid.value("y1", 0.0);
    const double r0 = std::max(0.0, solid.value("r0", 0.0));
    const double r1 = std::max(0.0, solid.value("r1", 0.0));
    if (y1 - y0 <= kEps || (r0 <= kEps && r1 <= kEps)) {
      error = "cone is degenerate";
      return false;
    }
    gp_Ax2 ax(gp_Pnt(solid.value("cx", 0.0), y0, solid.value("cz", 0.0)), gp_Dir(0, 1, 0));
    if (std::abs(r0 - r1) < kEps) out = BRepPrimAPI_MakeCylinder(ax, r0, y1 - y0).Shape();
    else out = BRepPrimAPI_MakeCone(ax, r0, r1, y1 - y0).Shape();
    return !out.IsNull();
  }
  if (kind == "box") {
    const gp_Pnt a(solid.value("x0", 0.0), solid.value("y0", 0.0), solid.value("z0", 0.0));
    const gp_Pnt b(solid.value("x1", 0.0), solid.value("y1", 0.0), solid.value("z1", 0.0));
    if (b.X() - a.X() <= kEps || b.Y() - a.Y() <= kEps || b.Z() - a.Z() <= kEps) {
      error = "box is degenerate";
      return false;
    }
    out = BRepPrimAPI_MakeBox(a, b).Shape();
    return !out.IsNull();
  }
  error = "unknown recipe solid: " + kind;
  return false;
}

bool fuseMany(const TopoDS_Shape& base, const TopTools_ListOfShape& tools, TopoDS_Shape& out) {
  BRepAlgoAPI_Fuse fuse;
  TopTools_ListOfShape args;
  args.Append(base);
  fuse.SetArguments(args);
  fuse.SetTools(tools);
  fuse.SetRunParallel(true);
  fuse.SetFuzzyValue(kFuzzy);
  fuse.Build();
  if (!fuse.IsDone()) return false;
  out = fuse.Shape();
  return !out.IsNull();
}

bool cutMany(const TopoDS_Shape& base, const TopTools_ListOfShape& tools, TopoDS_Shape& out) {
  BRepAlgoAPI_Cut cut;
  TopTools_ListOfShape args;
  args.Append(base);
  cut.SetArguments(args);
  cut.SetTools(tools);
  cut.SetRunParallel(true);
  cut.SetFuzzyValue(kFuzzy);
  cut.Build();
  if (!cut.IsDone()) return false;
  out = cut.Shape();
  return !out.IsNull();
}

} // namespace

bool buildRecipeLocal(const nlohmann::json& recipe, TopoDS_Shape& out, std::string& error) {
  if (!recipe.is_object() || !recipe.contains("ops") || !recipe["ops"].is_array() || recipe["ops"].empty()) {
    error = "recipe has no operations";
    return false;
  }
  const auto& ops = recipe["ops"];
  TopoDS_Shape acc;
  bool have = false;
  size_t index = 0;
  while (index < ops.size()) {
    const std::string op = ops[index].value("op", "add");
    // Batch consecutive ops of one kind into a single boolean pass.
    TopTools_ListOfShape tools;
    std::vector<TopoDS_Shape> parts;
    while (index < ops.size() && ops[index].value("op", "add") == op) {
      TopoDS_Shape part;
      if (!ops[index].contains("solid") || !buildPart(ops[index]["solid"], part, error)) {
        if (error.empty()) error = "recipe solid failed";
        return false;
      }
      parts.push_back(part);
      index += 1;
    }
    if (!have) {
      if (op != "add") {
        error = "recipe must start with a solid";
        return false;
      }
      acc = parts[0];
      have = true;
      for (size_t i = 1; i < parts.size(); ++i) tools.Append(parts[i]);
      if (!tools.IsEmpty() && !fuseMany(acc, tools, acc)) {
        error = "recipe fuse failed";
        return false;
      }
      continue;
    }
    for (const auto& part : parts) tools.Append(part);
    if (op == "add") {
      if (!fuseMany(acc, tools, acc)) {
        error = "recipe fuse failed";
        return false;
      }
    } else {
      if (!cutMany(acc, tools, acc)) {
        error = "recipe cut failed";
        return false;
      }
    }
  }
  if (!have || acc.IsNull()) {
    error = "empty recipe";
    return false;
  }
  out = kernelUnify(acc);
  return true;
}

nlohmann::json handleBuildRecipe(const nlohmann::json& job) {
  if (!job.contains("recipe")) return kernelFail("buildRecipe is missing its recipe", true);
  TopoDS_Shape shape;
  std::string error;
  try {
    if (!buildRecipeLocal(job["recipe"], shape, error)) {
      return kernelFail(error.empty() ? "recipe build failed" : error, true);
    }
  } catch (const Standard_Failure& failure) {
    return kernelFail(failure.what() ? failure.what() : "OCCT failed", true);
  }
  if (!kernelShapeIsValid(shape, 20000)) {
    return kernelFail("recipe body failed validation", true);
  }
  nlohmann::json positions, normals, indices;
  if (!kernelTessellateIndexed(shape, positions, normals, indices, 0.08)) {
    return kernelFail("native tessellation failed", true);
  }
  return {
    { "ok", true },
    { "positions", positions },
    { "normals", normals },
    { "indices", indices },
    { "cadBrep", kernelExportBrep(shape) },
    { "quality", "exact" },
    { "key", job.value("key", "") },
  };
}
