#include "fillet.hpp"
#include "primitives.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BOPAlgo_GlueEnum.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_GTransform.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepFeat_MakePrism.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <BRepLProp_SLProps.hxx>
#include <BRepLib_FindSurface.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepBuilderAPI_TransitionMode.hxx>
#include <BRepOffsetAPI_MakeOffsetShape.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <Extrema_ExtPS.hxx>
#include <GCPnts_QuasiUniformDeflection.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Plane.hxx>
#include <GeomAbs_CurveType.hxx>
#include <GeomAbs_JoinType.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Poly_Triangulation.hxx>
#include <STEPControl_Reader.hxx>
#include <ShapeFix_Shape.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Dir.hxx>
#include <gp_GTrsf.hxx>
#include <gp_Mat.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#include <gp_XYZ.hxx>

#include <algorithm>
#include <cmath>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#include <BRepOffset_Mode.hxx>

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kWireDeflection = 0.035;

struct PlanarFaceRecord {
  TopoDS_Face face;
  gp_Dir normal;
  gp_Pnt origin;
};

struct ModifierSession {
  TopoDS_Shape base;
  std::vector<TopoDS_Edge> edges;
  std::vector<TopoDS_Face> edgeFaces;
  std::vector<TopoDS_Face> cylinders;
  nlohmann::json cylinderFaces = nlohmann::json::array();
  std::vector<PlanarFaceRecord> planars;
  nlohmann::json planarFaces = nlohmann::json::array();
  TopoDS_Shape accumulated;
  bool live = false;
};

ModifierSession gSession;

nlohmann::json modifierFail(const std::string& message, bool fallback, int requestId) {
  return {
    { "ok", false },
    { "fallback", fallback },
    { "type", "error" },
    { "message", message },
    { "requestId", requestId },
    { "resetSession", !fallback },
  };
}

void applyRowMajor(TopoDS_Shape& shape, const nlohmann::json& transform) {
  if (!transform.is_array() || transform.size() < 12) return;
  const double m[12] = {
    transform[0].get<double>(), transform[1].get<double>(), transform[2].get<double>(), transform[3].get<double>(),
    transform[4].get<double>(), transform[5].get<double>(), transform[6].get<double>(), transform[7].get<double>(),
    transform[8].get<double>(), transform[9].get<double>(), transform[10].get<double>(), transform[11].get<double>(),
  };
  gp_Mat mat(m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]);
  gp_GTrsf gtrsf;
  gtrsf.SetVectorialPart(mat);
  gtrsf.SetTranslationPart(gp_XYZ(m[3], m[7], m[11]));
  shape = BRepBuilderAPI_GTransform(shape, gtrsf, true).Shape();
}

void orientYUp(TopoDS_Shape& shape) {
  gp_Trsf rot;
  rot.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0)), -90.0 * kPi / 180.0);
  shape = BRepBuilderAPI_Transform(shape, rot, true).Shape();
}

bool readStep(const std::string& text, TopoDS_Shape& out) {
  std::istringstream in(text);
  STEPControl_Reader reader;
  if (reader.ReadStream("mintr", in) != IFSelect_RetDone) return false;
  reader.TransferRoots();
  out = reader.OneShape();
  return !out.IsNull();
}

bool readBrep(const std::string& text, TopoDS_Shape& out) {
  std::istringstream in(text);
  BRep_Builder builder;
  BRepTools::Read(out, in, builder);
  return !out.IsNull();
}

void zeroModifierPose(nlohmann::json& solid) {
  solid["x"] = 0.0;
  solid["z"] = 0.0;
  solid["elevation"] = 0.0;
  solid["rotation"] = 0.0;
  solid["rotationX"] = 0.0;
  solid["rotationZ"] = 0.0;
  solid["mirrorX"] = false;
  solid["mirrorY"] = false;
  solid["mirrorZ"] = false;
  solid.erase("transform");
}

bool buildKernelPrimitiveLocal(const nlohmann::json& primitive, TopoDS_Shape& local) {
  nlohmann::json solid = primitive;
  zeroModifierPose(solid);
  return buildKernelSolid(solid, local);
}

bool buildPrimitive(const nlohmann::json& primitive, TopoDS_Shape& out) {
  const std::string kind = primitive.value("kind", "");
  TopoDS_Shape local;
  if (kind == "box") {
    const double width = primitive.value("width", 0.0);
    const double depth = primitive.value("depth", width);
    const double height = primitive.value("height", 0.0);
    if (width <= 1e-6 || depth <= 1e-6 || height <= 1e-6) return false;
    local = BRepPrimAPI_MakeBox(gp_Pnt(-width / 2, 0, -depth / 2), width, height, depth).Shape();
  } else if (kind == "cylinder") {
    const double radius = primitive.value("radius", 0.0);
    const double height = primitive.value("height", 0.0);
    if (radius > 1e-6 && height > 1e-6) {
      local = BRepPrimAPI_MakeCylinder(radius, height).Shape();
      orientYUp(local);
    } else if (!buildKernelPrimitiveLocal(primitive, local)) {
      return false;
    }
  } else if (kind == "cone") {
    const double baseR = primitive.value("baseRadius", 0.0);
    const double topR = primitive.value("topRadius", 0.0);
    const double height = primitive.value("height", 0.0);
    if (height <= 1e-6 || std::max(baseR, topR) <= 1e-6) return false;
    if (std::abs(baseR - topR) <= 1e-6) local = BRepPrimAPI_MakeCylinder(std::max(baseR, topR), height).Shape();
    else local = BRepPrimAPI_MakeCone(baseR, topR, height).Shape();
    orientYUp(local);
  } else if (!buildKernelPrimitiveLocal(primitive, local)) {
    return false;
  }
  if (primitive.contains("transform")) applyRowMajor(local, primitive["transform"]);
  out = local;
  return true;
}

bool reconstructPart(const nlohmann::json& part, TopoDS_Shape& out) {
  if (part.contains("primitive") && part["primitive"].is_object()) {
    return buildPrimitive(part["primitive"], out);
  }
  if (part.contains("brep") && part["brep"].is_string()) {
    if (!readBrep(part["brep"].get<std::string>(), out)) return false;
    if (part.contains("brepTransform")) applyRowMajor(out, part["brepTransform"]);
    return true;
  }
  if (part.contains("brepStep") && part["brepStep"].is_string()) {
    return readStep(part["brepStep"].get<std::string>(), out);
  }
  return false;
}

TopoDS_Shape unify(const TopoDS_Shape& shape) {
  try {
    ShapeUpgrade_UnifySameDomain tool(shape, true, true, true);
    tool.Build();
    return tool.Shape();
  } catch (...) {
    return shape;
  }
}

bool tessellatePreview(const TopoDS_Shape& shape, double linear, nlohmann::json& positions, nlohmann::json& normals, nlohmann::json& indices) {
  BRepMesh_IncrementalMesh mesh(shape, linear, false, 0.32, true);
  (void)mesh;
  positions = nlohmann::json::array();
  normals = nlohmann::json::array();
  indices = nlohmann::json::array();
  int next = 0;
  for (TopExp_Explorer exp(shape, TopAbs_FACE); exp.More(); exp.Next()) {
    const TopoDS_Face face = TopoDS::Face(exp.Current());
    TopLoc_Location loc;
    Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, loc);
    if (tri.IsNull()) continue;
    const gp_Trsf trsf = loc.Transformation();
    const bool reverse = face.Orientation() == TopAbs_REVERSED;
    for (int i = 1; i <= tri->NbTriangles(); ++i) {
      int n1, n2, n3;
      tri->Triangle(i).Get(n1, n2, n3);
      if (reverse) std::swap(n2, n3);
      const gp_Pnt a = tri->Node(n1).Transformed(trsf);
      const gp_Pnt b = tri->Node(n2).Transformed(trsf);
      const gp_Pnt c = tri->Node(n3).Transformed(trsf);
      gp_Vec ab(a, b);
      gp_Vec ac(a, c);
      gp_Vec normal = ab.Crossed(ac);
      if (normal.Magnitude() < 1e-12) continue;
      normal.Normalize();
      positions.push_back(a.X()); positions.push_back(a.Y()); positions.push_back(a.Z());
      positions.push_back(b.X()); positions.push_back(b.Y()); positions.push_back(b.Z());
      positions.push_back(c.X()); positions.push_back(c.Y()); positions.push_back(c.Z());
      for (int k = 0; k < 3; ++k) {
        normals.push_back(normal.X());
        normals.push_back(normal.Y());
        normals.push_back(normal.Z());
      }
      indices.push_back(next++);
      indices.push_back(next++);
      indices.push_back(next++);
    }
  }
  return positions.size() >= 9;
}

