#include "fillet.hpp"
#include "occtio.hpp"
#include "primitives.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <GCPnts_AbscissaPoint.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <Geom_TrimmedCurve.hxx>
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
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Circ.hxx>
#include <gp_Pnt2d.hxx>

#include <memory>
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
#include <cstdio>
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
  // An oval cone kept as the round cone it is stretched from, with each edge's
  // twin on it (same index as edges). Empty when the part is anything else.
  TopoDS_Shape roundCone;
  std::vector<TopoDS_Edge> roundConeEdges;
  std::vector<TopoDS_Face> roundConeFaces;
  nlohmann::json coneTransform;
  double coneScale = 1.0;
  bool live = false;
};

ModifierSession gSession;

// A failure the user can fix (a size too big, the wrong face) keeps the tool open with the
// message, as the browser kernel does. Only a session that is gone resets the tool.
nlohmann::json modifierFail(const std::string& message, bool fallback, int requestId, bool resetSession = false) {
  return {
    { "ok", false },
    { "fallback", fallback },
    { "type", "error" },
    { "message", message },
    { "requestId", requestId },
    { "resetSession", resetSession },
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
    // An elliptical cone is drawn as a circle stretched along local Z (depth /
    // width). Ignoring this rebuilt a circular cone, so the preview and the
    // body on screen disagreed. Same order as the WASM path: orient, then stretch.
    const double sectionScale = primitive.value("sectionScale", 1.0);
    if (std::isfinite(sectionScale) && sectionScale > 1e-6 && std::abs(sectionScale - 1.0) > 1e-6) {
      local = kernelScale(local, 1.0, 1.0, sectionScale);
    }
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
    if (!readStep(part["brepStep"].get<std::string>(), out)) return false;
    if (part.contains("brepTransform")) applyRowMajor(out, part["brepTransform"]);
    return true;
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

int triangulationTriangles(const TopoDS_Shape& shape) {
  int count = 0;
  for (TopExp_Explorer exp(shape, TopAbs_FACE); exp.More(); exp.Next()) {
    TopLoc_Location loc;
    const Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(TopoDS::Face(exp.Current()), loc);
    if (!tri.IsNull()) count += tri->NbTriangles();
  }
  return count;
}

// One surface normal per mesh node. The adaptor already applies the face
// location. A reversed face, including most concave walls, stores its
// geometric normal on the inside, so that normal is flipped to match the
// triangles drawn below. A node that cannot be evaluated is left unset and
// the facet normal is used for that corner.
void surfaceNormalsForFace(
  const TopoDS_Face& face,
  const Handle(Poly_Triangulation)& tri,
  std::vector<gp_Vec>& nodeNormals,
  std::vector<char>& nodeReady
) {
  nodeNormals.clear();
  nodeReady.clear();
  if (tri.IsNull() || !tri->HasUVNodes()) return;
  const int nodeCount = tri->NbNodes();
  if (nodeCount < 1) return;
  try {
    BRepAdaptor_Surface adaptor(face, Standard_True);
    BRepLProp_SLProps props(adaptor, 1, 1e-6);
    nodeNormals.resize(static_cast<size_t>(nodeCount));
    nodeReady.assign(static_cast<size_t>(nodeCount), 0);
    const bool reverse = face.Orientation() == TopAbs_REVERSED;
    for (int node = 1; node <= nodeCount; ++node) {
      const gp_Pnt2d uv = tri->UVNode(node);
      props.SetParameters(uv.X(), uv.Y());
      if (!props.IsNormalDefined()) continue;
      gp_Dir normal = props.Normal();
      if (reverse) normal.Reverse();
      nodeNormals[static_cast<size_t>(node - 1)] = gp_Vec(normal.XYZ());
      nodeReady[static_cast<size_t>(node - 1)] = 1;
    }
  } catch (...) {
    nodeNormals.clear();
    nodeReady.clear();
  }
}

// True when `facet` points into the material. A concave groove is often meshed
// that way: the triangles face the solid, so a light from outside misses them.
// One probe per face is enough, and the smooth corners of that face flip together.
bool facetPointsIntoSolid(BRepClass3d_SolidClassifier& classifier, const gp_Pnt& a, const gp_Pnt& b, const gp_Pnt& c, const gp_Vec& facet) {
  try {
    const gp_Pnt centroid(
      (a.X() + b.X() + c.X()) / 3.0,
      (a.Y() + b.Y() + c.Y()) / 3.0,
      (a.Z() + b.Z() + c.Z()) / 3.0);
    const gp_Vec step = facet.Multiplied(0.02);
    classifier.Perform(centroid.Translated(step), 1e-4);
    const bool aheadInside = classifier.State() == TopAbs_IN;
    classifier.Perform(centroid.Translated(step.Reversed()), 1e-4);
    const bool behindInside = classifier.State() == TopAbs_IN;
    return aheadInside && !behindInside;
  } catch (...) {
    return false;
  }
}

// `angular` <= 0 is the fast slider picture: 0.32 rad, about 20 flats around a
// circle. The resting preview and Apply pass the host's own step (2π / sides).
// Chord error stays independent of fillet radius. Shrinking it for a smaller
// fillet is what re-meshed the whole body finer on every edit. The angle step
// is separate: a cylinder only stays round if this matches the sides already
// on screen. Over 180k triangles, back off, same budget as the browser worker.
//
// Each corner keeps the normal of the real surface at that node. Triangle
// count does not change. Vertices stay unwelded across faces, so a 90° edge
// stays sharp. If the face is wound into the material, every corner flips
// together, so a convex round, a cove, and an inside-corner fillet are all
// lit from outside the solid.
bool tessellatePreview(const TopoDS_Shape& shape, double linear, nlohmann::json& positions, nlohmann::json& normals, nlohmann::json& indices, double angular = 0.0) {
  // Meshed in place so a later refine of the same solid starts from it. Corners are
  // shared within each face, as the browser kernel sends them.
  KernelMeshOptions options;
  options.shareNodes = true;
  options.copyFirst = false;
  options.maxAngular = 0.16;
  return kernelTessellateIndexed(shape, positions, normals, indices, linear, angular, options);
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

double volumeOf(const TopoDS_Shape& shape);

/**
 * The solid a cove removes along one edge: a cylinder of the cove radius on a
 * straight edge, a torus on a full circle, otherwise a disc swept along the
 * curve. The groove is centred on the edge line and meets both faces square.
 */
bool coveToolForEdge(const TopoDS_Edge& edge, double radius, TopoDS_Shape& tool) {
  BRepAdaptor_Curve curve(edge);
  const double first = curve.FirstParameter();
  const double last = curve.LastParameter();
  if (curve.GetType() == GeomAbs_Line) {
    const gp_Pnt a = curve.Value(first);
    const gp_Pnt b = curve.Value(last);
    const gp_Vec along(a, b);
    if (along.Magnitude() < 1e-6) return false;
    tool = BRepPrimAPI_MakeCylinder(gp_Ax2(a, gp_Dir(along)), radius, along.Magnitude()).Shape();
    return !tool.IsNull();
  }
  if (curve.GetType() == GeomAbs_Circle && curve.IsClosed()) {
    const gp_Circ circ = curve.Circle();
    // A cove as wide as the circle would eat the whole hole or boss.
    if (circ.Radius() <= radius + 1e-6) return false;
    tool = BRepPrimAPI_MakeTorus(gp_Ax2(circ.Location(), circ.Axis().Direction()), circ.Radius(), radius).Shape();
    return !tool.IsNull();
  }
  const gp_Pnt start = curve.Value(first);
  gp_Vec tangent = curve.DN(first, 1);
  if (tangent.Magnitude() < 1e-9) return false;
  const gp_Circ profile(gp_Ax2(start, gp_Dir(tangent)), radius);
  const TopoDS_Edge profileEdge = BRepBuilderAPI_MakeEdge(profile);
  const TopoDS_Wire profileWire = BRepBuilderAPI_MakeWire(profileEdge);
  const TopoDS_Face disc = BRepBuilderAPI_MakeFace(profileWire, Standard_True);
  const TopoDS_Wire spine = BRepBuilderAPI_MakeWire(edge);
  BRepOffsetAPI_MakePipe pipe(spine, disc);
  pipe.Build();
  if (!pipe.IsDone()) return false;
  tool = pipe.Shape();
  return !tool.IsNull();
}

/** The direction an edge leaves `point`, one of its ends. False when it can't be told. */
bool edgeDirectionAway(const TopoDS_Edge& edge, const gp_Pnt& point, gp_Vec& away) {
  try {
    BRepAdaptor_Curve curve(edge);
    const double first = curve.FirstParameter();
    const double last = curve.LastParameter();
    const bool atStart = curve.Value(first).Distance(point) <= curve.Value(last).Distance(point);
    gp_Vec tangent = curve.DN(atStart ? first : last, 1);
    if (tangent.Magnitude() < 1e-9) return false;
    tangent.Normalize();
    away = atStart ? tangent : tangent.Reversed();
    return true;
  } catch (...) {
    return false;
  }
}

/**
 * Cut a concave quarter-round groove along each edge. Where two or more coved
 * edges share a vertex a ball of the same radius is removed too, so the grooves
 * run into each other the way a ball-end cutter would leave them.
 */
bool coveEdges(const TopoDS_Shape& solid, const std::vector<TopoDS_Edge>& edges, double radius, TopoDS_Shape& out) {
  if (edges.empty() || !(radius > 1e-6)) return false;
  TopTools_ListOfShape tools;
  TopTools_IndexedMapOfShape vertices;
  std::vector<int> vertexUse;
  std::vector<std::vector<gp_Vec>> vertexAway;
  for (const auto& edge : edges) {
    TopoDS_Shape tool;
    if (!coveToolForEdge(edge, radius, tool)) return false;
    tools.Append(tool);
    for (TopExp_Explorer exp(edge, TopAbs_VERTEX); exp.More(); exp.Next()) {
      const int index = vertices.Add(exp.Current());
      if (index > static_cast<int>(vertexUse.size())) {
        vertexUse.push_back(0);
        vertexAway.emplace_back();
      }
      vertexUse[static_cast<size_t>(index - 1)] += 1;
      gp_Vec away;
      if (edgeDirectionAway(edge, BRep_Tool::Pnt(TopoDS::Vertex(exp.Current())), away)) {
        vertexAway[static_cast<size_t>(index - 1)].push_back(away);
      }
    }
  }
  // How many of the solid's own edges meet at each corner, coved or not.
  TopTools_IndexedDataMapOfShapeListOfShape solidUse;
  TopExp::MapShapesAndUniqueAncestors(solid, TopAbs_VERTEX, TopAbs_EDGE, solidUse);
  for (int index = 1; index <= vertices.Extent(); ++index) {
    const int count = vertexUse[static_cast<size_t>(index - 1)];
    if (count < 2) continue;
    const TopoDS_Shape& vertex = vertices.FindKey(index);
    const gp_Pnt point = BRep_Tool::Pnt(TopoDS::Vertex(vertex));
    double ball = radius;
    // Where every edge at a corner is coved, the grooves alone leave a point of material
    // standing between them. A ball reaching to where each pair of grooves meets on the
    // face between them (r / sin(half the angle)) scoops it out cleanly. Where an edge
    // stays sharp, that ball would dig into it, so the plain ball is kept.
    const int solidCount = solidUse.Contains(vertex) ? solidUse.FindFromKey(vertex).Extent() : 0;
    if (count >= 3 && count == solidCount) {
      const auto& away = vertexAway[static_cast<size_t>(index - 1)];
      for (size_t i = 0; i < away.size(); ++i) {
        for (size_t j = i + 1; j < away.size(); ++j) {
          const double angle = away[i].Angle(away[j]);
          if (angle > 1e-3) ball = std::max(ball, radius / std::sin(angle / 2.0));
        }
      }
      // A very sharp corner would need a huge ball; cap it so it can't eat the part.
      ball = std::min(ball, radius * 2.0);
    }
    tools.Append(BRepPrimAPI_MakeSphere(point, ball).Shape());
  }
  // One tool at a time, the way the browser kernel cuts them. Cutting every groove and
  // ball at once was faster, but on a moved or turned part it could come out wrong while
  // still passing the validity check: whole faces gone.
  // A cut can never take away more than its tool holds, and must leave a sound solid. One
  // that fails either is a broken boolean (every cut after it then goes wrong too), so it
  // is tried again after the others, once the part around it has changed.
  std::vector<TopoDS_Shape> pending;
  for (TopTools_ListOfShape::Iterator it(tools); it.More(); it.Next()) pending.push_back(it.Value());
  TopoDS_Shape coved = solid;
  double volume = volumeOf(solid);
  for (int round = 0; round < 3 && !pending.empty(); ++round) {
    std::vector<TopoDS_Shape> retry;
    for (const auto& tool : pending) {
      // On a retry the tool grows by a fraction of a micron: too little to see, enough to
      // move it off the exact touching faces that tripped the boolean.
      TopoDS_Shape cutter = tool;
      if (round > 0) {
        double x0, y0, z0, x1, y1, z1;
        if (kernelBounds(tool, x0, y0, z0, x1, y1, z1)) {
          gp_Trsf grow;
          grow.SetScale(gp_Pnt((x0 + x1) / 2.0, (y0 + y1) / 2.0, (z0 + z1) / 2.0), 1.0 + 2e-5 * round);
          cutter = BRepBuilderAPI_Transform(tool, grow, true).Shape();
        }
      }
      TopoDS_Shape next;
      if (!kernelBoolean(KernelBooleanOp::Cut, coved, cutter, next)) return false;
      const double left = volumeOf(next);
      if (volume - left > volumeOf(tool) * 1.001 + 1e-6 || !kernelShapeIsValid(next)) {
        retry.push_back(tool);
        continue;
      }
      coved = next;
      volume = left;
    }
    if (retry.size() == pending.size()) break;
    pending = retry;
  }
  if (!pending.empty()) return false;
  const double before = volumeOf(solid);
  const double after = volumeOf(coved);
  // A cove always removes material; anything else means the tool missed the edge.
  if (!(after > 1e-6) || after >= before - 1e-6) return false;
  out = unify(coved);
  return !out.IsNull();
}

bool treatEdgesTogether(const std::string& kind, const std::vector<int>& selected, double amount, double chamferAngle, const std::string& filletProfile, TopoDS_Shape& out) {
  if (kind == "fillet" && filletProfile == "cove") {
    std::vector<TopoDS_Edge> edges;
    for (int id : selected) edges.push_back(gSession.edges[static_cast<size_t>(id)]);
    return coveEdges(gSession.base, edges, amount, out);
  }
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

bool containsPoint(const TopoDS_Shape& solid, const gp_Pnt& point);
bool edgeIsInterior(const TopoDS_Shape& solid, const TopoDS_Edge& edge);

TopoDS_Shape onlySolid(const TopoDS_Shape& shape) {
  if (shape.IsNull() || shape.ShapeType() == TopAbs_SOLID) return shape;
  TopoDS_Shape found;
  int count = 0;
  for (TopExp_Explorer exp(shape, TopAbs_SOLID); exp.More(); exp.Next()) {
    found = exp.Current();
    count += 1;
  }
  return count == 1 ? found : shape;
}

int solidCount(const TopoDS_Shape& shape) {
  int count = 0;
  for (TopExp_Explorer exp(shape, TopAbs_SOLID); exp.More(); exp.Next()) count += 1;
  return count;
}

/** A face normal at `point` that points out of the material, checked against the solid. */
gp_Vec reliableOutwardNormal(const TopoDS_Shape& solid, const TopoDS_Face& face, const gp_Pnt& point) {
  gp_Dir direction;
  if (!faceNormalAt(face, point, direction)) throw Standard_Failure("no face normal");
  gp_Vec normal(direction);
  const bool plusInside = containsPoint(solid, point.Translated(normal * 0.05));
  const bool minusInside = containsPoint(solid, point.Translated(normal * -0.05));
  if (plusInside && !minusInside) normal.Reverse();
  return normal;
}

/** The edge's start, direction and length, and the directions along each face into the material. */
struct CornerFrame {
  gp_Pnt start;
  gp_Vec tangent;
  double length = 0;
  bool line = false;
  gp_Vec bin1;
  gp_Vec bin2;
};

bool materialFrame(const TopoDS_Shape& solid, const TopoDS_Edge& edge, const TopTools_IndexedDataMapOfShapeListOfShape& faceMap, CornerFrame& frame) {
  try {
    if (!faceMap.Contains(edge)) return false;
    const TopTools_ListOfShape& faces = faceMap.FindFromKey(edge);
    if (faces.Extent() < 2) return false;
    const TopoDS_Face faceA = TopoDS::Face(faces.First());
    const TopoDS_Face faceB = TopoDS::Face(faces.Last());
    BRepAdaptor_Curve curve(edge);
    const double first = curve.FirstParameter();
    const double last = curve.LastParameter();
    const double sampleParam = curve.IsClosed() ? first + (last - first) * 0.37 : first + (last - first) * 0.5;
    frame.start = curve.Value(first);
    const gp_Pnt sample = curve.Value(sampleParam);
    gp_Vec tangent = curve.DN(first, 1);
    if (tangent.Magnitude() < 1e-9) return false;
    frame.tangent = tangent.Normalized();
    frame.length = GCPnts_AbscissaPoint::Length(curve);
    frame.line = curve.GetType() == GeomAbs_Line;
    if (!(frame.length > 1e-6)) return false;
    gp_Vec n1;
    gp_Vec n2;
    try {
      n1 = reliableOutwardNormal(solid, faceA, frame.start);
      n2 = reliableOutwardNormal(solid, faceB, frame.start);
    } catch (...) {
      n1 = reliableOutwardNormal(solid, faceA, sample);
      n2 = reliableOutwardNormal(solid, faceB, sample);
    }
    gp_Vec bin1 = frame.tangent.Crossed(n1);
    gp_Vec bin2 = frame.tangent.Crossed(n2);
    if (bin1.Magnitude() < 1e-9 || bin2.Magnitude() < 1e-9) return false;
    bin1.Normalize();
    bin2.Normalize();
    if (bin1.Dot(n2) > 0) bin1.Reverse();
    if (bin2.Dot(n1) > 0) bin2.Reverse();
    if (!containsPoint(solid, sample.Translated(bin1 * 0.05 + bin2 * 0.05))) {
      bin1.Reverse();
      bin2.Reverse();
    }
    frame.bin1 = bin1;
    frame.bin2 = bin2;
    return true;
  } catch (...) {
    return false;
  }
}

TopoDS_Face polygonFace(std::initializer_list<gp_Pnt> points) {
  BRepBuilderAPI_MakePolygon polygon;
  for (const auto& point : points) polygon.Add(point);
  polygon.Close();
  return BRepBuilderAPI_MakeFace(polygon.Wire(), Standard_True).Face();
}

/** The material a straight inside corner gives up: a square less a round for a fillet, a wedge for a chamfer. */
bool straightCornerTool(const CornerFrame& frame, const std::string& kind, double amount, double second, TopoDS_Shape& tool) {
  const gp_Vec extrude = frame.tangent * frame.length;
  const gp_Pnt& start = frame.start;
  if (kind == "fillet") {
    const gp_Pnt q1 = start.Translated(frame.bin1 * amount);
    const gp_Pnt q2 = q1.Translated(frame.bin2 * amount);
    const gp_Pnt q3 = start.Translated(frame.bin2 * amount);
    const TopoDS_Shape square = BRepPrimAPI_MakePrism(polygonFace({ start, q1, q2, q3 }), extrude).Shape();
    const gp_Pnt center = start.Translated(frame.bin1 * amount + frame.bin2 * amount);
    const TopoDS_Shape round = BRepPrimAPI_MakeCylinder(gp_Ax2(center, gp_Dir(frame.tangent)), amount, frame.length).Shape();
    return kernelBoolean(KernelBooleanOp::Cut, square, round, tool);
  }
  const gp_Pnt p1 = start.Translated(frame.bin1 * amount);
  const gp_Pnt p2 = start.Translated(frame.bin2 * second);
  tool = BRepPrimAPI_MakePrism(polygonFace({ start, p1, p2 }), extrude).Shape();
  return !tool.IsNull();
}

/** The same profile swept along a curved edge. */
bool curvedCornerTool(const TopoDS_Edge& edge, const CornerFrame& frame, const std::string& kind, double amount, double second, TopoDS_Shape& tool) {
  const gp_Pnt& start = frame.start;
  TopoDS_Face profile;
  if (kind == "fillet") {
    const double phi = frame.bin1.Angle(frame.bin2);
    if (phi < 0.15 || phi > kPi - 0.15) return false;
    const double leg = amount / std::tan(phi / 2);
    const gp_Vec bisector = (frame.bin1 + frame.bin2).Normalized();
    const gp_Pnt center = start.Translated(bisector * (amount / std::sin(phi / 2)));
    const gp_Pnt contact1 = start.Translated(frame.bin1 * leg);
    const gp_Pnt contact2 = start.Translated(frame.bin2 * leg);
    const gp_Pnt arcMid = center.Translated(gp_Vec(center, start).Normalized() * amount);
    const Handle(Geom_TrimmedCurve) arc = GC_MakeArcOfCircle(contact1, arcMid, contact2).Value();
    BRepBuilderAPI_MakeWire wire;
    wire.Add(BRepBuilderAPI_MakeEdge(start, contact1).Edge());
    wire.Add(BRepBuilderAPI_MakeEdge(arc).Edge());
    wire.Add(BRepBuilderAPI_MakeEdge(contact2, start).Edge());
    if (!wire.IsDone()) return false;
    profile = BRepBuilderAPI_MakeFace(wire.Wire(), Standard_True).Face();
  } else {
    profile = polygonFace({ start, start.Translated(frame.bin1 * amount), start.Translated(frame.bin2 * second) });
  }
  BRepOffsetAPI_MakePipe pipe(BRepBuilderAPI_MakeWire(edge).Wire(), profile);
  pipe.Build();
  if (!pipe.IsDone()) return false;
  tool = pipe.Shape();
  return !tool.IsNull();
}

/**
 * Inside corners: an OCCT fillet would fill them with material and can close a hole.
 * Cut the corner's material away instead, so the hole stays open and the corner is
 * rounded or bevelled. The browser kernel's cutConcaveCorners, step for step.
 */
bool cutConcaveCorners(
  const TopoDS_Shape& target,
  const TopoDS_Shape& source,
  const std::vector<TopoDS_Edge>& edges,
  const std::string& kind,
  double amount,
  double chamferAngle,
  TopoDS_Shape& out,
  std::string& message
) {
  const double angle = std::max(5.0, std::min(85.0, chamferAngle));
  const double second = amount * std::tan(angle * kPi / 180.0);
  TopTools_IndexedDataMapOfShapeListOfShape faceMap;
  TopExp::MapShapesAndAncestors(source, TopAbs_EDGE, TopAbs_FACE, faceMap);
  const std::string couldNot = "That edge could not be rounded. Try a smaller radius or select fewer edges.";
  TopoDS_Shape current = target;
  for (const auto& edge : edges) {
    CornerFrame frame;
    if (!materialFrame(source, edge, faceMap, frame)) {
      message = "A hole edge could not be beveled";
      return false;
    }
    const double before = volumeOf(current);
    auto apply = [&](const CornerFrame& use, TopoDS_Shape& shape, int& pieces) {
      try {
        TopoDS_Shape tool;
        const bool built = use.line ? straightCornerTool(use, kind, amount, second, tool) : curvedCornerTool(edge, use, kind, amount, second, tool);
        if (!built) return false;
        TopoDS_Shape cut;
        if (!kernelBoolean(KernelBooleanOp::Cut, onlySolid(current), tool, cut)) return false;
        shape = onlySolid(unify(cut));
        pieces = solidCount(shape);
        return true;
      } catch (...) {
        return false;
      }
    };
    const double expectedDrop = 0.02 * amount * amount * std::max(frame.length, 1e-3);
    auto dropped = [&](const TopoDS_Shape& shape) { return before - volumeOf(shape) > expectedDrop; };
    TopoDS_Shape shape;
    int pieces = 0;
    bool applied = apply(frame, shape, pieces);
    if (!applied || (pieces == 1 && !dropped(shape))) {
      CornerFrame flipped = frame;
      flipped.bin1.Reverse();
      flipped.bin2.Reverse();
      TopoDS_Shape retried;
      int retriedPieces = 0;
      if (apply(flipped, retried, retriedPieces)) {
        shape = retried;
        pieces = retriedPieces;
        applied = true;
      }
    }
    if (!applied) {
      message = couldNot;
      return false;
    }
    const double after = volumeOf(shape);
    const bool brokeThrough = pieces != 1 || after < 1e-3 || after < before * 0.5;
    if (pieces == 1 && !dropped(shape)) {
      message = couldNot;
      return false;
    }
    if (brokeThrough || !kernelShapeIsValid(shape)) {
      message = brokeThrough ? "That size cuts through the hole. Choose a smaller fillet or chamfer." : couldNot;
      return false;
    }
    current = shape;
  }
  out = current;
  return true;
}

bool treatOneEdge(const std::string& kind, const TopoDS_Shape& acc, const TopoDS_Edge& edge, const TopoDS_Face& face, double amount, double chamferAngle, const std::string& filletProfile, TopoDS_Shape& next) {
  try {
    if (kind == "fillet" && filletProfile == "cove") return coveEdges(acc, { edge }, amount, next);
    if (kind == "fillet") return filletOne(acc, edge, amount, next);
    return chamferOne(acc, edge, face, amount, chamferAngle, next);
  } catch (...) {
    return false;
  }
}

/**
 * One edge at a time, each found again on the solid the last one made. An edge counts only
 * when it removes material and leaves a sound solid. Inside corners that a fillet would fill
 * are then cut round instead. Same rules as the browser kernel's applyRemovingTreatment.
 */
bool treatEdgesOneByOne(
  const std::string& kind,
  const std::vector<int>& selected,
  double amount,
  double chamferAngle,
  const std::string& filletProfile,
  TopoDS_Shape& out,
  std::vector<int>& skipped
) {
  TopoDS_Shape acc = gSession.base;
  bool any = false;
  std::vector<int> missed;
  for (int id : selected) {
    TopoDS_Edge edge = gSession.edges[static_cast<size_t>(id)];
    TopoDS_Face face = gSession.edgeFaces[static_cast<size_t>(id)];
    if (any && !matchEdgeOnShape(acc, gSession.edges[static_cast<size_t>(id)], edge, face)) {
      missed.push_back(id);
      continue;
    }
    TopoDS_Shape next;
    const bool ok = treatOneEdge(kind, acc, edge, face, amount, chamferAngle, filletProfile, next)
      && volumeOf(next) + 1e-3 < volumeOf(acc)
      && kernelShapeIsValid(next);
    if (!ok) {
      missed.push_back(id);
      continue;
    }
    acc = next;
    any = true;
  }
  if (!any) return false;
  std::vector<TopoDS_Edge> concave;
  std::vector<int> concaveIds;
  for (int id : missed) {
    const TopoDS_Edge& edge = gSession.edges[static_cast<size_t>(id)];
    if (edgeIsInterior(gSession.base, edge)) {
      concave.push_back(edge);
      concaveIds.push_back(id);
    }
  }
  // One corner at a time, so a corner that clashes with its neighbour does not undo the rest.
  for (size_t index = 0; index < concave.size(); ++index) {
    TopoDS_Shape cut;
    std::string message;
    if (!cutConcaveCorners(acc, gSession.base, { concave[index] }, kind, amount, chamferAngle, cut, message)) continue;
    acc = cut;
    missed.erase(std::remove(missed.begin(), missed.end(), concaveIds[index]), missed.end());
  }
  skipped = missed;
  out = unify(acc);
  return !out.IsNull();
}

/** The browser kernel's last resorts when no edge could be treated one at a time. */
bool treatEdgesByCornerCut(
  const std::string& kind,
  const std::vector<int>& selected,
  double amount,
  double chamferAngle,
  const std::string& filletProfile,
  TopoDS_Shape& out,
  std::string& message
) {
  const TopoDS_Shape& solid = gSession.base;
  const double before = volumeOf(solid);
  if (kind == "chamfer") {
    // A surface the chamfer refuses (a resized round roof): cut each corner as a wedge.
    TopoDS_Shape current = solid;
    bool progressed = false;
    for (int id : selected) {
      TopoDS_Shape cut;
      std::string ignored;
      if (cutConcaveCorners(current, solid, { gSession.edges[static_cast<size_t>(id)] }, "chamfer", amount, chamferAngle, cut, ignored)
        && volumeOf(cut) + 1e-3 < volumeOf(current)) {
        current = cut;
        progressed = true;
      }
    }
    if (progressed && volumeOf(current) + 1e-3 < before) {
      out = unify(current);
      return true;
    }
  }
  std::vector<int> convexIds;
  std::vector<TopoDS_Edge> concave;
  for (int id : selected) {
    const TopoDS_Edge& edge = gSession.edges[static_cast<size_t>(id)];
    if (edgeIsInterior(solid, edge)) concave.push_back(edge);
    else convexIds.push_back(id);
  }
  TopoDS_Shape component = solid;
  if (!convexIds.empty() || concave.empty()) {
    if (!treatEdgesTogether(kind, convexIds.empty() ? selected : convexIds, amount, chamferAngle, filletProfile, component)) return false;
  }
  if (!concave.empty()) {
    TopoDS_Shape cut;
    if (!cutConcaveCorners(onlySolid(component), solid, concave, kind, amount, chamferAngle, cut, message)) return false;
    component = cut;
  }
  out = unify(onlySolid(component));
  return !out.IsNull() && kernelShapeIsValid(out);
}

bool treatEdges(
  const std::string& kind,
  const std::vector<int>& edgeIds,
  double amount,
  double chamferAngle,
  const std::string& filletProfile,
  TopoDS_Shape& out,
  std::vector<int>& skipped
) {
  skipped.clear();
  if (!gSession.live || gSession.base.IsNull()) return false;
  std::vector<int> selected;
  for (int id : edgeIds) {
    if (id < 0 || id >= static_cast<int>(gSession.edges.size())) return false;
    selected.push_back(id);
  }
  if (selected.empty()) return false;
  const double before = volumeOf(gSession.base);
  try {
    // All at once is the common click. A treatment that removes no material filled a
    // corner instead, which the browser kernel never keeps either.
    if (treatEdgesTogether(kind, selected, amount, chamferAngle, filletProfile, out)
      && volumeOf(out) + 1e-3 < before
      && kernelShapeIsValid(out)) return true;
  } catch (const Standard_Failure&) {
  } catch (...) {
  }
  if (selected.size() > 1) {
    try {
      if (treatEdgesOneByOne(kind, selected, amount, chamferAngle, filletProfile, out, skipped)) return true;
    } catch (const Standard_Failure&) {
    } catch (...) {
    }
    skipped.clear();
  }
  try {
    std::string message;
    return treatEdgesByCornerCut(kind, selected, amount, chamferAngle, filletProfile, out, message);
  } catch (const Standard_Failure&) {
    return false;
  } catch (...) {
    return false;
  }
}

gp_Pnt stretchedConePoint(const gp_Pnt& point) {
  const double x = point.X();
  const double y = point.Y();
  const double z = point.Z() * gSession.coneScale;
  const auto& m = gSession.coneTransform;
  if (!m.is_array() || m.size() < 12) return gp_Pnt(x, y, z);
  return gp_Pnt(
    m[0].get<double>() * x + m[1].get<double>() * y + m[2].get<double>() * z + m[3].get<double>(),
    m[4].get<double>() * x + m[5].get<double>() * y + m[6].get<double>() * z + m[7].get<double>(),
    m[8].get<double>() * x + m[9].get<double>() * y + m[10].get<double>() * z + m[11].get<double>());
}

// An oval cone is a round cone stretched. OCCT rounds the round one far more
// reliably, so the fillet is made there and then stretched, as in the browser.
// Kept only when every edge on screen has a twin on the round cone.
void captureStretchedCone(const nlohmann::json& parts) {
  if (!parts.is_array() || parts.size() != 1 || parts[0].value("hole", false)) return;
  if (!parts[0].contains("primitive") || !parts[0]["primitive"].is_object()) return;
  const auto& primitive = parts[0]["primitive"];
  if (primitive.value("kind", "") != "cone") return;
  const double scale = primitive.value("sectionScale", 1.0);
  if (!std::isfinite(scale) || scale <= 1e-6 || std::abs(scale - 1.0) < 1e-4) return;
  nlohmann::json round = primitive;
  round.erase("sectionScale");
  round.erase("transform");
  TopoDS_Shape host;
  if (!buildPrimitive(round, host)) return;
  gSession.coneScale = scale;
  gSession.coneTransform = primitive.contains("transform") ? primitive["transform"] : nlohmann::json();
  const double tolerance = std::max(0.75, std::max(primitive.value("baseRadius", 0.0), primitive.value("topRadius", 0.0)) * 0.03);
  TopTools_IndexedDataMapOfShapeListOfShape faceMap;
  TopExp::MapShapesAndAncestors(host, TopAbs_EDGE, TopAbs_FACE, faceMap);
  std::vector<TopoDS_Edge> twins;
  std::vector<TopoDS_Face> twinFaces;
  std::vector<int> used;
  for (const TopoDS_Edge& shown : gSession.edges) {
    int best = 0;
    double bestGap = tolerance;
    for (int index = 1; index <= faceMap.Extent(); ++index) {
      const TopoDS_Edge edge = TopoDS::Edge(faceMap.FindKey(index));
      gp_Pnt mid;
      double length = 0.0;
      if (BRep_Tool::Degenerated(edge) || !edgeMidAndLength(edge, mid, length)) continue;
      BRepExtrema_DistShapeShape gap(BRepBuilderAPI_MakeVertex(stretchedConePoint(mid)).Shape(), shown);
      if (gap.IsDone() && gap.Value() < bestGap) {
        bestGap = gap.Value();
        best = index;
      }
    }
    if (best == 0 || std::find(used.begin(), used.end(), best) != used.end()) {
      gSession.coneScale = 1.0;
      gSession.coneTransform = nlohmann::json();
      return;
    }
    used.push_back(best);
    twins.push_back(TopoDS::Edge(faceMap.FindKey(best)));
    const TopTools_ListOfShape& faces = faceMap.FindFromIndex(best);
    twinFaces.push_back(faces.Extent() > 0 ? TopoDS::Face(faces.First()) : TopoDS_Face());
  }
  gSession.roundCone = host;
  gSession.roundConeEdges = std::move(twins);
  gSession.roundConeFaces = std::move(twinFaces);
}

bool treatStretchedCone(
  const std::string& kind,
  const std::vector<int>& selected,
  double amount,
  double chamferAngle,
  const std::string& filletProfile,
  TopoDS_Shape& out,
  std::vector<int>& skipped
) {
  if (gSession.roundCone.IsNull()) return false;
  // The edge ladder works on the session's solid, so lend it the round cone.
  struct Lend {
    Lend() { swap(); }
    ~Lend() { swap(); }
    void swap() {
      std::swap(gSession.base, gSession.roundCone);
      std::swap(gSession.edges, gSession.roundConeEdges);
      std::swap(gSession.edgeFaces, gSession.roundConeFaces);
    }
  };
  TopoDS_Shape round;
  {
    Lend lend;
    if (!treatEdges(kind, selected, amount, chamferAngle, filletProfile, round, skipped)) return false;
  }
  out = kernelScale(round, 1.0, 1.0, gSession.coneScale);
  if (gSession.coneTransform.is_array()) applyRowMajor(out, gSession.coneTransform);
  return !out.IsNull() && kernelShapeIsValid(out);
}

// When a fillet or chamfer will not fit, the largest size that does, found by
// halving between nothing and the size asked for. The browser engine runs the
// same seven tries and rounds the same way, so both say the same thing.
// Returns 0 when even a small size fails or the part has several bodies.
double largestFittingSize(const std::string& kind, const std::vector<int>& selected, double requested, double chamferAngle, const std::string& filletProfile) {
  if (!(requested > 0.0) || selected.empty() || solidCount(gSession.base) != 1) return 0.0;
  for (int id : selected) {
    if (id < 0 || static_cast<size_t>(id) >= gSession.edges.size()) return 0.0;
  }
  const double before = volumeOf(gSession.base);
  double low = 0.0;
  double high = requested;
  for (int step = 0; step < 7; ++step) {
    const double middle = (low + high) / 2.0;
    TopoDS_Shape treated;
    const bool fits = treatEdgesTogether(kind, selected, middle, chamferAngle, filletProfile, treated)
      && volumeOf(treated) + 1e-3 < before && kernelShapeIsValid(treated);
    if (fits) low = middle;
    else high = middle;
  }
  const double tidy = low >= 1.0 ? std::floor(low * 10.0) / 10.0 : std::floor(low * 100.0) / 100.0;
  return tidy >= requested * 0.05 && tidy > 0.0 ? tidy : 0.0;
}

std::string tooBigMessage(const std::string& kind, double largest) {
  char size[32];
  std::snprintf(size, sizeof(size), "%.2f", largest);
  std::string text(size);
  while (!text.empty() && text.back() == '0') text.pop_back();
  if (!text.empty() && text.back() == '.') text.pop_back();
  return std::string("That ") + (kind == "chamfer" ? "size" : "radius") + " is too big for these edges. The largest that fits is about " + text + " mm.";
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
      fuse.SetNonDestructive(true);
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
    cut.SetNonDestructive(true);
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

// The browser kernel's table (cadModifier.worker tessellationOptions and
// previewTessellationOptions), so a preview looks the same in both.
struct MeshQuality {
  double linear;
  double angular;
};

MeshQuality meshForQuality(const std::string& quality) {
  if (quality == "draft") return { 0.12, 0.42 };
  if (quality == "ultra") return { 0.02, 0.06 };
  if (quality == "fine") return { 0.04, 0.1 };
  return { 0.055, 0.2 };
}

// A quick picture while a slider moves; the resting preview and Apply replace it.
constexpr MeshQuality kSliderPreview{ 0.16, 0.32 };

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
  // Tight bounds: a cut hole raises face tolerances, and a padded box would no
  // longer touch the flat faces that are meant to stay open.
  double xmin, ymin, zmin, xmax, ymax, zmax;
  if (!kernelBounds(solid, xmin, ymin, zmin, xmax, ymax, zmax)) return false;
  const double extent[3][2] = { { xmin, xmax }, { ymin, ymax }, { zmin, zmax } };
  for (TopExp_Explorer exp(solid, TopAbs_FACE); exp.More(); exp.Next()) {
    const TopoDS_Face face = TopoDS::Face(exp.Current());
    BRepAdaptor_Surface adaptor(face, Standard_True);
    if (adaptor.GetType() != GeomAbs_Plane) continue;
    const gp_Pnt center = faceCenter(face);
    // A flat face has one normal. Reading it from the plane, as the browser does,
    // still works when the face centre falls in a hole through that face.
    gp_Dir normal = adaptor.Plane().Axis().Direction();
    if (face.Orientation() == TopAbs_REVERSED) normal.Reverse();
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

bool hollowOneSolid(const TopoDS_Shape& solid, double thickness, const nlohmann::json& openings, const std::string& corners, double cornerRadius, TopoDS_Shape& out, std::string& message) {
  TopTools_ListOfShape remove;
  std::string missing;
  if (!openingFaces(solid, openings, remove, missing)) {
    message = "This body has no flat " + missing + " face to leave open";
    return false;
  }
  const double original = volumeOf(solid);
  auto accept = [&](const TopoDS_Shape& candidate) {
    if (candidate.IsNull()) return false;
    const double volume = kernelShapeIsValid(candidate) ? volumeOf(candidate) : 0.0;
    return volume > 0 && volume < original * (1 - 1e-6);
  };
  TopoDS_Shape result;
  bool built = false;
  for (double tolerance : { 1e-6, 1e-3 }) {
    try {
      if (remove.Extent() > 0) {
        BRepOffsetAPI_MakeThickSolid thick;
        // OCCT's default arc join, as the browser kernel's shell uses: the
        // intersection join gave up on walls around a hole through an open face.
        thick.MakeThickSolidByJoin(solid, remove, -thickness, tolerance);
        if (thick.IsDone() && accept(thick.Shape())) {
          result = thick.Shape();
          built = true;
          break;
        }
      } else {
        BRepOffsetAPI_MakeOffsetShape offset;
        offset.PerformByJoin(solid, -thickness, tolerance);
        if (!offset.IsDone()) continue;
        TopoDS_Shape hollowed;
        if (kernelBoolean(KernelBooleanOp::Cut, solid, offset.Shape(), hollowed) && accept(hollowed)) {
          result = hollowed;
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

// Each solid of the body is hollowed on its own, with its own open faces, as the
// browser kernel does (a cut leaves the body wrapped in a compound, which the
// offset will not take).
bool hollowSolid(const TopoDS_Shape& body, double thickness, const nlohmann::json& openings, const std::string& corners, double cornerRadius, TopoDS_Shape& out, std::string& message) {
  std::vector<TopoDS_Shape> solids;
  for (TopExp_Explorer exp(body, TopAbs_SOLID); exp.More(); exp.Next()) solids.push_back(exp.Current());
  if (solids.empty()) return hollowOneSolid(body, thickness, openings, corners, cornerRadius, out, message);
  if (solids.size() == 1) return hollowOneSolid(solids[0], thickness, openings, corners, cornerRadius, out, message);
  BRep_Builder builder;
  TopoDS_Compound compound;
  builder.MakeCompound(compound);
  for (const auto& solid : solids) {
    TopoDS_Shape hollowed;
    if (!hollowOneSolid(solid, thickness, openings, corners, cornerRadius, hollowed, message)) return false;
    builder.Add(compound, hollowed);
  }
  out = compound;
  return true;
}

gp_Dir orthonormalU(const gp_Dir& axis) {
  gp_Vec helper = std::abs(axis.Y()) < 0.9 ? gp_Vec(0, 1, 0) : gp_Vec(1, 0, 0);
  gp_Vec u = helper.Crossed(gp_Vec(axis));
  if (u.Magnitude() < 1e-9) u = gp_Vec(1, 0, 0);
  return gp_Dir(u);
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
  if (!kernelHelixWire(origin, axis, u, faceRadius, pitch, length, job.value("handedness", "right") == "left", helix)
    || !kernelSweepAlongHelix(helix, profile.Wire(), axis, ridge)) {
    message = "Could not build a solid helical tooth from these thread dimensions";
    return false;
  }
  return true;
}

nlohmann::json previewMesh(const TopoDS_Shape& shape, int requestId, MeshQuality quality, bool includeBrep) {
  nlohmann::json positions, normals, indices;
  if (!tessellatePreview(shape, quality.linear, positions, normals, indices, quality.angular)) {
    // Callers store the shape as `accumulated` before meshing; an unmeshable
    // result must not be what a later `finalize` hands back.
    if (gSession.accumulated.IsSame(shape)) gSession.accumulated = TopoDS_Shape();
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
        TopoDS_Shape fused;
        if (!kernelBoolean(KernelBooleanOp::Fuse, body, rest[i], fused)) return modifierFail("Could not fuse group for fillet", true, requestId);
        body = fused;
      }
      // Two-body Group keeps the fuse as-is. Unify on a plate-plus-boss was
      // merging offset parallel faces into one warped sheet.
      const std::size_t busy = rest.size() + (!solids.empty() ? holes.size() : 0);
      if (busy >= 3) body = unifyKeepVolume(body);
      if (!solids.empty()) {
        for (const auto& hole : holes) {
          TopoDS_Shape cutBody;
          // A hole that fails to cut must not be dropped quietly: the fillet
          // would then be computed on a body with that hole filled in and the
          // result would silently differ from what the user sees on screen.
          if (!kernelBoolean(KernelBooleanOp::Cut, body, hole, cutBody)) return modifierFail("Could not cut group holes for fillet", true, requestId);
          body = cutBody;
        }
        // Repaired, then merged, as the browser kernel does after its hole cuts: an
        // offset (Hollow) gave up on the unrepaired walls around a hole.
        if (!holes.empty()) body = unifyKeepVolume(healShape(body));
      }
    } catch (...) {
      return modifierFail("Could not rebuild the solid for fillet", true, requestId);
    }
    gSession = {};
    gSession.base = body;
    gSession.live = true;
    const auto collected = collectEdges(body, job.value("sharpAngle", 20.0), job.value("suppressTreatmentDetailEdges", false));
    captureStretchedCone(job["parts"]);
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
  if (!gSession.live) return modifierFail("Prepare an object before previewing the modifier", false, requestId, true);
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
    return previewMesh(result, requestId, kSliderPreview, true);
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
        if (!kernelBoolean(KernelBooleanOp::Fuse, gSession.base, ridge, combined)) return modifierFail("Thread boolean failed. Try Draft quality, a shorter length, or a pitch that fits the face.", false, requestId);
      } else {
        if (!kernelBoolean(KernelBooleanOp::Cut, gSession.base, ridge, combined)) return modifierFail("Thread boolean failed. Try Draft quality, a shorter length, or a pitch that fits the face.", false, requestId);
      }
      combined = unify(combined);
      gSession.accumulated = combined;
      return previewMesh(combined, requestId, meshForQuality(job.value("quality", "standard")), true);
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
    if (!kernelShapeIsValid(result)) {
      return modifierFail("Push Pull produced an invalid solid at this distance. Try a smaller move.", false, requestId);
    }
    gSession.accumulated = result;
    return previewMesh(result, requestId, meshForQuality(job.value("quality", "standard")), true);
  }
  if (type == "preview") {
    std::vector<int> edgeIds;
    if (job.contains("edgeIds")) {
      for (const auto& id : job["edgeIds"]) edgeIds.push_back(id.get<int>());
    }
    TopoDS_Shape result;
    std::vector<int> skipped;
    const bool stretched = treatStretchedCone(job.value("kind", "fillet"), edgeIds, job.value("amount", 1.0), job.value("chamferAngle", 45.0), job.value("filletProfile", "round"), result, skipped);
    if (!stretched) skipped.clear();
    if (!stretched && !treatEdges(job.value("kind", "fillet"), edgeIds, job.value("amount", 1.0), job.value("chamferAngle", 45.0), job.value("filletProfile", "round"), result, skipped)) {
      const double largest = largestFittingSize(job.value("kind", "fillet"), edgeIds, job.value("amount", 1.0), job.value("chamferAngle", 45.0), job.value("filletProfile", "round"));
      if (largest > 0.0) return modifierFail(tooBigMessage(job.value("kind", "fillet"), largest), false, requestId);
      return modifierFail("The chosen size creates invalid or overlapping edge geometry", false, requestId);
    }
    nlohmann::json positions, normals, indices;
    if (!tessellatePreview(result, kSliderPreview.linear, positions, normals, indices, kSliderPreview.angular)) {
      return modifierFail("The chosen size creates invalid or overlapping edge geometry", false, requestId);
    }
    // Only a result that could be meshed becomes the shape `finalize` applies;
    // otherwise Apply after a failed preview would commit an unseen solid.
    gSession.accumulated = result;
    return {
      { "ok", true },
      { "type", "preview" },
      { "requestId", requestId },
      { "positions", positions },
      { "normals", normals },
      { "indices", indices },
      { "triangleCount", indices.size() / 3 },
      { "brep", "" },
      // Like the browser kernel: no outlines from the treated solid. Its fillet seams are
      // smooth, and the editor keeps the part's own sharp edges that were not treated.
      { "displayEdges", nlohmann::json::array() },
      { "skippedEdgeIds", skipped },
    };
  }
  if (type == "refine") {
    if (gSession.accumulated.IsNull()) return modifierFail("Preview an edge before smoothing it", false, requestId);
    nlohmann::json positions, normals, indices;
    if (!tessellatePreview(
      gSession.accumulated,
      job.value("linearDeflection", 0.055),
      positions,
      normals,
      indices,
      job.value("angularDeflection", 6.283185307179586 / 128.0))) {
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
      { "displayEdges", nlohmann::json::array() },
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