std::string toBrep(const TopoDS_Shape& shape) {
  std::ostringstream out;
  BRepTools::Write(shape, out);
  return out.str();
}

const char* surfaceTypeName(GeomAbs_SurfaceType type) {
  switch (type) {
    case GeomAbs_Plane: return "plane";
    case GeomAbs_Cylinder: return "cylinder";
    case GeomAbs_Cone: return "cone";
    case GeomAbs_Sphere: return "sphere";
    case GeomAbs_Torus: return "torus";
    case GeomAbs_BezierSurface: return "bezier";
    case GeomAbs_BSplineSurface: return "bspline";
    case GeomAbs_SurfaceOfRevolution: return "revolution";
    case GeomAbs_SurfaceOfExtrusion: return "extrusion";
    case GeomAbs_OffsetSurface: return "offset";
    default: return "unknown";
  }
}

const char* curveTypeName(GeomAbs_CurveType type) {
  switch (type) {
    case GeomAbs_Line: return "line";
    case GeomAbs_Circle: return "circle";
    case GeomAbs_Ellipse: return "ellipse";
    case GeomAbs_Hyperbola: return "hyperbola";
    case GeomAbs_Parabola: return "parabola";
    case GeomAbs_BezierCurve: return "bezier";
    case GeomAbs_BSplineCurve: return "bspline";
    default: return "unknown";
  }
}

bool faceNormalAt(const TopoDS_Face& face, const gp_Pnt& point, gp_Dir& normal) {
  try {
    BRepAdaptor_Surface adaptor(face, Standard_True);
    Extrema_ExtPS extrema(point, adaptor, 1e-4, 1e-4);
    if (!extrema.IsDone() || extrema.NbExt() < 1) return false;
    int best = 1;
    double bestDist = extrema.SquareDistance(1);
    for (int i = 2; i <= extrema.NbExt(); ++i) {
      const double dist = extrema.SquareDistance(i);
      if (dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    }
    Standard_Real u = 0;
    Standard_Real v = 0;
    extrema.Point(best).Parameter(u, v);
    BRepLProp_SLProps props(adaptor, u, v, 1, 1e-6);
    if (!props.IsNormalDefined()) return false;
    normal = props.Normal();
    if (face.Orientation() == TopAbs_REVERSED) normal.Reverse();
    return true;
  } catch (...) {
    return false;
  }
}

double dihedral(const gp_Dir& a, const gp_Dir& b) {
  const double dot = std::max(-1.0, std::min(1.0, a.XYZ().Dot(b.XYZ())));
  const double raw = std::acos(dot) * 180.0 / kPi;
  return std::min(raw, 180.0 - raw);
}

double faceArea(const TopoDS_Face& face) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(face, props);
  return std::abs(props.Mass());
}

nlohmann::json collectEdges(const TopoDS_Shape& shape, double sharpAngle, bool suppressDetail) {
  TopTools_IndexedDataMapOfShapeListOfShape map;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, map);
  nlohmann::json edges = nlohmann::json::array();
  nlohmann::json selectable = nlohmann::json::array();
  gSession.edges.clear();
  gSession.edgeFaces.clear();

  std::vector<double> areas;
  if (suppressDetail) {
    for (TopExp_Explorer exp(shape, TopAbs_FACE); exp.More(); exp.Next()) {
      areas.push_back(faceArea(TopoDS::Face(exp.Current())));
    }
  }
  double areaLimit = 0;
  if (!areas.empty()) {
    const double maxArea = *std::max_element(areas.begin(), areas.end());
    areaLimit = std::max(1e-8, maxArea * 0.3);
  }

  int id = 0;
  for (int i = 1; i <= map.Extent(); ++i) {
    const TopoDS_Edge edge = TopoDS::Edge(map.FindKey(i));
    if (BRep_Tool::Degenerated(edge)) continue;
    BRepAdaptor_Curve curve(edge);
    GCPnts_QuasiUniformDeflection discret(curve, kWireDeflection);
    if (!discret.IsDone() || discret.NbPoints() < 2) continue;
    nlohmann::json points = nlohmann::json::array();
    for (int p = 1; p <= discret.NbPoints(); ++p) {
      const gp_Pnt pt = discret.Value(p);
      points.push_back(pt.X());
      points.push_back(pt.Y());
      points.push_back(pt.Z());
    }
    const TopTools_ListOfShape& faces = map.FindFromIndex(i);
    const bool manifold = faces.Extent() == 2;
    const bool boundary = faces.Extent() < 2;
    double angle = 0;
    std::vector<std::string> surfaceTypes;
    std::vector<double> faceAreas;
    TopoDS_Face firstFace;
    if (faces.Extent() > 0) firstFace = TopoDS::Face(faces.First());
    if (manifold) {
      const TopoDS_Face fa = TopoDS::Face(faces.First());
      const TopoDS_Face fb = TopoDS::Face(faces.Last());
      firstFace = fa;
      BRepAdaptor_Surface sa(fa, Standard_True);
      BRepAdaptor_Surface sb(fb, Standard_True);
      surfaceTypes.push_back(surfaceTypeName(sa.GetType()));
      surfaceTypes.push_back(surfaceTypeName(sb.GetType()));
      faceAreas.push_back(faceArea(fa));
      faceAreas.push_back(faceArea(fb));
      const gp_Pnt mid = discret.Value((discret.NbPoints() + 1) / 2);
      gp_Dir na;
      gp_Dir nb;
      if (faceNormalAt(fa, mid, na) && faceNormalAt(fb, mid, nb)) {
        angle = dihedral(na, nb);
      }
    }
    const std::string curveType = curveTypeName(curve.GetType());
    const bool curvedCurve = curveType != "line";
    const bool curvedSurface = std::any_of(surfaceTypes.begin(), surfaceTypes.end(), [](const std::string& type) {
      return type == "cylinder" || type == "cone" || type == "sphere" || type == "torus"
        || type == "bspline" || type == "bezier" || type == "offset" || type == "revolution" || type == "extrusion";
    });
    const bool coneSeam = curveType == "line"
      && !surfaceTypes.empty()
      && std::all_of(surfaceTypes.begin(), surfaceTypes.end(), [](const std::string& type) { return type == "cone"; });
    if (coneSeam) continue;
    const bool holeRim = (curveType == "circle" || curveType == "ellipse" || curveType == "bspline" || curveType == "unknown")
      && std::find(surfaceTypes.begin(), surfaceTypes.end(), "plane") != surfaceTypes.end()
      && (std::find(surfaceTypes.begin(), surfaceTypes.end(), "cylinder") != surfaceTypes.end()
        || std::find(surfaceTypes.begin(), surfaceTypes.end(), "cone") != surfaceTypes.end());
    if (holeRim && angle + 1e-3 < 20.0) angle = 90.0;
    const bool display = manifold && !boundary && (angle + 1e-3 >= 0.75 || curvedCurve || curvedSurface);
    bool keep = display;
    if (suppressDetail && areaLimit > 0 && keep) {
      const bool hard = angle + 1e-3 >= 55.0 || holeRim || curvedCurve;
      const bool touchesBlend = std::any_of(faceAreas.begin(), faceAreas.end(), [&](double area) {
        return area > 0 && area <= areaLimit;
      });
      if (!hard && touchesBlend) keep = false;
    }
    const bool canSelect = keep && manifold && !boundary && angle + 1e-3 >= sharpAngle;
    gSession.edges.push_back(edge);
    gSession.edgeFaces.push_back(firstFace);
    edges.push_back({
      { "id", id },
      { "points", points },
      { "display", keep },
      { "selectable", canSelect },
      { "angle", angle },
      { "boundary", boundary },
      { "manifold", manifold },
    });
    if (canSelect) selectable.push_back(id);
    id += 1;
  }
  return { { "edges", edges }, { "selectableEdgeIds", selectable } };
}

nlohmann::json collectDisplayPolylines(const TopoDS_Shape& shape) {
  auto savedEdges = gSession.edges;
  auto savedFaces = gSession.edgeFaces;
  const auto collected = collectEdges(shape, 0.0, false);
  gSession.edges = std::move(savedEdges);
  gSession.edgeFaces = std::move(savedFaces);
  nlohmann::json display = nlohmann::json::array();
  for (const auto& edge : collected["edges"]) {
    if (!edge.value("display", false)) continue;
    display.push_back({ { "points", edge["points"] } });
  }
  return display;
}

bool edgeMidAndLength(const TopoDS_Edge& edge, gp_Pnt& mid, double& length) {
  try {
    GProp_GProps props;
    BRepGProp::LinearProperties(edge, props);
    length = props.Mass();
    BRepAdaptor_Curve curve(edge);
    mid = curve.Value((curve.FirstParameter() + curve.LastParameter()) * 0.5);
    return length > 1e-9;
  } catch (...) {
    return false;
  }
}

bool matchEdgeOnShape(
  const TopoDS_Shape& shape,
  const TopoDS_Edge& target,
  TopoDS_Edge& outEdge,
  TopoDS_Face& outFace
) {
  gp_Pnt targetMid;
  double targetLen = 0;
  if (!edgeMidAndLength(target, targetMid, targetLen)) return false;
  TopTools_IndexedDataMapOfShapeListOfShape map;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, map);
  double best = 1e9;
  int bestIndex = 0;
  for (int i = 1; i <= map.Extent(); ++i) {
    const TopoDS_Edge edge = TopoDS::Edge(map.FindKey(i));
    if (BRep_Tool::Degenerated(edge)) continue;
    gp_Pnt mid;
    double len = 0;
    if (!edgeMidAndLength(edge, mid, len)) continue;
    const double dist = targetMid.Distance(mid);
    if (dist > 0.75) continue;
    const double score = dist + std::abs(len - targetLen) * 0.05;
    if (score < best) {
      best = score;
      bestIndex = i;
      outEdge = edge;
    }
  }
  if (bestIndex == 0) return false;
  const TopTools_ListOfShape& faces = map.FindFromIndex(bestIndex);
  if (faces.Extent() > 0) outFace = TopoDS::Face(faces.First());
  return true;
}

bool filletOne(const TopoDS_Shape& solid, const TopoDS_Edge& edge, double amount, TopoDS_Shape& out) {
  BRepFilletAPI_MakeFillet maker(solid);
  maker.Add(amount, edge);
  maker.Build();
  if (!maker.IsDone()) return false;
  out = maker.Shape();
  return !out.IsNull();
}

bool chamferOne(
  const TopoDS_Shape& solid,
  const TopoDS_Edge& edge,
  const TopoDS_Face& face,
  double amount,
  double chamferAngle,
  TopoDS_Shape& out
) {
  BRepFilletAPI_MakeChamfer maker(solid);
  if (std::abs(chamferAngle - 45.0) < 0.001 || face.IsNull()) maker.Add(amount, edge);
  else maker.AddDA(amount, chamferAngle * kPi / 180.0, edge, face);
  maker.Build();
  if (!maker.IsDone()) return false;
  out = maker.Shape();
  return !out.IsNull();
}

bool treatEdgesTogether(const std::string& kind, const std::vector<int>& selected, double amount, double chamferAngle, TopoDS_Shape& out) {
  if (kind == "fillet") {
    BRepFilletAPI_MakeFillet maker(gSession.base);
    for (int id : selected) maker.Add(amount, gSession.edges[static_cast<size_t>(id)]);
    maker.Build();
    if (!maker.IsDone()) return false;
    out = unify(maker.Shape());
    return !out.IsNull();
  }
  BRepFilletAPI_MakeChamfer maker(gSession.base);
  for (int id : selected) {
    const TopoDS_Edge& edge = gSession.edges[static_cast<size_t>(id)];
    const TopoDS_Face& face = gSession.edgeFaces[static_cast<size_t>(id)];
    if (std::abs(chamferAngle - 45.0) < 0.001 || face.IsNull()) maker.Add(amount, edge);
    else maker.AddDA(amount, chamferAngle * kPi / 180.0, edge, face);
  }
  maker.Build();
  if (!maker.IsDone()) return false;
  out = unify(maker.Shape());
  return !out.IsNull();
}

bool treatEdgesOneByOne(const std::string& kind, const std::vector<int>& selected, double amount, double chamferAngle, TopoDS_Shape& out) {
  TopoDS_Shape acc = gSession.base;
  bool any = false;
  for (int id : selected) {
    TopoDS_Edge edge;
    TopoDS_Face face;
    if (!matchEdgeOnShape(acc, gSession.edges[static_cast<size_t>(id)], edge, face)) continue;
    TopoDS_Shape next;
    bool ok = false;
    try {
      if (kind == "fillet") ok = filletOne(acc, edge, amount, next);
      else ok = chamferOne(acc, edge, face, amount, chamferAngle, next);
    } catch (const Standard_Failure&) {
      ok = false;
    } catch (...) {
      ok = false;
    }
    if (!ok) continue;
    acc = next;
    any = true;
  }
  if (!any) return false;
  out = unify(acc);
  return !out.IsNull();
}

bool treatEdges(const std::string& kind, const std::vector<int>& edgeIds, double amount, double chamferAngle, TopoDS_Shape& out) {
  if (!gSession.live || gSession.base.IsNull()) return false;
  std::vector<int> selected;
  for (int id : edgeIds) {
    if (id < 0 || id >= static_cast<int>(gSession.edges.size())) return false;
    selected.push_back(id);
  }
  if (selected.empty()) return false;
  try {
    if (treatEdgesTogether(kind, selected, amount, chamferAngle, out)) return true;
  } catch (const Standard_Failure&) {
  } catch (...) {
  }
  if (selected.size() <= 1) return false;
  try {
    return treatEdgesOneByOne(kind, selected, amount, chamferAngle, out);
  } catch (const Standard_Failure&) {
    return false;
  } catch (...) {
    return false;
  }
}

double volumeOf(const TopoDS_Shape& shape) {
  GProp_GProps props;
  BRepGProp::VolumeProperties(shape, props);
  return std::abs(props.Mass());
}

gp_Pnt centerOf(const TopoDS_Shape& shape) {
  GProp_GProps props;
  BRepGProp::VolumeProperties(shape, props);
  return props.CentreOfMass();
}

gp_Pnt faceCenter(const TopoDS_Face& face) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(face, props);
  return props.CentreOfMass();
}

bool containsPoint(const TopoDS_Shape& solid, const gp_Pnt& point) {
  auto inside = [&](const TopoDS_Shape& body) {
    try {
      BRepClass3d_SolidClassifier cls(body, point, 1e-5);
      return cls.State() == TopAbs_IN;
    } catch (...) {
      return false;
    }
  };
  const TopAbs_ShapeEnum type = solid.ShapeType();
  if (type == TopAbs_SOLID || type == TopAbs_COMPSOLID) return inside(solid);
  for (TopExp_Explorer exp(solid, TopAbs_SOLID); exp.More(); exp.Next()) {
    if (inside(exp.Current())) return true;
  }
  return false;
}

nlohmann::json sampleWirePoints(const TopoDS_Face& face) {
  nlohmann::json points = nlohmann::json::array();
  for (TopExp_Explorer exp(face, TopAbs_EDGE); exp.More(); exp.Next()) {
    BRepAdaptor_Curve curve(TopoDS::Edge(exp.Current()));
    GCPnts_QuasiUniformDeflection discret(curve, 0.35);
    if (!discret.IsDone()) continue;
    for (int p = 1; p <= discret.NbPoints(); ++p) {
      const gp_Pnt pt = discret.Value(p);
      points.push_back(pt.X());
      points.push_back(pt.Y());
      points.push_back(pt.Z());
    }
  }
  return points;
}

// Ordered outer loop of a face: edges walked in wire order, each edge sampled
// in the walk direction (reversed edges flipped), shared corners emitted once,
// and no repeated closing point. Push Pull draws this as the face outline and
// builds the drag ghost from it, so it has to be a real polygon.
nlohmann::json sampleOuterWirePoints(const TopoDS_Face& face) {
  nlohmann::json points = nlohmann::json::array();
  const TopoDS_Wire wire = BRepTools::OuterWire(face);
  if (wire.IsNull()) return sampleWirePoints(face);
  const double joinTol = 1e-3;
  gp_Pnt first;
  gp_Pnt last;
  bool haveLast = false;
  for (BRepTools_WireExplorer exp(wire, face); exp.More(); exp.Next()) {
    const TopoDS_Edge edge = exp.Current();
    BRepAdaptor_Curve curve(edge);
    GCPnts_QuasiUniformDeflection discret(curve, 0.35);
    if (!discret.IsDone()) continue;
    const int count = discret.NbPoints();
    if (count < 2) continue;
    std::vector<gp_Pnt> sampled;
    sampled.reserve(static_cast<std::size_t>(count));
    for (int p = 1; p <= count; ++p) sampled.push_back(discret.Value(p));
    bool reversed = edge.Orientation() == TopAbs_REVERSED;
    if (haveLast) {
      // Trust the geometry over the flag: join whichever end touches the walk.
      const double headGap = last.Distance(sampled.front());
      const double tailGap = last.Distance(sampled.back());
      if (tailGap + 1e-9 < headGap) reversed = true;
      else if (headGap + 1e-9 < tailGap) reversed = false;
    }
    if (reversed) std::reverse(sampled.begin(), sampled.end());
    for (std::size_t i = 0; i < sampled.size(); ++i) {
      const gp_Pnt& pt = sampled[i];
      if (haveLast && pt.Distance(last) <= joinTol) continue;
      if (!haveLast) first = pt;
      points.push_back(pt.X());
      points.push_back(pt.Y());
      points.push_back(pt.Z());
      last = pt;
      haveLast = true;
    }
  }
  // Drop the closing point so consumers can treat the loop as open.
  while (points.size() >= 9 && haveLast && last.Distance(first) <= joinTol) {
    points.erase(points.end() - 3, points.end());
    last = gp_Pnt(points[points.size() - 3], points[points.size() - 2], points[points.size() - 1]);
  }
  return points.size() >= 9 ? points : sampleWirePoints(face);
}

nlohmann::json collectCylindricalFaces(const TopoDS_Shape& shape) {
  nlohmann::json faces = nlohmann::json::array();
  gSession.cylinders.clear();
  const gp_Pnt solidCenter = centerOf(shape);
  int id = 0;
  for (TopExp_Explorer exp(shape, TopAbs_FACE); exp.More(); exp.Next()) {
    const TopoDS_Face face = TopoDS::Face(exp.Current());
    BRepAdaptor_Surface adaptor(face, Standard_True);
    if (adaptor.GetType() != GeomAbs_Cylinder) continue;
    const gp_Cylinder cyl = adaptor.Cylinder();
    const double radius = cyl.Radius();
    if (radius <= 1e-6) continue;
    const double um = 0.5 * (adaptor.FirstUParameter() + adaptor.LastUParameter());
    const double vm = 0.5 * (adaptor.FirstVParameter() + adaptor.LastVParameter());
    const gp_Pnt sample = adaptor.Value(um, vm);
    gp_Dir axisDir = cyl.Axis().Direction();
    Bnd_Box box;
    BRepBndLib::Add(face, box);
    double xmin, ymin, zmin, xmax, ymax, zmax;
    box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
    const gp_Pnt faceMid = faceCenter(face);
    const gp_XYZ corners[] = {
      gp_XYZ(xmin, ymin, zmin), gp_XYZ(xmax, ymin, zmin), gp_XYZ(xmin, ymax, zmin), gp_XYZ(xmax, ymax, zmin),
      gp_XYZ(xmin, ymin, zmax), gp_XYZ(xmax, ymin, zmax), gp_XYZ(xmin, ymax, zmax), gp_XYZ(xmax, ymax, zmax),
    };
    double minProj = 1e300;
    double maxProj = -1e300;
    for (const auto& corner : corners) {
      const double proj = (corner - faceMid.XYZ()).Dot(axisDir.XYZ());
      minProj = std::min(minProj, proj);
      maxProj = std::max(maxProj, proj);
    }
    const double height = std::max(0.1, maxProj - minProj);
    const gp_Pnt origin = faceMid.Translated(gp_Vec(axisDir) * minProj);
    gp_Vec outward(sample, origin.Translated(gp_Vec(axisDir) * (height * 0.5)));
    outward.Reverse();
    if (outward.Magnitude() < 1e-9) outward = gp_Vec(sample.XYZ() - origin.XYZ());
    if (outward.Magnitude() < 1e-9) continue;
    outward.Normalize();
    const gp_Vec toSolid(sample, solidCenter);
    const std::string side = outward.Dot(toSolid) > 0 ? "internal" : "external";
    gSession.cylinders.push_back(face);
    faces.push_back({
      { "id", id },
      { "owner", 0 },
      { "radius", radius },
      { "height", height },
      { "side", side },
      { "origin", { { "x", origin.X() }, { "y", origin.Y() }, { "z", origin.Z() } } },
      { "axis", { { "x", axisDir.X() }, { "y", axisDir.Y() }, { "z", axisDir.Z() } } },
      { "points", sampleWirePoints(face) },
    });
    id += 1;
  }
  gSession.cylinderFaces = faces;
  return faces;
}

bool planarFaceGeometry(const TopoDS_Face& face, gp_Dir& normal, gp_Pnt& origin) {
  origin = faceCenter(face);
  try {
    BRepAdaptor_Surface adaptor(face, Standard_True);
    if (adaptor.GetType() == GeomAbs_Plane) {
      return faceNormalAt(face, origin, normal);
    }
  } catch (...) {
  }
  try {
    BRepLib_FindSurface finder(face, 0.05, true, false);
    if (!finder.Found()) return false;
    Handle(Geom_Plane) plane = Handle(Geom_Plane)::DownCast(finder.Surface());
    if (plane.IsNull()) return false;
    normal = plane->Pln().Axis().Direction();
    if (face.Orientation() == TopAbs_REVERSED) normal.Reverse();
    return true;
  } catch (...) {
    return false;
  }
}

gp_Pnt pointOnPlanarFace(const TopoDS_Face& face, const gp_Pnt& origin) {
  const TopoDS_Wire wire = BRepTools::OuterWire(face);
  if (!wire.IsNull()) {
    for (BRepTools_WireExplorer exp(wire); exp.More(); exp.Next()) {
      BRepAdaptor_Curve curve(exp.Current());
      const gp_Pnt mid = curve.Value(0.5 * (curve.FirstParameter() + curve.LastParameter()));
      gp_Vec inward(mid, origin);
      const double mag = inward.Magnitude();
      if (mag < 1e-8) continue;
      inward.Divide(mag);
      return mid.Translated(inward * std::min(0.35, mag * 0.25));
    }
  }
  return origin;
}

nlohmann::json collectPlanarFaces(const TopoDS_Shape& shape) {
  nlohmann::json faces = nlohmann::json::array();
  gSession.planars.clear();
  int id = 0;
  for (TopExp_Explorer exp(shape, TopAbs_FACE); exp.More(); exp.Next()) {
    const TopoDS_Face face = TopoDS::Face(exp.Current());
    const double area = faceArea(face);
    if (area < 1e-6) continue;
    gp_Pnt origin;
    gp_Dir normal;
    if (!planarFaceGeometry(face, normal, origin)) continue;
    const gp_Pnt probe = pointOnPlanarFace(face, origin).Translated(gp_Vec(normal) * 0.05);
    if (containsPoint(shape, probe)) normal.Reverse();
    PlanarFaceRecord record;
    record.face = face;
    record.normal = normal;
    record.origin = origin;
    gSession.planars.push_back(record);
    faces.push_back({
      { "id", id },
      { "normal", { { "x", normal.X() }, { "y", normal.Y() }, { "z", normal.Z() } } },
      { "origin", { { "x", origin.X() }, { "y", origin.Y() }, { "z", origin.Z() } } },
      { "points", sampleOuterWirePoints(face) },
      { "area", area },
    });
    id += 1;
  }
  gSession.planarFaces = faces;
  return faces;
}

int solidCountWithVolume(const TopoDS_Shape& shape) {
  int count = 0;
  for (TopExp_Explorer exp(shape, TopAbs_SOLID); exp.More(); exp.Next()) {
    if (volumeOf(exp.Current()) > 1e-8) count += 1;
  }
  return count;
}

const char* pushPullEmptyMessage(double distance) {
  return distance > 0
    ? "That pull could not grow this face. Try a different face or a smaller distance."
    : "That push went through the part. Try a smaller distance.";
}

const char* pushPullMoveMessage() {
  return "Push Pull could not move this face. Try a smaller distance, or Group the parts again.";
}

bool shapeBounds(
  const TopoDS_Shape& shape,
  double& xmin, double& ymin, double& zmin,
  double& xmax, double& ymax, double& zmax
) {
  Bnd_Box box;
  BRepBndLib::Add(shape, box);
  if (box.IsVoid()) return false;
  box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
  return true;
}

bool pushPullLooksExploded(const TopoDS_Shape& before, const TopoDS_Shape& after, double distance) {
  double ax0, ay0, az0, ax1, ay1, az1;
  double bx0, by0, bz0, bx1, by1, bz1;
  if (!shapeBounds(before, ax0, ay0, az0, ax1, ay1, az1)) return false;
  if (!shapeBounds(after, bx0, by0, bz0, bx1, by1, bz1)) return true;
  const double beforeDiag = std::hypot(ax1 - ax0, std::hypot(ay1 - ay0, az1 - az0));
  const double afterDiag = std::hypot(bx1 - bx0, std::hypot(by1 - by0, bz1 - bz0));
  const double budget = std::abs(distance) * 2.0 + 5.0;
  if (afterDiag > beforeDiag + budget && afterDiag > beforeDiag * 1.35) return true;
  return beforeDiag > 1e-6 && afterDiag < beforeDiag * 0.05;
}

TopoDS_Shape healShape(const TopoDS_Shape& shape) {
  try {
    ShapeFix_Shape fixer(shape);
    fixer.Perform();
    if (!fixer.Shape().IsNull()) return fixer.Shape();
  } catch (...) {
  }
  return shape;
}

TopoDS_Shape unifyKeepVolume(const TopoDS_Shape& shape) {
  const double before = volumeOf(shape);
  const int solidsBefore = solidCountWithVolume(shape);
  const TopoDS_Shape unified = unify(shape);
  if (unified.IsNull()) return shape;
  if (solidsBefore >= 1 && solidCountWithVolume(unified) < 1) return shape;
  const double after = volumeOf(unified);
  if (before > 1e-6 && after < before * 0.4) return shape;
  return unified;
}

bool pushPullResultOk(const TopoDS_Shape& before, const TopoDS_Shape& after, double distance, std::string& message) {
  if (after.IsNull() || solidCountWithVolume(after) < 1 || volumeOf(after) < 1e-8) {
    message = pushPullEmptyMessage(distance);
    return false;
  }
  if (pushPullLooksExploded(before, after, distance)) {
    message = "Push Pull broke this grouped body. Try a smaller distance, or Group the parts again.";
    return false;
  }
  return true;
}

TopoDS_Shape owningSolidOfFace(const TopoDS_Shape& shape, const TopoDS_Face& face) {
  for (TopExp_Explorer exp(shape, TopAbs_SOLID); exp.More(); exp.Next()) {
    for (TopExp_Explorer faces(exp.Current(), TopAbs_FACE); faces.More(); faces.Next()) {
      if (faces.Current().IsSame(face)) return exp.Current();
    }
  }
  return shape;
}

TopoDS_Face matchingPlanarFace(const TopoDS_Shape& shape, const PlanarFaceRecord& record) {
  TopoDS_Face best;
  double bestDist = 1e300;
  for (TopExp_Explorer exp(shape, TopAbs_FACE); exp.More(); exp.Next()) {
    const TopoDS_Face face = TopoDS::Face(exp.Current());
    gp_Pnt origin;
    gp_Dir normal;
    if (!planarFaceGeometry(face, normal, origin)) continue;
    if (!normal.IsEqual(record.normal, 0.04)) continue;
    const double dist = origin.Distance(record.origin);
    if (dist < bestDist) {
      bestDist = dist;
      best = face;
    }
  }
  return bestDist < 1.0 ? best : TopoDS_Face();
}

TopoDS_Shape replaceSolidInBody(const TopoDS_Shape& body, const TopoDS_Shape& oldSolid, const TopoDS_Shape& newSolid) {
  if (body.IsSame(oldSolid) || body.ShapeType() == TopAbs_SOLID || body.ShapeType() == TopAbs_COMPSOLID) {
    return newSolid;
  }
  int solidCount = 0;
  for (TopExp_Explorer count(body, TopAbs_SOLID); count.More(); count.Next()) solidCount += 1;
  if (solidCount <= 1) return newSolid;
  BRep_Builder builder;
  TopoDS_Compound compound;
  builder.MakeCompound(compound);
  bool replaced = false;
  for (TopExp_Explorer exp(body, TopAbs_SOLID); exp.More(); exp.Next()) {
    if (exp.Current().IsSame(oldSolid)) {
      builder.Add(compound, newSolid);
      replaced = true;
    } else {
      builder.Add(compound, exp.Current());
    }
  }
  return replaced ? TopoDS_Shape(compound) : newSolid;
}

bool pushPullByFeature(const TopoDS_Shape& host, const PlanarFaceRecord& record, double distance, TopoDS_Shape& out) {
  TopoDS_Shape copied;
  try {
    copied = BRepBuilderAPI_Copy(host).Shape();
  } catch (...) {
    return false;
  }
  const TopoDS_Face face = matchingPlanarFace(copied, record);
  if (face.IsNull()) return false;
  gp_Dir dir = record.normal;
  if (distance < 0) dir.Reverse();
  try {
    BRepFeat_MakePrism feat(copied, face, face, dir, distance > 0 ? 1 : 0, Standard_True);
    feat.Perform(std::abs(distance));
    if (!feat.IsDone() || feat.Shape().IsNull()) return false;
    out = feat.Shape();
    return solidCountWithVolume(out) >= 1;
  } catch (const Standard_Failure&) {
    return false;
  } catch (...) {
    return false;
  }
}

bool pushPullBooleanOnce(
  const TopoDS_Shape& host,
  const TopoDS_Shape& lump,
  double distance,
  bool glue,
  double fuzzy,
  TopoDS_Shape& out
) {
  try {
    if (distance > 0) {
      BRepAlgoAPI_Fuse fuse;
      TopTools_ListOfShape args;
      TopTools_ListOfShape tools;
      args.Append(host);
      tools.Append(lump);
      fuse.SetArguments(args);
      fuse.SetTools(tools);
      if (glue) fuse.SetGlue(BOPAlgo_GlueShift);
      if (fuzzy > 0) fuse.SetFuzzyValue(fuzzy);
      fuse.SetRunParallel(true);
      fuse.Build();
      if (!fuse.IsDone() || fuse.HasErrors() || fuse.Shape().IsNull()) return false;
      out = fuse.Shape();
      return true;
    }
    BRepAlgoAPI_Cut cut;
    TopTools_ListOfShape args;
    TopTools_ListOfShape tools;
    args.Append(host);
    tools.Append(lump);
    cut.SetArguments(args);
    cut.SetTools(tools);
    if (fuzzy > 0) cut.SetFuzzyValue(fuzzy);
    cut.SetRunParallel(true);
    cut.Build();
    if (!cut.IsDone() || cut.HasErrors() || cut.Shape().IsNull()) return false;
    out = cut.Shape();
    return true;
  } catch (const Standard_Failure&) {
    return false;
  } catch (...) {
    return false;
  }
}

bool pushPullByBoolean(const TopoDS_Shape& host, const PlanarFaceRecord& record, double distance, TopoDS_Shape& out) {
  TopoDS_Shape faceCopy;
  try {
    faceCopy = BRepBuilderAPI_Copy(record.face).Shape();
  } catch (...) {
    faceCopy = record.face;
  }
  if (faceCopy.IsNull() || faceCopy.ShapeType() != TopAbs_FACE) return false;
  gp_Vec vec(record.normal);
  vec.Multiply(distance);
  BRepPrimAPI_MakePrism prism(TopoDS::Face(faceCopy), vec, Standard_True);
  if (!prism.IsDone()) return false;
  const TopoDS_Shape lump = prism.Shape();
  if (distance > 0 && pushPullBooleanOnce(host, lump, distance, true, 0.0, out)) return true;
  const double fuzzies[] = { 0.0, 0.01 };
  for (double fuzzy : fuzzies) {
    if (pushPullBooleanOnce(host, lump, distance, false, fuzzy, out)) return true;
  }
  return false;
}

bool pushPullSolid(int faceId, double distance, TopoDS_Shape& out, std::string& message) {
  if (gSession.base.IsNull()) {
    message = "Prepare an object before Push Pull.";
    return false;
  }
  if (faceId < 0 || faceId >= static_cast<int>(gSession.planars.size())) {
    message = "Push Pull needs a flat face.";
    return false;
  }
  if (std::abs(distance) < 1e-4) {
    out = gSession.base;
    return true;
  }
  const PlanarFaceRecord& record = gSession.planars[static_cast<size_t>(faceId)];
  gp_Dir checkNormal;
  gp_Pnt checkOrigin;
  if (!planarFaceGeometry(record.face, checkNormal, checkOrigin)) {
    message = "Push Pull needs a flat face.";
    return false;
  }
  try {
    const TopoDS_Shape owner = owningSolidOfFace(gSession.base, record.face);
    TopoDS_Shape grown;
    std::string local;
    auto accept = [&](const TopoDS_Shape& candidate) {
      const TopoDS_Shape healed = unifyKeepVolume(healShape(candidate));
      if (!pushPullResultOk(owner, healed, distance, local)) return false;
      grown = healed;
      return true;
    };
    if (!pushPullByFeature(owner, record, distance, grown) || !accept(grown)) {
      if (!pushPullByBoolean(owner, record, distance, grown) || !accept(grown)) {
        message = local.empty() ? pushPullMoveMessage() : local;
        return false;
      }
    }
    const TopoDS_Shape combined = unifyKeepVolume(replaceSolidInBody(gSession.base, owner, grown));
    if (!pushPullResultOk(gSession.base, combined, distance, message)) return false;
    out = combined;
    return true;
  } catch (const Standard_Failure&) {
    message = pushPullMoveMessage();
    return false;
  } catch (...) {
    message = pushPullMoveMessage();
    return false;
  }
}

double previewLinearForQuality(const std::string& quality, double amount) {
  if (quality == "draft") return std::max(0.16, std::abs(amount) / 3.0);
  if (quality == "ultra") return std::max(0.02, std::abs(amount) / 20.0);
  if (quality == "fine") return std::max(0.04, std::abs(amount) / 12.0);
  return std::max(0.08, std::abs(amount) / 7.0);
}

bool openingFaces(const TopoDS_Shape& solid, const nlohmann::json& openings, TopTools_ListOfShape& faces, std::string& missing) {
  struct Side {
    const char* name;
    int axis;
    int sign;
  };
  const Side sides[] = {
    { "top", 1, 1 }, { "bottom", 1, -1 }, { "front", 2, 1 }, { "back", 2, -1 }, { "right", 0, 1 }, { "left", 0, -1 },
  };
  std::map<std::string, bool> wanted;
  if (openings.is_array()) {
    for (const auto& item : openings) wanted[item.get<std::string>()] = false;
  }
  if (wanted.empty()) return true;
  Bnd_Box box;
  BRepBndLib::Add(solid, box);
  double xmin, ymin, zmin, xmax, ymax, zmax;
  box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
  const double extent[3][2] = { { xmin, xmax }, { ymin, ymax }, { zmin, zmax } };
  for (TopExp_Explorer exp(solid, TopAbs_FACE); exp.More(); exp.Next()) {
    const TopoDS_Face face = TopoDS::Face(exp.Current());
    BRepAdaptor_Surface adaptor(face, Standard_True);
    if (adaptor.GetType() != GeomAbs_Plane) continue;
    const gp_Pnt center = faceCenter(face);
    gp_Dir normal;
    if (!faceNormalAt(face, center, normal)) continue;
    const double n[3] = { normal.X(), normal.Y(), normal.Z() };
    const double c[3] = { center.X(), center.Y(), center.Z() };
    for (const auto& side : sides) {
      if (wanted.find(side.name) == wanted.end()) continue;
      const double lo = extent[side.axis][0];
      const double hi = extent[side.axis][1];
      const double tolerance = std::max(1e-4, (hi - lo) * 1e-4);
      const bool facesOut = n[side.axis] * side.sign > 0.999;
      const bool atEdge = std::abs(c[side.axis] - (side.sign > 0 ? hi : lo)) <= tolerance;
      if (facesOut && atEdge) {
        faces.Append(face);
        wanted[side.name] = true;
      }
    }
  }
  for (const auto& entry : wanted) {
    if (!entry.second) {
      missing = entry.first;
      return false;
    }
  }
  return true;
}

bool edgeIsInterior(const TopoDS_Shape& solid, const TopoDS_Edge& edge) {
  BRepAdaptor_Curve curve(edge);
  const double first = curve.FirstParameter();
  const double last = curve.LastParameter();
  const double mid = curve.IsClosed() ? first + (last - first) * 0.37 : (first + last) * 0.5;
  const gp_Pnt sample = curve.Value(mid);
  gp_Vec tangent = curve.DN(mid, 1);
  if (tangent.Magnitude() < 1e-9) return false;
  tangent.Normalize();
  gp_Vec helper = std::abs(tangent.Y()) < 0.9 ? gp_Vec(0, 1, 0) : gp_Vec(1, 0, 0);
  gp_Vec across = tangent.Crossed(helper);
  if (across.Magnitude() < 1e-9) return false;
  across.Normalize();
  const gp_Vec around = tangent.Crossed(across);
  int inside = 0;
  const double reach = 0.08;
  for (int step = 0; step < 16; ++step) {
    const double angle = ((step + 0.5) / 16.0) * kPi * 2;
    const gp_Pnt probe = sample.Translated(across * (std::cos(angle) * reach) + around * (std::sin(angle) * reach));
    if (containsPoint(solid, probe)) inside += 1;
  }
  return inside >= 10;
}

bool roundInteriorCorners(TopoDS_Shape& shape, double radius) {
  std::vector<TopoDS_Edge> concave;
  for (TopExp_Explorer exp(shape, TopAbs_EDGE); exp.More(); exp.Next()) {
    const TopoDS_Edge edge = TopoDS::Edge(exp.Current());
    GProp_GProps props;
    BRepGProp::LinearProperties(edge, props);
    if (props.Mass() < 0.05) continue;
    if (edgeIsInterior(shape, edge)) concave.push_back(edge);
  }
  if (concave.empty()) return true;
  const double before = volumeOf(shape);
  BRepFilletAPI_MakeFillet fillet(shape);
  for (const auto& edge : concave) fillet.Add(radius, edge);
  fillet.Build();
  if (!fillet.IsDone()) return false;
  const TopoDS_Shape rounded = fillet.Shape();
  const double after = volumeOf(rounded);
  if (after > before && after < before * 1.5) {
    shape = rounded;
    return true;
  }
  return false;
}

bool hollowSolid(const TopoDS_Shape& solid, double thickness, const nlohmann::json& openings, const std::string& corners, double cornerRadius, TopoDS_Shape& out, std::string& message) {
  TopTools_ListOfShape remove;
  std::string missing;
  if (!openingFaces(solid, openings, remove, missing)) {
    message = "This body has no flat " + missing + " face to leave open";
    return false;
  }
  const double original = volumeOf(solid);
  auto accept = [&](const TopoDS_Shape& candidate) {
    if (candidate.IsNull()) return false;
    const double volume = volumeOf(candidate);
    return volume > 0 && volume < original * (1 - 1e-6);
  };
  TopoDS_Shape result;
  bool built = false;
  for (double tolerance : { 1e-6, 1e-3 }) {
    try {
      if (remove.Extent() > 0) {
        BRepOffsetAPI_MakeThickSolid thick;
        thick.MakeThickSolidByJoin(solid, remove, -thickness, tolerance, BRepOffset_Skin, Standard_False, Standard_False, GeomAbs_Intersection);
        if (thick.IsDone() && accept(thick.Shape())) {
          result = thick.Shape();
          built = true;
          break;
        }
      } else {
        BRepOffsetAPI_MakeOffsetShape offset;
        offset.PerformByJoin(solid, -thickness, tolerance);
        if (!offset.IsDone()) continue;
        BRepAlgoAPI_Cut cut(solid, offset.Shape());
        cut.SetRunParallel(true);
        cut.Build();
        if (cut.IsDone() && accept(cut.Shape())) {
          result = cut.Shape();
          built = true;
          break;
        }
      }
    } catch (...) {
      continue;
    }
  }
  if (!built) {
    message = "The walls cannot be this thick for this body. Choose a thinner wall.";
    return false;
  }
  if (corners == "round") {
    const double radius = std::min(std::max(cornerRadius, 0.05), std::max(thickness, 0.05));
    if (!roundInteriorCorners(result, radius)) {
      message = "These inside corners cannot be rounded at this size. Try a smaller radius.";
      return false;
    }
  }
  out = unify(result);
  return true;
}

gp_Dir orthonormalU(const gp_Dir& axis) {
  gp_Vec helper = std::abs(axis.Y()) < 0.9 ? gp_Vec(0, 1, 0) : gp_Vec(1, 0, 0);
  gp_Vec u = helper.Crossed(gp_Vec(axis));
  if (u.Magnitude() < 1e-9) u = gp_Vec(1, 0, 0);
  return gp_Dir(u);
}

bool makeHelixWire(const gp_Pnt& origin, const gp_Dir& axis, const gp_Dir& u, double radius, double pitch, double length, bool left, TopoDS_Wire& wire) {
  const int turns = std::max(1, static_cast<int>(std::ceil(length / std::max(0.15, pitch))));
  const int segs = std::max(32, turns * 32);
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
  const double sign = left ? -1.0 : 1.0;
  gp_Pnt prev;
  bool hasPrev = false;
  for (int i = 0; i <= segs; ++i) {
    const double t = static_cast<double>(i) / segs;
    const double z = t * length;
    const double ang = sign * (z / pitch) * 2.0 * kPi;
    const gp_Pnt p = origin.Translated(ax * z + uu * (radius * std::cos(ang)) + vv * (radius * std::sin(ang)));
    if (hasPrev && p.Distance(prev) > 1e-8) maker.Add(BRepBuilderAPI_MakeEdge(prev, p).Edge());
    prev = p;
    hasPrev = true;
  }
  if (!maker.IsDone()) return false;
  wire = maker.Wire();
  return true;
}

bool threadRidge(const nlohmann::json& face, const nlohmann::json& job, TopoDS_Shape& ridge, std::string& message) {
  const double faceHeight = face.value("height", 1.0);
  const double faceRadius = face.value("radius", 1.0);
  const double pitch = std::max(0.15, job.value("pitch", 1.0));
  const double length = std::max(pitch * 1.05, std::min(job.value("length", faceHeight), faceHeight));
  if (pitch >= faceHeight) {
    message = "Pitch is larger than this face height — shorten the pitch or use a taller cylinder";
    return false;
  }
  const double major = job.value("majorDiameter", faceRadius * 2);
  if (std::abs(major / 2 - faceRadius) / std::max(faceRadius, 1e-6) > 0.45) {
    message = "Thread size does not match this face. Pick a closer metric size or use Custom.";
    return false;
  }
  if (length < pitch * 0.75) {
    message = "Thread length must be at least about one pitch on this face";
    return false;
  }
  const double depth = std::min(std::max(0.08, job.value("depth", 0.5)), faceRadius * 0.4);
  const double embed = std::min(depth * 0.55, faceRadius * 0.18);
  const double innerR = std::max(0.05, faceRadius - embed);
  const double tipR = faceRadius + depth;
  const double halfWidth = std::min(pitch * 0.34, length * 0.4);
  const auto& originJ = face["origin"];
  const auto& axisJ = face["axis"];
  const gp_Pnt origin(originJ.value("x", 0.0), originJ.value("y", 0.0), originJ.value("z", 0.0));
  const gp_Dir axis(axisJ.value("x", 0.0), axisJ.value("y", 1.0), axisJ.value("z", 0.0));
  const gp_Dir u = orthonormalU(axis);
  const gp_Pnt rootA = origin.Translated(gp_Vec(u) * innerR - gp_Vec(axis) * halfWidth);
  const gp_Pnt tip = origin.Translated(gp_Vec(u) * tipR);
  const gp_Pnt rootB = origin.Translated(gp_Vec(u) * innerR + gp_Vec(axis) * halfWidth);
  BRepBuilderAPI_MakeWire profile;
  profile.Add(BRepBuilderAPI_MakeEdge(rootA, tip).Edge());
  profile.Add(BRepBuilderAPI_MakeEdge(tip, rootB).Edge());
  profile.Add(BRepBuilderAPI_MakeEdge(rootB, rootA).Edge());
  if (!profile.IsDone()) {
    message = "Could not build a solid helical tooth from these thread dimensions";
    return false;
  }
  TopoDS_Wire helix;
  if (!makeHelixWire(origin, axis, u, faceRadius, pitch, length, job.value("handedness", "right") == "left", helix)) {
    message = "Could not build a solid helical tooth from these thread dimensions";
    return false;
  }
  BRepOffsetAPI_MakePipeShell shell(helix);
  shell.SetDiscreteMode();
  shell.SetTransitionMode(BRepBuilderAPI_Transformed);
  shell.Add(profile.Wire(), false, true);
  shell.Build();
  if (!shell.IsDone()) {
    BRepOffsetAPI_MakePipe pipe(helix, profile.Wire());
    pipe.Build();
    if (!pipe.IsDone()) {
      message = "Could not build a solid helical tooth from these thread dimensions";
      return false;
    }
    ridge = pipe.Shape();
  } else {
    shell.MakeSolid();
    ridge = shell.Shape();
  }
  return !ridge.IsNull();
}

nlohmann::json previewMesh(const TopoDS_Shape& shape, int requestId, double linear, bool includeBrep) {
  nlohmann::json positions, normals, indices;
  if (!tessellatePreview(shape, linear, positions, normals, indices)) {
    return modifierFail("The chosen size creates invalid or overlapping edge geometry", false, requestId);
  }
  nlohmann::json reply = {
    { "ok", true },
    { "type", "preview" },
    { "requestId", requestId },
    { "positions", positions },
    { "normals", normals },
    { "indices", indices },
    { "triangleCount", indices.size() / 3 },
    { "brep", includeBrep ? toBrep(shape) : "" },
    { "displayEdges", collectDisplayPolylines(shape) },
  };
  return reply;
}

} // namespace

nlohmann::json handleModifierJob(const nlohmann::json& job) {
  const int requestId = job.value("requestId", job.value("id", 0));
  const std::string type = job.value("type", "");
  if (type == "warmup") {
    return { { "ok", true }, { "type", "warmup" }, { "requestId", requestId } };
  }
  if (type == "dispose") {
    gSession = {};
    return { { "ok", true }, { "type", "disposed" }, { "requestId", requestId } };
  }
  if (type == "prepare") {
    if (!job.contains("parts") || !job["parts"].is_array()) {
      return modifierFail("Fillet prepare is missing solids", true, requestId);
    }
    std::vector<TopoDS_Shape> solids;
    std::vector<TopoDS_Shape> holes;
    for (const auto& part : job["parts"]) {
      TopoDS_Shape shape;
      if (!reconstructPart(part, shape)) {
        return modifierFail("native fillet could not rebuild this solid", true, requestId);
      }
      if (part.value("hole", false)) holes.push_back(shape);
      else solids.push_back(shape);
    }
    if (solids.empty() && holes.empty()) return modifierFail("The group has no solid body to modify", false, requestId);
    TopoDS_Shape body = solids.empty() ? holes[0] : solids[0];
    try {
      const auto& rest = solids.empty() ? holes : solids;
      for (size_t i = 1; i < rest.size(); ++i) {
        BRepAlgoAPI_Fuse fuse(body, rest[i]);
        fuse.SetRunParallel(true);
        fuse.SetFuzzyValue(0.04);
        fuse.Build();
        if (!fuse.IsDone() || fuse.HasErrors()) return modifierFail("Could not fuse group for fillet", true, requestId);
        body = fuse.Shape();
      }
      // Two-body Group keeps the fuse as-is. Unify on a plate-plus-boss was
      // merging offset parallel faces into one warped sheet.
      const std::size_t busy = rest.size() + (!solids.empty() ? holes.size() : 0);
      if (busy >= 3) body = unifyKeepVolume(body);
      if (!solids.empty()) {
        for (const auto& hole : holes) {
          BRepAlgoAPI_Cut cut(body, hole);
          cut.SetRunParallel(true);
          cut.SetFuzzyValue(0.04);
          cut.Build();
          if (cut.IsDone() && !cut.HasErrors()) body = unifyKeepVolume(cut.Shape());
        }
      }
    } catch (...) {
      return modifierFail("Could not rebuild the solid for fillet", true, requestId);
    }
    gSession = {};
    gSession.base = body;
    gSession.live = true;
    const auto collected = collectEdges(body, job.value("sharpAngle", 20.0), job.value("suppressTreatmentDetailEdges", false));
    const auto cylinders = collectCylindricalFaces(body);
    const auto planars = collectPlanarFaces(body);
    return {
      { "ok", true },
      { "type", "ready" },
      { "requestId", requestId },
      { "edges", collected["edges"] },
      { "selectableEdgeIds", collected["selectableEdgeIds"] },
      { "cylindricalFaces", cylinders },
      { "planarFaces", planars },
      { "sourceType", "solid" },
    };
  }
  if (!gSession.live) return modifierFail("Prepare an object before previewing the modifier", false, requestId);
  if (type == "hollow") {
    TopoDS_Shape result;
    std::string message;
    if (!hollowSolid(
      gSession.base,
      job.value("thickness", 1.0),
      job.contains("openings") ? job["openings"] : nlohmann::json::array(),
      job.value("corners", "sharp"),
      job.value("cornerRadius", job.value("thickness", 1.0)),
      result,
      message
    )) {
      return modifierFail(message, false, requestId);
    }
    gSession.accumulated = result;
    return previewMesh(result, requestId, std::max(0.16, job.value("thickness", 1.0) / 4.0), true);
  }
  if (type == "previewThread") {
    const int faceId = job.value("faceId", -1);
    if (faceId < 0 || faceId >= static_cast<int>(gSession.cylinderFaces.size())) {
      return modifierFail("Select a cylindrical face for the thread", false, requestId);
    }
    TopoDS_Shape ridge;
    std::string message;
    if (!threadRidge(gSession.cylinderFaces[faceId], job, ridge, message)) {
      return modifierFail(message, false, requestId);
    }
    try {
      const std::string side = job.value("side", "external");
      TopoDS_Shape combined;
      if (side == "external") {
        BRepAlgoAPI_Fuse fuse(gSession.base, ridge);
        fuse.SetFuzzyValue(0.04);
        fuse.SetRunParallel(true);
        fuse.Build();
        if (!fuse.IsDone()) return modifierFail("Thread boolean failed. Try Draft quality, a shorter length, or a pitch that fits the face.", false, requestId);
        combined = fuse.Shape();
      } else {
        BRepAlgoAPI_Cut cut(gSession.base, ridge);
        cut.SetFuzzyValue(0.04);
        cut.SetRunParallel(true);
        cut.Build();
        if (!cut.IsDone()) return modifierFail("Thread boolean failed. Try Draft quality, a shorter length, or a pitch that fits the face.", false, requestId);
        combined = cut.Shape();
      }
      combined = unify(combined);
      gSession.accumulated = combined;
      return previewMesh(combined, requestId, 0.25, true);
    } catch (...) {
      return modifierFail("Thread boolean produced unusable geometry. Try a smaller pitch, shorter length, or Draft quality.", false, requestId);
    }
  }
  if (type == "pushPull") {
    TopoDS_Shape result;
    std::string message;
    if (!pushPullSolid(job.value("faceId", -1), job.value("distance", 0.0), result, message)) {
      return modifierFail(message, false, requestId);
    }
    gSession.accumulated = result;
    return previewMesh(result, requestId, previewLinearForQuality(job.value("quality", "standard"), job.value("distance", 0.0)), true);
  }
  if (type == "preview") {
    std::vector<int> edgeIds;
    if (job.contains("edgeIds")) {
      for (const auto& id : job["edgeIds"]) edgeIds.push_back(id.get<int>());
    }
    TopoDS_Shape result;
    if (!treatEdges(job.value("kind", "fillet"), edgeIds, job.value("amount", 1.0), job.value("chamferAngle", 45.0), result)) {
      return modifierFail("The chosen size creates invalid or overlapping edge geometry", false, requestId);
    }
    gSession.accumulated = result;
    nlohmann::json positions, normals, indices;
    const double linear = std::max(0.16, job.value("amount", 1.0) / 4.0);
    if (!tessellatePreview(result, linear, positions, normals, indices)) {
      return modifierFail("The chosen size creates invalid or overlapping edge geometry", false, requestId);
    }
    return {
      { "ok", true },
      { "type", "preview" },
      { "requestId", requestId },
      { "positions", positions },
      { "normals", normals },
      { "indices", indices },
      { "triangleCount", indices.size() / 3 },
      { "brep", "" },
      { "displayEdges", collectDisplayPolylines(result) },
    };
  }
  if (type == "refine") {
    if (gSession.accumulated.IsNull()) return modifierFail("Preview an edge before smoothing it", false, requestId);
    nlohmann::json positions, normals, indices;
    if (!tessellatePreview(gSession.accumulated, job.value("linearDeflection", 0.05), positions, normals, indices)) {
      return modifierFail("The smoothed edge treatment had no surface", false, requestId);
    }
    return {
      { "ok", true },
      { "type", "preview" },
      { "requestId", requestId },
      { "positions", positions },
      { "normals", normals },
      { "indices", indices },
      { "triangleCount", indices.size() / 3 },
      { "brep", "" },
      { "displayEdges", collectDisplayPolylines(gSession.accumulated) },
      { "smooth", true },
    };
  }
  if (type == "finalize") {
    if (gSession.accumulated.IsNull()) return modifierFail("Preview an edge before applying it", false, requestId);
    return {
      { "ok", true },
      { "type", "previewBrep" },
      { "requestId", requestId },
      { "brep", toBrep(gSession.accumulated) },
    };
  }
  return modifierFail("Unsupported CAD modifier request", true, requestId);
}
