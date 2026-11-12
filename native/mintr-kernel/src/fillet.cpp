#include "fillet.hpp"
#include "occtio.hpp"
#include "primitives.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <GCPnts_AbscissaPoint.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <GeomAPI_ProjectPointOnCurve.hxx>
#include <Geom_Curve.hxx>
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
#include <BRepClass_FaceClassifier.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <BRepLProp_SLProps.hxx>
#include <BRepLib_FindSurface.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepBuilderAPI_TransitionMode.hxx>
#include <BRepOffsetAPI_MakeOffset.hxx>
#include <BRepOffsetAPI_MakeOffsetShape.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
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
#include <GCPnts_TangentialDeflection.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Plane.hxx>
#include <GeomAbs_CurveType.hxx>
#include <GeomAbs_JoinType.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Message_ProgressIndicator.hxx>
#include <Message_ProgressRange.hxx>
#include <Message_ProgressScope.hxx>
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
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#include <gp_XYZ.hxx>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <memory>
#include <thread>
#include <cstdio>
#include <limits>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#include <BRepOffset_Mode.hxx>

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kWireDeflection = 0.035;

using TreatClock = std::chrono::steady_clock;
/** One click of Fillet or Chamfer gets this long for every try in its ladder of fallbacks. */
constexpr double kTreatBudgetMs = 3500.0;
/** One OCCT build of a blend, so one that spins for ever is given up on and the next try still runs. */
constexpr double kBuildBudgetMs = 2000.0;

/** When the current click's tries must stop. Set by treatEdges; checked before each try. */
TreatClock::time_point gTreatDeadline = TreatClock::time_point::max();

bool treatTimeIsUp() {
  return TreatClock::now() >= gTreatDeadline;
}

/** Stops an OCCT blend build at its deadline, through the builder's own progress hook. */
class BuildWatch : public Message_ProgressIndicator {
public:
  explicit BuildWatch(TreatClock::time_point end) : myEnd(end) {}
  bool UserBreak() override { return TreatClock::now() >= myEnd; }
  void Show(const Message_ProgressScope&, const bool) override {}

private:
  TreatClock::time_point myEnd;
};

/** A watch for one build; it must outlive the build, since the range it starts refers back to it. */
occ::handle<BuildWatch> buildWatch() {
  const TreatClock::time_point end = TreatClock::now() + std::chrono::milliseconds(static_cast<int>(kBuildBudgetMs));
  return new BuildWatch(std::min(end, gTreatDeadline));
}

/** True once a build was left running: the engine restarts after this reply to be rid of it. */
std::atomic<bool> gBuildAbandoned{ false };

/**
 * Builds the blend within its budget. OCCT's blend builder can spin for ever on a sliver
 * of a blend, and does not look at its progress hook while it does, so on the desktop the
 * build runs on its own thread and is abandoned at the deadline: the maker stays alive for
 * it, and the engine restarts once it has answered. In the browser there is no thread; the
 * hook is still offered, and the app restarts an engine that stops answering.
 */
template <class Maker>
bool buildWithinBudget(const std::shared_ptr<Maker>& maker) {
  const occ::handle<BuildWatch> watch = buildWatch();
#ifdef __EMSCRIPTEN__
  maker->Build(watch->Start());
  return maker->IsDone();
#else
  auto finished = std::make_shared<std::atomic<bool>>(false);
  std::thread builder([maker, watch, finished]() {
    try {
      maker->Build(watch->Start());
    } catch (...) {
    }
    finished->store(true);
  });
  const TreatClock::time_point end = std::min(
    TreatClock::now() + std::chrono::milliseconds(static_cast<int>(kBuildBudgetMs)), gTreatDeadline);
  while (!finished->load() && TreatClock::now() < end) std::this_thread::sleep_for(std::chrono::milliseconds(1));
  if (finished->load()) {
    builder.join();
    return maker->IsDone();
  }
  builder.detach();
  gBuildAbandoned.store(true);
  gTreatDeadline = TreatClock::now();
  return false;
#endif
}

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
}  // namespace

bool kernelNeedsRestart() {
  return gBuildAbandoned.load();
}

namespace {

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

/**
 * Rigid motion and uniform scale, as cadTransformIsSimilarity in the browser, allowing a
 * stretch too small to see: a design's rounded width against its STEP's exact box leaves
 * a scale a few hundred-thousandths off uniform, a micron over the part, and treating
 * that as a stretch would rebuild every flat and round face as a free-form surface.
 */
bool rowMajorIsSimilarity(const double m[12]) {
  const gp_Vec columns[3] = { gp_Vec(m[0], m[4], m[8]), gp_Vec(m[1], m[5], m[9]), gp_Vec(m[2], m[6], m[10]) };
  const double scale = columns[0].Magnitude();
  for (const gp_Vec& column : columns) {
    const double length = column.Magnitude();
    if (length < 1e-9 || std::abs(length - scale) > 1e-4 * std::max(1.0, scale)) return false;
  }
  const double limit = 1e-4 * scale * scale;
  return std::abs(columns[0].Dot(columns[1])) <= limit
    && std::abs(columns[1].Dot(columns[2])) <= limit
    && std::abs(columns[0].Dot(columns[2])) <= limit;
}

void applyRowMajor(TopoDS_Shape& shape, const nlohmann::json& transform) {
  if (!transform.is_array() || transform.size() < 12) return;
  const double m[12] = {
    transform[0].get<double>(), transform[1].get<double>(), transform[2].get<double>(), transform[3].get<double>(),
    transform[4].get<double>(), transform[5].get<double>(), transform[6].get<double>(), transform[7].get<double>(),
    transform[8].get<double>(), transform[9].get<double>(), transform[10].get<double>(), transform[11].get<double>(),
  };
  // A move, turn or even scale keeps planes and cylinders as they are. The general
  // transform rebuilds every face as a free-form surface, which makes each later
  // fillet, volume and mesh several times slower. Only a stretch needs it.
  // Same rule as applyCadTransform in the browser.
  if (rowMajorIsSimilarity(m)) {
    try {
      // Squared up to an exact turn at the mean scale, which SetValues insists on.
      gp_Vec x(m[0], m[4], m[8]);
      gp_Vec y(m[1], m[5], m[9]);
      gp_Vec z(m[2], m[6], m[10]);
      const double scale = (x.Magnitude() + y.Magnitude() + z.Magnitude()) / 3.0;
      x.Normalize();
      y = y - x * y.Dot(x);
      y.Normalize();
      z = x.Crossed(y) * (z.Dot(x.Crossed(y)) < 0 ? -1.0 : 1.0);
      gp_Trsf trsf;
      trsf.SetValues(
        x.X() * scale, y.X() * scale, z.X() * scale, m[3],
        x.Y() * scale, y.Y() * scale, z.Y() * scale, m[7],
        x.Z() * scale, y.Z() * scale, z.Z() * scale, m[11]);
      shape = BRepBuilderAPI_Transform(shape, trsf, true).Shape();
      return;
    } catch (const Standard_Failure&) {
    }
  }
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
bool tessellatePreview(const TopoDS_Shape& shape, double linear, nlohmann::json& positions, nlohmann::json& normals, nlohmann::json& indices, double angular = 0.0, double targetTriangles = 0.0) {
  // Meshed in place so a later refine of the same solid starts from it. Corners are
  // shared within each face, as the browser kernel sends them.
  KernelMeshOptions options;
  options.shareNodes = true;
  options.copyFirst = false;
  options.maxAngular = 0.16;
  options.targetTriangles = targetTriangles;
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

/**
 * The edge on `shape` that is `target`, or what is left of it. A treatment next door trims
 * an edge at its end but keeps its curve, so the middle of the original still lies on it,
 * running the same way; the new edges a treatment adds run beside the old one, never
 * through its middle. Nothing is found once the edge is more than half gone.
 */
bool matchEdgeOnShape(
  const TopoDS_Shape& shape,
  const TopoDS_Edge& target,
  TopoDS_Edge& outEdge,
  TopoDS_Face& outFace
) {
  gp_Pnt targetMid;
  double targetLen = 0;
  if (!edgeMidAndLength(target, targetMid, targetLen)) return false;
  gp_Vec targetDir;
  try {
    BRepAdaptor_Curve curve(target);
    targetDir = curve.DN((curve.FirstParameter() + curve.LastParameter()) * 0.5, 1);
  } catch (...) {
    return false;
  }
  if (targetDir.Magnitude() < 1e-9) return false;
  targetDir.Normalize();
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
    try {
      double first = 0;
      double last = 0;
      const Handle(Geom_Curve) curve = BRep_Tool::Curve(edge, first, last);
      if (curve.IsNull()) continue;
      GeomAPI_ProjectPointOnCurve projector(targetMid, curve, first, last);
      if (projector.NbPoints() < 1 || projector.LowerDistance() > 0.05) continue;
      gp_Vec dir = curve->DN(projector.LowerDistanceParameter(), 1);
      if (dir.Magnitude() < 1e-9 || std::abs(dir.Normalized().Dot(targetDir)) < 0.9) continue;
      const double score = projector.LowerDistance() + std::abs(len - targetLen) * 0.01;
      if (score < best) {
        best = score;
        bestIndex = i;
        outEdge = edge;
      }
    } catch (...) {
      continue;
    }
  }
  if (bestIndex == 0) return false;
  const TopTools_ListOfShape& faces = map.FindFromIndex(bestIndex);
  if (faces.Extent() > 0) outFace = TopoDS::Face(faces.First());
  return true;
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

bool containsPoint(const TopoDS_Shape& solid, const gp_Pnt& point);
bool edgeIsInterior(const TopoDS_Shape& solid, const TopoDS_Edge& edge);
int solidCountWithVolume(const TopoDS_Shape& shape);
TopoDS_Shape healShape(const TopoDS_Shape& shape);

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

/** A treatment may change the volume by this many times its own profile before it is a blend gone wrong. */
constexpr double kTreatmentSlack = 8.0;

/**
 * The cross-section a round or a chamfer takes off a sharp edge, or fills into an inside
 * one, where the faces meet at `wedgeDeg` (90 on a box edge, less at a sharper corner). A
 * round is the corner square less its quarter circle; a chamfer is the triangle it cuts.
 */
double profileArea(const std::string& kind, double amount, double chamferAngle, double wedgeDeg) {
  const double wedge = std::max(10.0, std::min(170.0, wedgeDeg)) * kPi / 180.0;
  if (kind == "chamfer") {
    const double angle = std::max(5.0, std::min(85.0, chamferAngle)) * kPi / 180.0;
    return 0.5 * amount * amount * std::tan(angle) * std::sin(wedge);
  }
  return amount * amount * (1.0 / std::tan(wedge / 2.0) - (kPi - wedge) / 2.0);
}

/** The angle inside the corner at an edge: 90 on a box edge, under 90 at a sharp inside crease. */
double wedgeAngleAt(const TopoDS_Shape& solid, const TopTools_IndexedDataMapOfShapeListOfShape& faceMap, const TopoDS_Edge& edge) {
  try {
    if (!faceMap.Contains(edge)) return 90.0;
    const TopTools_ListOfShape& faces = faceMap.FindFromKey(edge);
    if (faces.Extent() < 2) return 90.0;
    gp_Pnt mid;
    double length = 0.0;
    if (!edgeMidAndLength(edge, mid, length)) return 90.0;
    const gp_Vec n1 = reliableOutwardNormal(solid, TopoDS::Face(faces.First()), mid);
    const gp_Vec n2 = reliableOutwardNormal(solid, TopoDS::Face(faces.Last()), mid);
    const double dot = std::max(-1.0, std::min(1.0, n1.Dot(n2)));
    return 180.0 - std::acos(dot) * 180.0 / kPi;
  } catch (...) {
    return 90.0;
  }
}

/**
 * How much a treatment of this size may change the volume along `edge`: a generous multiple
 * of its profile over `reach`, the length OCCT blends (an edge and the smooth neighbours it
 * runs on along). Beyond that the blend has gone wrong, however valid the solid.
 */
double treatmentAllowance(
  const std::string& kind,
  double amount,
  double chamferAngle,
  const TopoDS_Shape& solid,
  const TopTools_IndexedDataMapOfShapeListOfShape& faceMap,
  const TopoDS_Edge& edge,
  double reach
) {
  const double area = std::max(profileArea(kind, amount, chamferAngle, wedgeAngleAt(solid, faceMap, edge)), 0.02 * amount * amount);
  return kTreatmentSlack * area * std::max(reach, 1e-3) + 1e-3;
}

int shellCount(const TopoDS_Shape& shape) {
  int count = 0;
  for (TopExp_Explorer exp(shape, TopAbs_SHELL); exp.More(); exp.Next()) count += 1;
  return count;
}

/**
 * A treatment that left a sound part: valid, still the same bodies with the same skins, and
 * changed by no more than the allowance. An inside edge gains material and an outside edge
 * loses it; both are kept. A change far beyond what the size could make is a blend gone
 * wrong (a bulge at the end of an inside crease), which is worse than leaving the edge alone.
 */
bool treatmentLooksSound(const TopoDS_Shape& before, const TopoDS_Shape& after, double allowance, double& change) {
  if (after.IsNull()) return false;
  change = volumeOf(after) - volumeOf(before);
  if (!(std::abs(change) > 1e-4) || std::abs(change) > allowance) return false;
  if (solidCountWithVolume(after) != solidCountWithVolume(before) || shellCount(after) != shellCount(before)) return false;
  return kernelShapeIsValid(after);
}

/**
 * Edges treated next to neighbours already treated must do about what they did on the
 * untouched part: the same way round, and neither several times bigger nor smaller.
 */
bool changeMatches(double change, double expected) {
  if (change * expected <= 0) return false;
  const double ratio = std::abs(change) / std::abs(expected);
  return ratio >= 0.5 && ratio <= 1.5;
}

/** The length OCCT will blend for `edge`: it follows an edge round its smooth neighbours. */
template <class Maker>
double contourLength(const Maker& maker, const TopoDS_Edge& edge) {
  try {
    const int contour = maker.Contour(edge);
    return contour > 0 ? maker.Length(contour) : 0.0;
  } catch (...) {
    return 0.0;
  }
}

/**
 * The edges rounded or bevelled in one OCCT build on `solid`, with how much that build may
 * change the volume. Edges that meet at corners blend far better in one build than one at
 * a time. A cove cuts its own grooves and has no allowance.
 */
bool treatGroup(
  const std::string& kind,
  const TopoDS_Shape& solid,
  const std::vector<TopoDS_Edge>& edges,
  const std::vector<TopoDS_Face>& faces,
  double amount,
  double chamferAngle,
  const std::string& filletProfile,
  TopoDS_Shape& out,
  double& allowance
) {
  allowance = std::numeric_limits<double>::infinity();
  if (kind == "fillet" && filletProfile == "cove") return coveEdges(solid, edges, amount, out);
  TopTools_IndexedDataMapOfShapeListOfShape faceMap;
  TopExp::MapShapesAndAncestors(solid, TopAbs_EDGE, TopAbs_FACE, faceMap);
  allowance = 0.0;
  auto allow = [&](const auto& maker) {
    for (const auto& edge : edges) {
      gp_Pnt mid;
      double length = 0.0;
      if (!edgeMidAndLength(edge, mid, length)) continue;
      allowance += treatmentAllowance(kind, amount, chamferAngle, solid, faceMap, edge, std::max(contourLength(maker, edge), length));
    }
  };
  if (kind == "fillet") {
    auto maker = std::make_shared<BRepFilletAPI_MakeFillet>(solid);
    for (const auto& edge : edges) maker->Add(amount, edge);
    allow(*maker);
    if (!buildWithinBudget(maker)) return false;
    out = maker->Shape();
    return !out.IsNull();
  }
  auto maker = std::make_shared<BRepFilletAPI_MakeChamfer>(solid);
  for (size_t i = 0; i < edges.size(); ++i) {
    const TopoDS_Face face = i < faces.size() ? faces[i] : TopoDS_Face();
    if (std::abs(chamferAngle - 45.0) < 0.001 || face.IsNull()) maker->Add(amount, edges[i]);
    else maker->AddDA(amount, chamferAngle * kPi / 180.0, edges[i], face);
  }
  allow(*maker);
  if (!buildWithinBudget(maker)) return false;
  out = maker->Shape();
  return !out.IsNull();
}

bool treatEdgesTogether(
  const std::string& kind,
  const std::vector<int>& selected,
  double amount,
  double chamferAngle,
  const std::string& filletProfile,
  TopoDS_Shape& out,
  double& allowance
) {
  std::vector<TopoDS_Edge> edges;
  std::vector<TopoDS_Face> faces;
  for (int id : selected) {
    edges.push_back(gSession.edges[static_cast<size_t>(id)]);
    faces.push_back(gSession.edgeFaces[static_cast<size_t>(id)]);
  }
  TopoDS_Shape treated;
  if (!treatGroup(kind, gSession.base, edges, faces, amount, chamferAngle, filletProfile, treated, allowance)) return false;
  out = unify(treated);
  return !out.IsNull();
}

bool treatOneEdge(
  const std::string& kind,
  const TopoDS_Shape& solid,
  const TopoDS_Edge& edge,
  const TopoDS_Face& face,
  double amount,
  double chamferAngle,
  const std::string& filletProfile,
  TopoDS_Shape& next,
  double& allowance
) {
  try {
    return treatGroup(kind, solid, { edge }, { face }, amount, chamferAngle, filletProfile, next, allowance);
  } catch (...) {
    return false;
  }
}

/**
 * One edge at a time on top of each other, for edges OCCT would not blend as a set. Each
 * is found again on the solid the last one made. OCCT runs a blend on along any selected
 * neighbour it meets smoothly (past the round end of a blend already made), so the edges
 * a step uses up are counted with it, and the step must do about what those edges do on
 * their own (`expected`): a blend that comes out several times bigger, or the other way
 * round, has gone wrong at the join and is skipped instead.
 */
bool treatEdgesOneByOne(
  const std::string& kind,
  const std::vector<int>& selected,
  const std::map<int, double>& expected,
  double amount,
  double chamferAngle,
  const std::string& filletProfile,
  TopoDS_Shape& out,
  std::vector<int>& skipped
) {
  TopoDS_Shape acc = gSession.base;
  bool any = false;
  std::vector<int> waiting = selected;
  auto present = [&](const TopoDS_Shape& solid, int id) {
    TopoDS_Edge edge;
    TopoDS_Face face;
    return matchEdgeOnShape(solid, gSession.edges[static_cast<size_t>(id)], edge, face);
  };
  while (!waiting.empty()) {
    const int id = waiting.front();
    waiting.erase(waiting.begin());
    if (treatTimeIsUp()) {
      skipped.push_back(id);
      continue;
    }
    const TopoDS_Edge& baseEdge = gSession.edges[static_cast<size_t>(id)];
    const TopoDS_Face& baseFace = gSession.edgeFaces[static_cast<size_t>(id)];
    TopoDS_Edge edge = baseEdge;
    TopoDS_Face face = baseFace;
    if (any && !matchEdgeOnShape(acc, baseEdge, edge, face)) {
      skipped.push_back(id);
      continue;
    }
    TopoDS_Shape next;
    double allowance = 0.0;
    double change = 0.0;
    bool ok = treatOneEdge(kind, acc, edge, face, amount, chamferAngle, filletProfile, next, allowance)
      && treatmentLooksSound(acc, next, allowance, change);
    std::vector<int> usedUp;
    if (ok) {
      double sum = expected.at(id);
      for (int other : waiting) {
        if (present(acc, other) && !present(next, other)) {
          usedUp.push_back(other);
          sum += expected.at(other);
        }
      }
      if (any) ok = changeMatches(change, sum);
    }
    if (!ok) {
      skipped.push_back(id);
      continue;
    }
    for (int other : usedUp) waiting.erase(std::remove(waiting.begin(), waiting.end(), other), waiting.end());
    acc = next;
    any = true;
  }
  if (!any) return false;
  out = unify(acc);
  return !out.IsNull();
}

/**
 * A cove one groove at a time, as the browser kernel cut it, with the inside corners the
 * groove could not run along cut round afterwards.
 */
bool coveEdgesOneByOne(
  const std::vector<int>& selected,
  double amount,
  double chamferAngle,
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
    double allowance = 0.0;
    const bool ok = treatOneEdge("fillet", acc, edge, face, amount, chamferAngle, "cove", next, allowance)
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
    if (!cutConcaveCorners(acc, gSession.base, { concave[index] }, "fillet", amount, chamferAngle, cut, message)) continue;
    acc = cut;
    missed.erase(std::remove(missed.begin(), missed.end(), concaveIds[index]), missed.end());
  }
  skipped = missed;
  out = unify(acc);
  return !out.IsNull();
}

/**
 * Outside edges in one build, then inside edges in one build on the result, or the other
 * way round. OCCT often refuses the two kinds mixed in one build, yet blends each kind as a
 * set, with proper corners, where one edge at a time would not. The set on top must do
 * about what it does on its own. The set that fails is skipped; the order that treats more
 * edges wins.
 */
bool treatEdgesBySubsets(
  const std::string& kind,
  const std::vector<int>& selected,
  double amount,
  double chamferAngle,
  const std::string& filletProfile,
  TopoDS_Shape& out,
  std::vector<int>& skipped
) {
  std::vector<int> convex;
  std::vector<int> concave;
  for (int id : selected) {
    (edgeIsInterior(gSession.base, gSession.edges[static_cast<size_t>(id)]) ? concave : convex).push_back(id);
  }
  if (convex.empty() || concave.empty()) return false;
  auto group = [&](const TopoDS_Shape& solid, const std::vector<int>& ids, TopoDS_Shape& treated, double& change) {
    std::vector<TopoDS_Edge> edges;
    std::vector<TopoDS_Face> faces;
    for (int id : ids) {
      TopoDS_Edge edge = gSession.edges[static_cast<size_t>(id)];
      TopoDS_Face face = gSession.edgeFaces[static_cast<size_t>(id)];
      if (!solid.IsSame(gSession.base) && !matchEdgeOnShape(solid, gSession.edges[static_cast<size_t>(id)], edge, face)) return false;
      edges.push_back(edge);
      faces.push_back(face);
    }
    double allowance = 0.0;
    try {
      return treatGroup(kind, solid, edges, faces, amount, chamferAngle, filletProfile, treated, allowance)
        && treatmentLooksSound(solid, treated, allowance, change);
    } catch (...) {
      return false;
    }
  };
  auto attempt = [&](const std::vector<int>& first, const std::vector<int>& second, TopoDS_Shape& result, std::vector<int>& left) {
    TopoDS_Shape base;
    double change = 0.0;
    if (treatTimeIsUp() || !group(gSession.base, first, base, change)) return false;
    TopoDS_Shape both;
    TopoDS_Shape alone;
    double onTop = 0.0;
    double expected = 0.0;
    if (group(base, second, both, onTop) && group(gSession.base, second, alone, expected) && changeMatches(onTop, expected)) {
      result = both;
      left.clear();
    } else {
      result = base;
      left = second;
    }
    return true;
  };
  TopoDS_Shape convexFirst;
  TopoDS_Shape concaveFirst;
  std::vector<int> leftA;
  std::vector<int> leftB;
  const bool a = attempt(convex, concave, convexFirst, leftA);
  if (a && leftA.empty()) {
    out = unify(convexFirst);
    return !out.IsNull();
  }
  const bool b = attempt(concave, convex, concaveFirst, leftB);
  if (b && (!a || leftB.size() < leftA.size())) {
    skipped = leftB;
    out = unify(concaveFirst);
    return !out.IsNull();
  }
  if (!a) return false;
  skipped = leftA;
  out = unify(convexFirst);
  return !out.IsNull();
}

/**
 * Last resorts. A chamfer on a surface OCCT's chamfer refuses (a resized round roof) is cut
 * as a wedge off each outside edge; an inside edge gets none, since a wedge there would cut
 * a groove where the chamfer should fill. A cove treats what it can together and cuts its
 * remaining inside corners round, as the browser kernel did.
 */
bool treatEdgesByCornerCut(
  const std::string& kind,
  const std::vector<int>& selected,
  double amount,
  double chamferAngle,
  const std::string& filletProfile,
  TopoDS_Shape& out,
  std::vector<int>& skipped,
  std::string& message
) {
  const TopoDS_Shape& solid = gSession.base;
  const double before = volumeOf(solid);
  if (kind == "chamfer") {
    TopoDS_Shape current = solid;
    bool progressed = false;
    for (int id : selected) {
      const TopoDS_Edge& edge = gSession.edges[static_cast<size_t>(id)];
      TopoDS_Shape cut;
      std::string ignored;
      if (!edgeIsInterior(solid, edge)
        && cutConcaveCorners(current, solid, { edge }, "chamfer", amount, chamferAngle, cut, ignored)
        && volumeOf(cut) + 1e-3 < volumeOf(current)) {
        current = cut;
        progressed = true;
      } else {
        skipped.push_back(id);
      }
    }
    if (progressed && volumeOf(current) + 1e-3 < before) {
      out = unify(current);
      return true;
    }
    skipped.clear();
    return false;
  }
  if (filletProfile != "cove") return false;
  std::vector<int> convexIds;
  std::vector<TopoDS_Edge> concave;
  for (int id : selected) {
    const TopoDS_Edge& edge = gSession.edges[static_cast<size_t>(id)];
    if (edgeIsInterior(solid, edge)) concave.push_back(edge);
    else convexIds.push_back(id);
  }
  TopoDS_Shape component = solid;
  if (!convexIds.empty() || concave.empty()) {
    double allowance = 0.0;
    if (!treatEdgesTogether(kind, convexIds.empty() ? selected : convexIds, amount, chamferAngle, filletProfile, component, allowance)) return false;
  }
  if (!concave.empty()) {
    TopoDS_Shape cut;
    if (!cutConcaveCorners(onlySolid(component), solid, concave, kind, amount, chamferAngle, cut, message)) return false;
    component = cut;
  }
  out = unify(onlySolid(component));
  return !out.IsNull() && kernelShapeIsValid(out);
}

/** The outline of a flat face offset inwards by `inset`, as one wire, or none when the offset breaks up. */
bool insetOutline(const TopoDS_Face& face, double inset, TopoDS_Wire& wire) {
  const TopoDS_Wire outline = BRepTools::OuterWire(face);
  if (outline.IsNull()) return false;
  if (inset <= 1e-6) {
    wire = outline;
    return true;
  }
  const double area = faceArea(face);
  // Which way is inwards depends on the wire's sense; the smaller outline is the one wanted.
  for (const double sign : { -1.0, 1.0 }) {
    try {
      BRepOffsetAPI_MakeOffset offset(face, GeomAbs_Intersection, false);
      offset.Perform(sign * inset);
      if (!offset.IsDone()) continue;
      TopoDS_Wire found;
      int count = 0;
      for (TopExp_Explorer exp(offset.Shape(), TopAbs_WIRE); exp.More(); exp.Next()) {
        found = TopoDS::Wire(exp.Current());
        count += 1;
      }
      if (count != 1 || found.IsNull()) continue;
      const TopoDS_Face inner = BRepBuilderAPI_MakeFace(found, Standard_True).Face();
      if (inner.IsNull() || !(faceArea(inner) < area)) continue;
      wire = found;
      return true;
    } catch (...) {
    }
  }
  return false;
}

/**
 * The selected edges as the whole outline of one flat face, rounded or bevelled as a band
 * cut around that face. OCCT's own blend refuses an outline where an arc meets a straight
 * edge at an inside corner (the top of a box joined to a cylinder); the band has no corner
 * problem, since the outline offset inwards keeps every corner sharp. The outline is offset
 * and lowered in steps along the profile, lofted into the solid to keep, and the face's top
 * layer is cut down to that. Only a face whose sides stand square to it along outside
 * edges, and only when every edge of its outline is selected and nothing else.
 */
bool treatOutlineBand(
  const std::string& kind,
  const std::vector<int>& selected,
  double amount,
  double chamferAngle,
  TopoDS_Shape& out
) {
  // A fuse keeps the box's top and the cylinder's top as two faces in one plane; merged,
  // they are the one face whose outline the user picked, and its split arcs are whole.
  const TopoDS_Shape solid = onlySolid(unify(gSession.base));
  if (solid.IsNull() || solidCountWithVolume(solid) != solidCountWithVolume(gSession.base)) return false;
  TopTools_IndexedDataMapOfShapeListOfShape faceMap;
  TopExp::MapShapesAndAncestors(solid, TopAbs_EDGE, TopAbs_FACE, faceMap);
  std::vector<TopoDS_Edge> edges;
  for (int id : selected) {
    TopoDS_Edge edge;
    TopoDS_Face face;
    if (!matchEdgeOnShape(solid, gSession.edges[static_cast<size_t>(id)], edge, face)) return false;
    if (std::none_of(edges.begin(), edges.end(), [&](const TopoDS_Edge& other) { return other.IsSame(edge); })) edges.push_back(edge);
  }
  // The one flat face whose outline is exactly the selection.
  TopoDS_Face face;
  if (!faceMap.Contains(edges.front())) return false;
  for (TopTools_ListOfShape::Iterator it(faceMap.FindFromKey(edges.front())); it.More(); it.Next()) {
    const TopoDS_Face candidate = TopoDS::Face(it.Value());
    BRepAdaptor_Surface surface(candidate, Standard_True);
    if (surface.GetType() != GeomAbs_Plane) continue;
    const TopoDS_Wire outline = BRepTools::OuterWire(candidate);
    if (outline.IsNull()) continue;
    std::vector<TopoDS_Edge> rim;
    for (TopExp_Explorer exp(outline, TopAbs_EDGE); exp.More(); exp.Next()) {
      const TopoDS_Edge edge = TopoDS::Edge(exp.Current());
      if (!BRep_Tool::Degenerated(edge)) rim.push_back(edge);
    }
    const auto has = [](const std::vector<TopoDS_Edge>& list, const TopoDS_Edge& edge) {
      return std::any_of(list.begin(), list.end(), [&](const TopoDS_Edge& other) { return other.IsSame(edge); });
    };
    if (rim.size() != edges.size()) continue;
    if (!std::all_of(rim.begin(), rim.end(), [&](const TopoDS_Edge& edge) { return has(edges, edge); })) continue;
    face = candidate;
    break;
  }
  if (face.IsNull()) return false;
  gp_Pnt mid;
  double length = 0.0;
  if (!edgeMidAndLength(edges.front(), mid, length)) return false;
  gp_Vec normal;
  try {
    normal = reliableOutwardNormal(solid, face, mid);
  } catch (...) {
    return false;
  }
  double allowance = 0.0;
  for (const auto& edge : edges) {
    // Every edge an outside one standing square to the face; an inside edge (the foot of a
    // boss on the face) wants filling, which a band cut would groove instead.
    if (std::abs(wedgeAngleAt(solid, faceMap, edge) - 90.0) > 5.0 || edgeIsInterior(solid, edge)) return false;
    if (edgeMidAndLength(edge, mid, length)) allowance += treatmentAllowance(kind, amount, chamferAngle, solid, faceMap, edge, length);
  }
  // The profile as (inset along the face, depth below it): a chamfer's two legs, or a
  // quarter circle in steps for a round.
  std::vector<std::pair<double, double>> profile;
  if (kind == "chamfer") {
    const double angle = std::max(5.0, std::min(85.0, chamferAngle)) * kPi / 180.0;
    profile = { { amount, 0.0 }, { 0.0, amount * std::tan(angle) } };
  } else {
    const int steps = 8;
    for (int step = 0; step <= steps; ++step) {
      const double theta = (static_cast<double>(step) / steps) * kPi / 2.0;
      profile.emplace_back(amount * (1.0 - std::sin(theta)), amount * (1.0 - std::cos(theta)));
    }
  }
  try {
    BRepOffsetAPI_ThruSections loft(Standard_True, kind == "chamfer", 1e-6);
    for (const auto& [inset, depth] : profile) {
      TopoDS_Wire section;
      if (!insetOutline(face, inset, section)) return false;
      if (depth > 1e-9) {
        gp_Trsf lower;
        lower.SetTranslation(normal * -depth);
        section = TopoDS::Wire(BRepBuilderAPI_Transform(section, lower, true).Shape());
      }
      loft.AddWire(section);
    }
    loft.Build();
    if (!loft.IsDone()) return false;
    const TopoDS_Shape keep = loft.Shape();
    if (keep.IsNull() || solidCount(keep) != 1) return false;
    // The top layer of the part down to the profile's depth, less the solid to keep, is cut off.
    const TopoDS_Shape layer = BRepPrimAPI_MakePrism(face, normal * -profile.back().second).Shape();
    TopoDS_Shape tool;
    if (!kernelBoolean(KernelBooleanOp::Cut, layer, keep, tool)) return false;
    TopoDS_Shape cut;
    if (!kernelBoolean(KernelBooleanOp::Cut, solid, tool, cut)) return false;
    cut = unify(onlySolid(cut));
    double change = 0.0;
    if (!treatmentLooksSound(solid, cut, allowance, change) || change >= 0.0) return false;
    out = cut;
    return true;
  } catch (...) {
    return false;
  }
}

/**
 * Mintr's own blend, built with booleans, for the edges OCCT's blend builder leaves out.
 *
 * The cross-section of a round at an edge is the kite O-P1-C-P2: O on the edge, P1 and P2
 * where a ball of the radius touches each face, C the ball's centre. The round takes the
 * kite less the ball's circle off an outside edge, or fills it into an inside one; a chamfer
 * takes or fills the triangle O-P1-P2. Swept along the edge (a prism along a straight edge,
 * a turn about the axis along a circular one) the kite is the zone and the ball the tube.
 * All the zones of one kind are gathered, the tubes and the corner balls are taken out of
 * them, and the rest is fused into the part (inside edges) and then cut from it (outside
 * edges), so the pieces meet at the corners by themselves: the union of the tubes is the
 * ball's whole path round an inside corner, a ball at a corner where three edges meet is
 * the round's corner, and a zone run on a little past a corner closes the gap there.
 *
 * Exact for straight and circular edges between flat and cylindrical faces, which is every
 * edge of a box joined to a cylinder; anything else is left to OCCT.
 */
constexpr double kZoneSlack = 0.02;

struct SectionCurve {
  bool circle = false;
  bool plane = false;   // the face is flat
  gp_Pnt origin;  // on the curve, at the edge
  gp_Vec along;   // unit, along the curve into the face at the edge
  gp_Vec outward; // unit outward normal of the face at the edge
  gp_Pnt centre;  // circle only
  double radius = 0.0;
  bool materialInside = false;  // circle only: the part lies inside the cylinder
};

/** A swept solid the right way out: a section wound the other way sweeps to an inside-out solid, which booleans treat as its complement. */
TopoDS_Shape rightWayOut(const TopoDS_Shape& shape) {
  GProp_GProps props;
  BRepGProp::VolumeProperties(shape, props);
  return props.Mass() < 0 ? shape.Reversed() : shape;
}

struct BlendSection {
  gp_Pnt o;
  gp_Pnt p1;
  gp_Pnt p2;
  gp_Pnt c;
};

struct BlendPiece {
  bool convex = true;
  TopoDS_Shape zone;
  TopoDS_Shape tube;  // null for a chamfer
  gp_Pnt ballStart;   // the ball's centre at each end of the edge
  gp_Pnt ballEnd;
  TopoDS_Vertex vertexStart;
  TopoDS_Vertex vertexEnd;
  SectionCurve a;     // the two faces' sections, for the corner balls
  SectionCurve b;
};

/** The point on `curve` reached from its origin by `distance` along it, in its `along` direction. */
gp_Pnt alongCurve(const SectionCurve& curve, double distance) {
  if (!curve.circle) return curve.origin.Translated(curve.along * distance);
  const gp_Vec spoke(curve.centre, curve.origin);
  const gp_Vec axis = spoke.Crossed(curve.along).Normalized();
  gp_Trsf turn;
  turn.SetRotation(gp_Ax1(curve.centre, gp_Dir(axis)), distance / curve.radius);
  return curve.origin.Transformed(turn);
}

/** The face's outward normal at `point` on the section curve. */
gp_Vec curveOutward(const SectionCurve& curve, const gp_Pnt& point) {
  if (!curve.circle) return curve.outward;
  gp_Vec spoke(curve.centre, point);
  spoke.Normalize();
  return curve.materialInside ? spoke : spoke.Reversed();
}

/** The face at `point`'s foot of a point `from` off the face. */
gp_Pnt footOnCurve(const SectionCurve& curve, const gp_Pnt& from) {
  if (!curve.circle) {
    const gp_Vec offset(curve.origin, from);
    return from.Translated(curve.outward * -(offset.Dot(curve.outward)));
  }
  gp_Vec spoke(curve.centre, from);
  spoke.Normalize();
  return curve.centre.Translated(spoke * curve.radius);
}

/** The face's section at the edge: a line for a flat face, a circle for a cylinder the edge runs along. */
bool sectionCurveAt(const TopoDS_Shape& solid, const TopoDS_Face& face, const gp_Pnt& origin, const gp_Vec& tangent, SectionCurve& curve) {
  try {
    BRepAdaptor_Surface surface(face, Standard_True);
    curve.origin = origin;
    curve.outward = reliableOutwardNormal(solid, face, origin);
    curve.plane = surface.GetType() == GeomAbs_Plane;
    if (curve.plane) {
      curve.circle = false;
      return true;
    }
    if (surface.GetType() != GeomAbs_Cylinder) return false;
    const gp_Cylinder cylinder = surface.Cylinder();
    const gp_Dir axis = cylinder.Axis().Direction();
    const double alongAxis = std::abs(gp_Vec(axis).Dot(tangent));
    if (alongAxis < 1e-3) {
      // The edge runs round the cylinder: its section is a line along the axis.
      curve.circle = false;
      return true;
    }
    if (alongAxis < 0.999) return false;
    const gp_Pnt axisPoint = cylinder.Location();
    const gp_Vec toOrigin(axisPoint, origin);
    curve.circle = true;
    curve.centre = axisPoint.Translated(gp_Vec(axis) * toOrigin.Dot(gp_Vec(axis)));
    curve.radius = cylinder.Radius();
    curve.materialInside = gp_Vec(curve.centre, origin).Dot(curve.outward) > 0;
    return true;
  } catch (...) {
    return false;
  }
}

/** The ball's centre: `radius` off both section curves, on the side the blend lives. */
bool ballCentre(const SectionCurve& a, const SectionCurve& b, double radius, bool convex, gp_Pnt& centre) {
  const double side = convex ? -1.0 : 1.0;  // the blend lies inside the part at an outside edge
  if (!a.circle && !b.circle) {
    const gp_Vec m1 = a.outward * side;
    const gp_Vec m2 = b.outward * side;
    const double denominator = a.along.Dot(m2);
    if (std::abs(denominator) < 1e-6) return false;
    const double x = radius * (1.0 - m1.Dot(m2)) / denominator;
    centre = a.origin.Translated(a.along * x + m1 * radius);
    return true;
  }
  if (a.circle && b.circle) return false;
  const SectionCurve& line = a.circle ? b : a;
  const SectionCurve& round = a.circle ? a : b;
  const gp_Vec m = line.outward * side;
  const bool ballInside = round.materialInside == convex;
  const double reach = ballInside ? round.radius - radius : round.radius + radius;
  if (reach <= 1e-6) return false;
  const gp_Vec d(round.centre, line.origin.Translated(m * radius));
  const double half = d.Dot(line.along);
  const double constant = d.SquareMagnitude() - reach * reach;
  const double discriminant = half * half - constant;
  if (discriminant < 0.0) return false;
  const double root = std::sqrt(discriminant);
  const double x1 = -half + root;
  const double x2 = -half - root;
  // The root nearest the edge on the face's side of it.
  double x = x1;
  if (x2 >= -1e-9 && (x1 < -1e-9 || x2 < x1)) x = x2;
  if (x < -1e-9) return false;
  centre = line.origin.Translated(line.along * x + m * radius);
  return true;
}

/** The zone's section as a face: the kite for a round, the triangle for a chamfer, a hair outside the faces. */
bool sectionFace(const SectionCurve& a, const SectionCurve& b, const BlendSection& section, bool convex, bool round, TopoDS_Face& face) {
  try {
    const double out = convex ? kZoneSlack : -kZoneSlack;
    gp_Vec bisector = a.outward + b.outward;
    if (bisector.Magnitude() < 1e-6) return false;
    bisector.Normalize();
    const gp_Pnt o = section.o.Translated(bisector * out);
    const gp_Pnt p1 = section.p1.Translated(curveOutward(a, section.p1) * out);
    const gp_Pnt p2 = section.p2.Translated(curveOutward(b, section.p2) * out);
    BRepBuilderAPI_MakeWire wire;
    auto alongFace = [&](const SectionCurve& curve, const gp_Pnt& from, const gp_Pnt& to) {
      if (!curve.circle) {
        wire.Add(BRepBuilderAPI_MakeEdge(from, to).Edge());
        return;
      }
      gp_Vec middle = gp_Vec(curve.centre, from).Normalized() + gp_Vec(curve.centre, to).Normalized();
      middle.Normalize();
      const gp_Pnt mid = curve.centre.Translated(middle * curve.radius).Translated(curveOutward(curve, curve.centre.Translated(middle * curve.radius)) * out);
      wire.Add(BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(from, mid, to).Value()).Edge());
    };
    alongFace(a, o, p1);
    if (round) {
      wire.Add(BRepBuilderAPI_MakeEdge(p1, section.c).Edge());
      wire.Add(BRepBuilderAPI_MakeEdge(section.c, p2).Edge());
    } else {
      wire.Add(BRepBuilderAPI_MakeEdge(p1, p2).Edge());
    }
    alongFace(b, p2, o);
    if (!wire.IsDone()) return false;
    face = BRepBuilderAPI_MakeFace(wire.Wire(), Standard_True).Face();
    return !face.IsNull();
  } catch (...) {
    return false;
  }
}

/** An edge's section frame: the two face sections at its start, and which way the part lies. */
struct EdgeFrame {
  TopoDS_Edge edge;
  bool line = true;
  bool convex = true;
  gp_Pnt start;      // on the edge, half way along, where the section is set up
  gp_Vec tangent;    // the edge's direction there
  gp_Trsf toStart;   // moves the section from there to the edge's start
  gp_Vec awayStart;  // the edge's direction on past each end
  gp_Vec awayEnd;
  double first = 0.0;
  double last = 0.0;
  SectionCurve a;
  SectionCurve b;
  TopoDS_Vertex vertexStart;
  TopoDS_Vertex vertexEnd;
};

bool edgeFrame(const TopoDS_Shape& solid, const TopTools_IndexedDataMapOfShapeListOfShape& faceMap, const TopoDS_Edge& edge, EdgeFrame& frame) {
  try {
    if (!faceMap.Contains(edge)) return false;
    const TopTools_ListOfShape& faces = faceMap.FindFromKey(edge);
    if (faces.Extent() != 2) return false;
    const TopoDS_Face faceA = TopoDS::Face(faces.First());
    const TopoDS_Face faceB = TopoDS::Face(faces.Last());
    BRepAdaptor_Curve curve(edge);
    frame.edge = edge;
    frame.line = curve.GetType() == GeomAbs_Line;
    if (!frame.line && curve.GetType() != GeomAbs_Circle) return false;
    frame.first = curve.FirstParameter();
    frame.last = curve.LastParameter();
    // The section is set up half way along, well inside both faces, where the normals and
    // the face directions are beyond doubt, and moved to the edge's start for the sweep.
    const double middle = (frame.first + frame.last) / 2.0;
    frame.start = curve.Value(middle);
    frame.tangent = curve.DN(middle, 1);
    if (frame.tangent.Magnitude() < 1e-9) return false;
    frame.tangent.Normalize();
    if (frame.line) {
      frame.toStart.SetTranslation(gp_Vec(frame.start, curve.Value(frame.first)));
    } else {
      frame.toStart.SetRotation(curve.Circle().Axis(), frame.first - middle);
    }
    frame.awayStart = curve.DN(frame.first, 1).Normalized().Reversed();
    frame.awayEnd = curve.DN(frame.last, 1).Normalized();
    // In parameter order, which is the order the section is swept in.
    TopExp::Vertices(edge, frame.vertexStart, frame.vertexEnd);
    if (!sectionCurveAt(solid, faceA, frame.start, frame.tangent, frame.a) || !sectionCurveAt(solid, faceB, frame.start, frame.tangent, frame.b)) return false;
    // Each face's direction away from the edge, in the section plane. A sound solid's faces
    // run their edges with the face on the left, seen from outside, so the way into the face
    // is the outward normal crossed with the edge as that face runs it. A flat face can
    // confirm it; a cylinder's seam makes the classifier unreliable, so it is trusted there.
    const double step = 0.05;
    for (SectionCurve* curveOf : { &frame.a, &frame.b }) {
      const TopoDS_Face& face = curveOf == &frame.a ? faceA : faceB;
      TopAbs_Orientation run = TopAbs_FORWARD;
      bool present = false;
      for (TopExp_Explorer exp(face, TopAbs_EDGE); exp.More(); exp.Next()) {
        if (exp.Current().IsSame(edge)) {
          run = exp.Current().Orientation();
          present = true;
          break;
        }
      }
      if (!present) return false;
      gp_Vec along = curveOf->outward.Crossed(run == TopAbs_REVERSED ? frame.tangent.Reversed() : frame.tangent);
      if (along.Magnitude() < 1e-9) return false;
      along.Normalize();
      if (!curveOf->circle) {
        BRepClass_FaceClassifier onFace(face, frame.start.Translated(along * step), 1e-3);
        BRepClass_FaceClassifier offFace(face, frame.start.Translated(along * -step), 1e-3);
        const bool in = onFace.State() == TopAbs_IN || onFace.State() == TopAbs_ON;
        const bool other = offFace.State() == TopAbs_IN || offFace.State() == TopAbs_ON;
        if (!in && other) along.Reverse();
      }
      curveOf->along = along;
    }
    gp_Vec between = frame.a.along + frame.b.along;
    if (between.Magnitude() < 1e-6) return false;
    between.Normalize();
    frame.convex = containsPoint(solid, frame.start.Translated(between * step));
    return true;
  } catch (...) {
    return false;
  }
}

/** The blend's section at the frame: the kite for a round, the triangle for a chamfer. */
bool blendSection(const EdgeFrame& frame, const std::string& kind, double amount, double chamferAngle, BlendSection& section) {
  section.o = frame.start;
  if (kind == "fillet") {
    if (!ballCentre(frame.a, frame.b, amount, frame.convex, section.c)) return false;
    section.p1 = footOnCurve(frame.a, section.c);
    section.p2 = footOnCurve(frame.b, section.c);
    return true;
  }
  const double angle = std::max(5.0, std::min(85.0, chamferAngle)) * kPi / 180.0;
  section.p1 = alongCurve(frame.a, amount);
  section.p2 = alongCurve(frame.b, amount * std::tan(angle));
  section.c = section.p1;
  return true;
}

/** A point of the blend's strip on one of the edge's faces: `inset` along the face, `along` of the way along the edge. */
gp_Pnt stripPoint(const EdgeFrame& frame, const SectionCurve& curve, double inset, double along) {
  const gp_Pnt atMiddle = alongCurve(curve, inset);
  gp_Trsf shift;
  BRepAdaptor_Curve edgeCurve(frame.edge);
  if (frame.line) {
    const double length = edgeCurve.Value(frame.first).Distance(edgeCurve.Value(frame.last));
    shift.SetTranslation(frame.tangent * ((along - 0.5) * length));
  } else {
    shift.SetRotation(edgeCurve.Circle().Axis(), (along - 0.5) * (frame.last - frame.first));
  }
  return atMiddle.Transformed(shift);
}

/**
 * Whether every blend stays on its own two faces. An outside edge's strip on a flat face
 * must lie within the face all the way along (a round too big for the face, or reaching
 * into a pocket), and no strip may run into the strip of another selected edge of the same
 * kind on that face (two rounds from opposite sides of a face that would eat it). Too big
 * a size is refused here, as OCCT refuses it, instead of being built. A round may run off
 * its flat where the part carries on past the face's edge all the same, because a fill
 * made earlier covers it (a box edge close beside the crease where a cylinder joins): the
 * round then blends into the fill. Only air beyond the face is a refusal.
 */
bool blendsStayOnFaces(
  const TopoDS_Shape& solid,
  const TopTools_IndexedDataMapOfShapeListOfShape& faceMap,
  const std::vector<EdgeFrame>& frames,
  const std::string& kind,
  double amount,
  double chamferAngle
) {
  struct Strip {
    size_t frame;
    const SectionCurve* curve;
    TopoDS_Face face;
    double inset;
  };
  std::vector<Strip> strips;
  for (size_t i = 0; i < frames.size(); ++i) {
    BlendSection section;
    if (!blendSection(frames[i], kind, amount, chamferAngle, section)) return false;
    const TopTools_ListOfShape& faces = faceMap.FindFromKey(frames[i].edge);
    const TopoDS_Face faceA = TopoDS::Face(faces.First());
    const TopoDS_Face faceB = TopoDS::Face(faces.Last());
    const auto insetOf = [&](const SectionCurve& curve, const gp_Pnt& contact) {
      if (!curve.circle) return curve.origin.Distance(contact);
      return curve.radius * gp_Vec(curve.centre, curve.origin).Angle(gp_Vec(curve.centre, contact));
    };
    strips.push_back({ i, &frames[i].a, faceA, insetOf(frames[i].a, section.p1) });
    strips.push_back({ i, &frames[i].b, faceB, insetOf(frames[i].b, section.p2) });
  }
  const auto touch = [&](const EdgeFrame& one, const EdgeFrame& two) {
    return one.vertexStart.IsSame(two.vertexStart) || one.vertexStart.IsSame(two.vertexEnd)
      || one.vertexEnd.IsSame(two.vertexStart) || one.vertexEnd.IsSame(two.vertexEnd);
  };
  // A fuse keeps a box's bottom and a cylinder's bottom as two faces in one plane, so a
  // strip that runs from one onto the other is still on the flat. Every flat face in the
  // same plane counts.
  const auto onFlat = [&](const TopoDS_Face& face, const gp_Pnt& point) {
    BRepAdaptor_Surface surface(face, Standard_True);
    const gp_Pln plane = surface.Plane();
    for (TopExp_Explorer exp(solid, TopAbs_FACE); exp.More(); exp.Next()) {
      const TopoDS_Face other = TopoDS::Face(exp.Current());
      BRepAdaptor_Surface otherSurface(other, Standard_True);
      if (otherSurface.GetType() != GeomAbs_Plane) continue;
      const gp_Pln otherPlane = otherSurface.Plane();
      if (std::abs(plane.Axis().Direction().Dot(otherPlane.Axis().Direction())) < 0.999 || plane.Distance(otherPlane.Location()) > 1e-4) continue;
      BRepClass_FaceClassifier onFace(other, point, 1e-3);
      if (onFace.State() == TopAbs_IN || onFace.State() == TopAbs_ON) return true;
    }
    return false;
  };
  // Sampled away from the ends: at a corner the neighbouring blend takes over, and the
  // booleans settle that.
  for (const Strip& strip : strips) {
    for (const double along : { 0.25, 0.5, 0.75 }) {
      for (const double part : { 0.5, 1.0 }) {
        const gp_Pnt point = stripPoint(frames[strip.frame], *strip.curve, strip.inset * part, along);
        if (frames[strip.frame].convex && strip.curve->plane && !onFlat(strip.face, point)
          && !containsPoint(solid, point.Translated(strip.curve->outward * 1e-3))) return false;
        if (part < 1.0) continue;
        // Another selected edge's strip of the same kind on this face, not one meeting this
        // edge at a corner.
        for (const Strip& other : strips) {
          if (other.frame == strip.frame || !other.face.IsSame(strip.face) || touch(frames[strip.frame], frames[other.frame])) continue;
          if (frames[other.frame].convex != frames[strip.frame].convex) continue;
          const TopoDS_Vertex probe = BRepBuilderAPI_MakeVertex(point).Vertex();
          BRepExtrema_DistShapeShape gap(probe, frames[other.frame].edge);
          // Strips that would meet exactly (two 3 mm rounds on a 6 mm plate) count as running
          // into each other: the faces between them would be gone.
          if (gap.IsDone() && gap.NbSolution() > 0 && gap.Value() < other.inset + 1e-3) return false;
        }
      }
    }
  }
  return true;
}

/**
 * One edge's zone and tube from its frame, swept from the edge's start to its end and run
 * on by `extendStart` and `extendEnd` past the ends.
 */
bool blendPieceForEdge(
  const EdgeFrame& frame,
  const std::string& kind,
  double amount,
  double chamferAngle,
  double extendStart,
  double extendEnd,
  BlendPiece& piece
) {
  try {
    const SectionCurve& a = frame.a;
    const SectionCurve& b = frame.b;
    const gp_Vec& tangent = frame.tangent;
    const gp_Pnt& start = frame.start;
    piece.convex = frame.convex;
    piece.vertexStart = frame.vertexStart;
    piece.vertexEnd = frame.vertexEnd;
    piece.a = a;
    piece.b = b;
    const bool round = kind == "fillet";
    BlendSection section;
    if (!blendSection(frame, kind, amount, chamferAngle, section)) return false;
    TopoDS_Face face;
    if (!sectionFace(a, b, section, piece.convex, round, face)) return false;
    face = TopoDS::Face(face.Moved(TopLoc_Location(frame.toStart)));
    TopoDS_Shape tubeFace;
    if (round) {
      const gp_Circ ball(gp_Ax2(section.c, gp_Dir(tangent)), amount);
      tubeFace = BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(ball).Edge()).Wire(), Standard_True).Face().Moved(TopLoc_Location(frame.toStart));
    }
    section.c.Transform(frame.toStart);
    BRepAdaptor_Curve curve(frame.edge);
    if (frame.line) {
      const double length = curve.Value(frame.first).Distance(curve.Value(frame.last));
      gp_Trsf back;
      back.SetTranslation(tangent * -extendStart);
      const gp_Vec sweep = tangent * (length + extendStart + extendEnd);
      piece.zone = rightWayOut(BRepPrimAPI_MakePrism(face.Moved(TopLoc_Location(back)), sweep).Shape());
      if (round) {
        gp_Trsf tubeBack;
        tubeBack.SetTranslation(tangent * -(extendStart + 1e-3));
        piece.tube = rightWayOut(BRepPrimAPI_MakePrism(tubeFace.Moved(TopLoc_Location(tubeBack)), tangent * (length + extendStart + extendEnd + 2e-3)).Shape());
      }
      piece.ballStart = section.c;
      piece.ballEnd = section.c.Translated(tangent * length);
    } else {
      const gp_Circ circle = curve.Circle();
      const gp_Ax1 axis = circle.Axis();
      const double startAngle = extendStart / circle.Radius();
      const double endAngle = extendEnd / circle.Radius();
      gp_Trsf back;
      back.SetRotation(axis, -startAngle);
      const double sweep = (frame.last - frame.first) + startAngle + endAngle;
      piece.zone = rightWayOut(BRepPrimAPI_MakeRevol(face.Moved(TopLoc_Location(back)), axis, sweep).Shape());
      if (round) {
        gp_Trsf tubeBack;
        tubeBack.SetRotation(axis, -(startAngle + 1e-3 / circle.Radius()));
        piece.tube = rightWayOut(BRepPrimAPI_MakeRevol(tubeFace.Moved(TopLoc_Location(tubeBack)), axis, sweep + 2e-3 / circle.Radius()).Shape());
      }
      gp_Trsf toEnd;
      toEnd.SetRotation(axis, frame.last - frame.first);
      piece.ballStart = section.c;
      piece.ballEnd = section.c.Transformed(toEnd);
    }
    return !piece.zone.IsNull() && (!round || !piece.tube.IsNull());
  } catch (...) {
    return false;
  }
}

/**
 * One pass of Mintr's own construction: the given edges of `solid`, all of one kind, as
 * zones less tubes, fused into the part (inside edges) or cut from it (outside edges).
 *
 * Corners. Where two edges meet at an inside corner of their shared face (the top of a box
 * where its edge runs into the cylinder's rim), the ball rolls on round the corner: both
 * zones run on past it and each keeps whatever lies in either tube. Where they meet at an
 * outside corner each zone keeps only its own tube, so the two rounds meet in a mitre.
 * Where three or more meet, the corner block they share is taken out of the zones and
 * replaced by that block less the ball that touches all three faces.
 */
bool constructBlends(
  const TopoDS_Shape& solid,
  const std::vector<TopoDS_Edge>& edges,
  const std::string& kind,
  double amount,
  double chamferAngle,
  bool convex,
  TopoDS_Shape& out,
  double& allowance
) {
  TopTools_IndexedDataMapOfShapeListOfShape faceMap;
  TopExp::MapShapesAndAncestors(solid, TopAbs_EDGE, TopAbs_FACE, faceMap);
  const bool round = kind == "fillet";
  const double reach = round ? amount : std::max(amount, amount * std::tan(std::max(5.0, std::min(85.0, chamferAngle)) * kPi / 180.0));
  std::vector<EdgeFrame> frames;
  for (const auto& edge : edges) {
    EdgeFrame frame;
    if (!edgeFrame(solid, faceMap, edge, frame) || frame.convex != convex) return false;
    frames.push_back(frame);
  }
  if (frames.empty()) {
    out = solid;
    return true;
  }
  if (!blendsStayOnFaces(solid, faceMap, frames, kind, amount, chamferAngle)) return false;
  // Which frames end at each vertex (by index), with the direction on past it.
  struct FrameEnd {
    size_t frame;
    bool atStart;
  };
  TopTools_IndexedMapOfShape vertices;
  std::vector<std::vector<FrameEnd>> endsAt;
  for (size_t i = 0; i < frames.size(); ++i) {
    for (const bool atStart : { true, false }) {
      const TopoDS_Vertex& vertex = atStart ? frames[i].vertexStart : frames[i].vertexEnd;
      if (vertex.IsNull()) continue;
      const int index = vertices.Add(vertex);
      if (index > static_cast<int>(endsAt.size())) endsAt.emplace_back();
      endsAt[static_cast<size_t>(index - 1)].push_back({ i, atStart });
    }
  }
  const auto away = [&](const FrameEnd& end) { return end.atStart ? frames[end.frame].awayStart : frames[end.frame].awayEnd; };
  // Two edges at a vertex: do they meet at an inside corner of the face they share? The
  // point just inside that face between the two is then outside the part. A fuse keeps a
  // box's top and a cylinder's top as two faces in one plane, so the shared face is found
  // by its normal at the corner, not by identity.
  const auto reflexCorner = [&](const FrameEnd& one, const FrameEnd& two, const TopoDS_Vertex& vertex) {
    const TopoDS_Edge& edgeOne = frames[one.frame].edge;
    const TopoDS_Edge& edgeTwo = frames[two.frame].edge;
    const gp_Pnt corner = BRep_Tool::Pnt(vertex);
    bool found = false;
    gp_Dir normal;
    for (TopTools_ListOfShape::Iterator it(faceMap.FindFromKey(edgeOne)); it.More() && !found; it.Next()) {
      gp_Dir normalOne;
      if (!faceNormalAt(TopoDS::Face(it.Value()), corner, normalOne)) continue;
      for (TopTools_ListOfShape::Iterator jt(faceMap.FindFromKey(edgeTwo)); jt.More(); jt.Next()) {
        gp_Dir normalTwo;
        if (!faceNormalAt(TopoDS::Face(jt.Value()), corner, normalTwo)) continue;
        if (normalOne.Dot(normalTwo) > 0.999) {
          normal = normalOne;
          found = true;
          break;
        }
      }
    }
    if (!found) return false;
    // Between the two edges as they leave the corner (the opposite of on past it).
    gp_Vec between = (away(one) + away(two)).Reversed();
    if (between.Magnitude() < 0.05) return false;  // running straight on: no corner
    between.Normalize();
    const double step = 0.05;
    return !containsPoint(solid, corner.Translated(between * step).Translated(gp_Vec(normal) * -step));
  };
  std::vector<double> extendStart(frames.size(), 0.0);
  std::vector<double> extendEnd(frames.size(), 0.0);
  std::vector<std::vector<size_t>> sharesTubeWith(frames.size());
  std::vector<std::vector<FrameEnd>> blockCorners;  // three or more meeting
  for (size_t v = 0; v < endsAt.size(); ++v) {
    const auto& here = endsAt[v];
    if (here.size() == 2 && reflexCorner(here[0], here[1], TopoDS::Vertex(vertices.FindKey(static_cast<int>(v) + 1)))) {
      for (const FrameEnd& end : here) (end.atStart ? extendStart : extendEnd)[end.frame] = reach;
      sharesTubeWith[here[0].frame].push_back(here[1].frame);
      sharesTubeWith[here[1].frame].push_back(here[0].frame);
    } else if (here.size() >= 3) {
      blockCorners.push_back(here);
    }
  }
  std::vector<BlendPiece> pieces;
  allowance = 0.0;
  for (size_t i = 0; i < frames.size(); ++i) {
    BlendPiece piece;
    if (!blendPieceForEdge(frames[i], kind, amount, chamferAngle, extendStart[i], extendEnd[i], piece)) return false;
    gp_Pnt mid;
    double length = 0.0;
    if (edgeMidAndLength(frames[i].edge, mid, length)) allowance += treatmentAllowance(kind, amount, chamferAngle, solid, faceMap, frames[i].edge, length);
    pieces.push_back(piece);
  }
  // The corner blocks: each zone there loses the block, and the block less the ball that
  // touches all three faces is a piece of its own. The ball's centre lies on each edge's
  // ball path run on past the corner, where it reaches the third face; with flat faces
  // that is exact, otherwise the paths' ends are averaged.
  std::vector<TopoDS_Shape> blocks(blockCorners.size());
  std::vector<TopoDS_Shape> cornerPieces;
  for (size_t c = 0; c < blockCorners.size(); ++c) {
    const auto& here = blockCorners[c];
    TopoDS_Shape block = pieces[here[0].frame].zone;
    for (size_t k = 1; k < here.size(); ++k) {
      if (!kernelBoolean(KernelBooleanOp::Common, block, pieces[here[k].frame].zone, block)) return false;
    }
    if (block.IsNull() || volumeOf(block) < 1e-9) return false;
    blocks[c] = block;
    if (!round) {
      cornerPieces.push_back(block);
      continue;
    }
    gp_XYZ sum(0, 0, 0);
    int solved = 0;
    const double inwards = convex ? -amount : amount;
    for (const FrameEnd& end : here) {
      const BlendPiece& piece = pieces[end.frame];
      const gp_Pnt centre = end.atStart ? piece.ballStart : piece.ballEnd;
      const gp_Vec direction = away(end);
      const gp_Pnt vertexPoint = BRep_Tool::Pnt(end.atStart ? frames[end.frame].vertexStart : frames[end.frame].vertexEnd);
      const SectionCurve* third = nullptr;
      for (const FrameEnd& otherEnd : here) {
        if (otherEnd.frame == end.frame) continue;
        for (const SectionCurve* face : { &pieces[otherEnd.frame].a, &pieces[otherEnd.frame].b }) {
          if (!face->plane) continue;
          if (std::abs(face->outward.Dot(piece.a.outward)) > 0.99 || std::abs(face->outward.Dot(piece.b.outward)) > 0.99) continue;
          third = face;
          break;
        }
        if (third) break;
      }
      if (!third) continue;
      const double slope = third->outward.Dot(direction);
      if (std::abs(slope) < 1e-6) continue;
      const double t = (inwards - third->outward.Dot(gp_Vec(vertexPoint, centre))) / slope;
      sum += centre.Translated(direction * t).XYZ();
      solved += 1;
    }
    if (solved == 0) {
      for (const FrameEnd& end : here) sum += (end.atStart ? pieces[end.frame].ballStart : pieces[end.frame].ballEnd).XYZ();
      solved = static_cast<int>(here.size());
    }
    const TopoDS_Shape ball = BRepPrimAPI_MakeSphere(gp_Pnt(sum / solved), amount).Shape();
    TopoDS_Shape rest;
    if (!kernelBoolean(KernelBooleanOp::Cut, block, ball, rest)) return false;
    cornerPieces.push_back(rest);
  }
  // Each zone less its corner blocks and the tubes it keeps, then all of them go into one
  // boolean with the part.
  TopTools_ListOfShape tools;
  for (size_t i = 0; i < pieces.size(); ++i) {
    TopoDS_Shape material = pieces[i].zone;
    TopTools_ListOfShape blocksHere;
    for (size_t c = 0; c < blockCorners.size(); ++c) {
      if (std::any_of(blockCorners[c].begin(), blockCorners[c].end(), [&](const FrameEnd& end) { return end.frame == i; })) blocksHere.Append(blocks[c]);
    }
    if (!blocksHere.IsEmpty() && !kernelBoolean(KernelBooleanOp::Cut, material, blocksHere, material)) return false;
    if (round) {
      TopTools_ListOfShape tubes;
      tubes.Append(pieces[i].tube);
      for (size_t j : sharesTubeWith[i]) tubes.Append(pieces[j].tube);
      if (!kernelBoolean(KernelBooleanOp::Cut, material, tubes, material)) return false;
    }
    tools.Append(material);
  }
  for (const auto& cornerPiece : cornerPieces) tools.Append(cornerPiece);
  TopoDS_Shape result;
  if (!kernelBoolean(convex ? KernelBooleanOp::Cut : KernelBooleanOp::Fuse, solid, tools, result)) return false;
  out = onlySolid(result);
  return !out.IsNull();
}

/**
 * Every selected edge blended by Mintr's own construction, or nothing. The inside edges
 * are filled first. A fill ends on a face the part's outside edges run along (the crease
 * where a cylinder joins a box ends on the top), making a new outside edge there: the
 * ball's footprint for a round, the chord for a chamfer. Those are rounded along with the
 * selected outside edges in the second pass, so the round runs on from the box's edge over
 * the end of the fill to the cylinder's rim without a step.
 */
bool treatEdgesByConstruction(
  const std::string& kind,
  const std::vector<int>& selected,
  double amount,
  double chamferAngle,
  TopoDS_Shape& out
) {
  const TopoDS_Shape& solid = gSession.base;
  if (solidCountWithVolume(solid) != 1) return false;
  TopTools_IndexedDataMapOfShapeListOfShape faceMap;
  TopExp::MapShapesAndAncestors(solid, TopAbs_EDGE, TopAbs_FACE, faceMap);
  std::vector<TopoDS_Edge> concave;
  std::vector<TopoDS_Edge> convex;
  std::vector<gp_Pln> caps;  // the flat faces the outside edges run along
  for (int id : selected) {
    const TopoDS_Edge& edge = gSession.edges[static_cast<size_t>(id)];
    EdgeFrame frame;
    if (!edgeFrame(solid, faceMap, edge, frame)) return false;
    (frame.convex ? convex : concave).push_back(edge);
    if (!frame.convex) continue;
    for (TopTools_ListOfShape::Iterator it(faceMap.FindFromKey(edge)); it.More(); it.Next()) {
      BRepAdaptor_Surface surface(TopoDS::Face(it.Value()), Standard_True);
      if (surface.GetType() == GeomAbs_Plane) caps.push_back(surface.Plane());
    }
  }
  double allowance = 0.0;
  double fillAllowance = 0.0;
  TopoDS_Shape filled = solid;
  if (!concave.empty() && !constructBlends(solid, concave, kind, amount, chamferAngle, false, filled, fillAllowance)) return false;
  allowance += fillAllowance;
  TopoDS_Shape result = filled;
  if (!convex.empty()) {
    // The outside edges again on the filled part, plus the new ones the fills made on the
    // caps: sharp, outside, and not one of the part's own.
    std::vector<TopoDS_Edge> outside;
    TopTools_IndexedDataMapOfShapeListOfShape filledMap;
    TopExp::MapShapesAndAncestors(filled, TopAbs_EDGE, TopAbs_FACE, filledMap);
    // Still sharp on the filled part; an edge a fill has swallowed (a box corner a hair
    // from the crease) is gone, and the fill's own new edges take its place.
    const auto sharpOn = [&](const TopoDS_Edge& edge) {
      if (!filledMap.Contains(edge) || filledMap.FindFromKey(edge).Extent() != 2) return false;
      gp_Pnt mid;
      double length = 0.0;
      if (!edgeMidAndLength(edge, mid, length)) return false;
      gp_Dir normalOne;
      gp_Dir normalTwo;
      if (!faceNormalAt(TopoDS::Face(filledMap.FindFromKey(edge).First()), mid, normalOne) || !faceNormalAt(TopoDS::Face(filledMap.FindFromKey(edge).Last()), mid, normalTwo)) return false;
      return dihedral(normalOne, normalTwo) >= 12.0;
    };
    // Outside by the frame's own test: a chamfer fill of a shallow crease leaves a mild
    // inside fold on the face that the probe would call outside.
    const auto outsideOn = [&](const TopoDS_Edge& edge) {
      EdgeFrame frame;
      return edgeFrame(filled, filledMap, edge, frame) && frame.convex;
    };
    for (const auto& edge : convex) {
      TopoDS_Edge found;
      TopoDS_Face face;
      if (!matchEdgeOnShape(filled, edge, found, face)) continue;
      if (!sharpOn(found) || !outsideOn(found)) continue;
      outside.push_back(found);
    }
    std::vector<TopoDS_Edge> fresh;
    if (!concave.empty()) {
      for (TopExp_Explorer exp(filled, TopAbs_FACE); exp.More(); exp.Next()) {
        const TopoDS_Face face = TopoDS::Face(exp.Current());
        BRepAdaptor_Surface surface(face, Standard_True);
        if (surface.GetType() != GeomAbs_Plane) continue;
        const gp_Pln plane = surface.Plane();
        const bool onCap = std::any_of(caps.begin(), caps.end(), [&](const gp_Pln& cap) {
          return std::abs(cap.Axis().Direction().Dot(plane.Axis().Direction())) > 0.999 && cap.Distance(plane.Location()) < 1e-4;
        });
        if (!onCap) continue;
        for (TopExp_Explorer edges(face, TopAbs_EDGE); edges.More(); edges.Next()) {
          const TopoDS_Edge edge = TopoDS::Edge(edges.Current());
          if (BRep_Tool::Degenerated(edge)) continue;
          if (std::any_of(outside.begin(), outside.end(), [&](const TopoDS_Edge& known) { return known.IsSame(edge); })) continue;
          gp_Pnt mid;
          double length = 0.0;
          if (!edgeMidAndLength(edge, mid, length)) continue;
          // One of the part's own edges, selected or not, is not new.
          bool own = false;
          for (size_t i = 0; i < gSession.edges.size() && !own; ++i) {
            TopoDS_Edge twin;
            TopoDS_Face twinFace;
            const TopoDS_Vertex probe = BRepBuilderAPI_MakeVertex(mid).Vertex();
            BRepExtrema_DistShapeShape gap(probe, gSession.edges[i]);
            own = gap.IsDone() && gap.NbSolution() > 0 && gap.Value() < 1e-3;
          }
          if (own) continue;
          if (!sharpOn(edge) || !outsideOn(edge)) continue;  // smooth, or an inside fold: nothing to round
          fresh.push_back(edge);
        }
      }
    }
    // A new edge whose own round would not fit (a chord where a fill has run past a box
    // corner, a footprint that nears the plate's edge) is left as it is; the part's own
    // edges still all get done.
    if (!fresh.empty()) {
      std::vector<EdgeFrame> ownFrames;
      for (const auto& edge : outside) {
        EdgeFrame frame;
        if (!edgeFrame(filled, filledMap, edge, frame)) return false;
        ownFrames.push_back(frame);
      }
      // Each against the part's own edges and the new ones already taken (two footprints
      // close together on a plate's side can collide with each other).
      for (const auto& edge : fresh) {
        std::vector<EdgeFrame> trial = ownFrames;
        EdgeFrame frame;
        if (!edgeFrame(filled, filledMap, edge, frame)) continue;
        trial.push_back(frame);
        if (!blendsStayOnFaces(filled, filledMap, trial, kind, amount, chamferAngle)) continue;
        ownFrames.push_back(frame);
        outside.push_back(edge);
      }
    }
    double cutAllowance = 0.0;
    if (!constructBlends(filled, outside, kind, amount, chamferAngle, true, result, cutAllowance)) return false;
    allowance += cutAllowance;
  }
  // Mended, then merged: the booleans leave hair-thin edges where a round runs on from a
  // fill, which the mesher trips over.
  result = unify(healShape(onlySolid(result)));
  double change = 0.0;
  if (!treatmentLooksSound(solid, result, allowance, change)) return false;
  if (!convex.empty() && concave.empty() && change >= 0.0) return false;
  if (convex.empty() && !concave.empty() && change <= 0.0) return false;
  out = result;
  return true;
}

/**
 * Rounds or bevels the selected edges, filling inside ones and rounding off outside ones.
 * All at once is the common click and OCCT's best work, with the corners where the edges
 * meet blended properly. When OCCT refuses the set, each edge is tried on its own on the
 * untouched part: the ones it cannot do at all are skipped, and the rest are built as a set
 * again, else as outside and inside sets, else one at a time, whichever skips fewer.
 */
bool treatEdges(
  const std::string& kind,
  const std::vector<int>& edgeIds,
  double amount,
  double chamferAngle,
  const std::string& filletProfile,
  TopoDS_Shape& out,
  std::vector<int>& skipped,
  std::string* message = nullptr
) {
  skipped.clear();
  if (!gSession.live || gSession.base.IsNull()) return false;
  gTreatDeadline = TreatClock::now() + std::chrono::milliseconds(static_cast<int>(kTreatBudgetMs));
  const auto outOfTime = [&]() {
    if (!treatTimeIsUp()) return false;
    if (message) *message = "That took too long to build. Try a smaller size or fewer edges.";
    return true;
  };
  std::vector<int> selected;
  for (int id : edgeIds) {
    if (id < 0 || id >= static_cast<int>(gSession.edges.size())) return false;
    if (std::find(selected.begin(), selected.end(), id) == selected.end()) selected.push_back(id);
  }
  if (selected.empty()) return false;
  const bool cove = kind == "fillet" && filletProfile == "cove";
  const double before = volumeOf(gSession.base);
  auto sound = [&](const TopoDS_Shape& treated, double allowance) {
    double change = 0.0;
    return cove
      ? volumeOf(treated) + 1e-3 < before && kernelShapeIsValid(treated)
      : treatmentLooksSound(gSession.base, treated, allowance, change);
  };
  try {
    double allowance = 0.0;
    const bool together = treatEdgesTogether(kind, selected, amount, chamferAngle, filletProfile, out, allowance);
    if (together && sound(out, allowance)) return true;
  } catch (const Standard_Failure&) {
  } catch (...) {
  }
  if (!cove) {
    // The whole outline of a flat face, where OCCT refuses the corner an arc makes with a
    // straight edge: a band cut round the face instead.
    try {
      if (treatOutlineBand(kind, selected, amount, chamferAngle, out)) return true;
    } catch (const Standard_Failure&) {
    } catch (...) {
    }
  }
  if (outOfTime()) return false;
  if (selected.size() > 1 && cove) {
    try {
      if (coveEdgesOneByOne(selected, amount, chamferAngle, out, skipped)) return true;
    } catch (const Standard_Failure&) {
    } catch (...) {
    }
    skipped.clear();
  } else if (selected.size() > 1) {
    std::vector<int> workable;
    std::map<int, double> expected;
    for (int id : selected) {
      if (outOfTime()) return false;
      TopoDS_Shape alone;
      double allowance = 0.0;
      double change = 0.0;
      const bool works = treatOneEdge(kind, gSession.base, gSession.edges[static_cast<size_t>(id)], gSession.edgeFaces[static_cast<size_t>(id)], amount, chamferAngle, filletProfile, alone, allowance)
        && treatmentLooksSound(gSession.base, alone, allowance, change);
      if (!works) {
        skipped.push_back(id);
        continue;
      }
      workable.push_back(id);
      expected[id] = change;
    }
    // The edges OCCT can do, as one build; the rest are left out unless Mintr's own
    // construction can do the whole set.
    TopoDS_Shape partial;
    if (workable.size() > 1 && workable.size() < selected.size() && !outOfTime()) {
      try {
        double allowance = 0.0;
        TopoDS_Shape treated;
        if (treatEdgesTogether(kind, workable, amount, chamferAngle, filletProfile, treated, allowance) && sound(treated, allowance)) partial = treated;
      } catch (const Standard_Failure&) {
      } catch (...) {
      }
    }
    if (!partial.IsNull()) {
      TopoDS_Shape built;
      bool constructed = false;
      try {
        constructed = treatEdgesByConstruction(kind, selected, amount, chamferAngle, built);
      } catch (const Standard_Failure&) {
      } catch (...) {
      }
      if (constructed) {
        out = built;
        skipped.clear();
        return true;
      }
      out = partial;
      return true;
    }
    if (workable.size() > 1) {
      TopoDS_Shape bySets;
      std::vector<int> setsSkipped;
      bool sets = false;
      if (!outOfTime()) try {
        sets = treatEdgesBySubsets(kind, workable, amount, chamferAngle, filletProfile, bySets, setsSkipped);
      } catch (const Standard_Failure&) {
      } catch (...) {
      }
      TopoDS_Shape oneByOne;
      std::vector<int> oneSkipped;
      bool one = false;
      if ((!sets || !setsSkipped.empty()) && !outOfTime()) {
        try {
          one = treatEdgesOneByOne(kind, workable, expected, amount, chamferAngle, filletProfile, oneByOne, oneSkipped);
        } catch (const Standard_Failure&) {
        } catch (...) {
        }
      }
      TopoDS_Shape best;
      std::vector<int> bestSkipped = skipped;
      if (sets && (!one || setsSkipped.size() <= oneSkipped.size())) {
        best = bySets;
        bestSkipped.insert(bestSkipped.end(), setsSkipped.begin(), setsSkipped.end());
      } else if (one) {
        best = oneByOne;
        bestSkipped.insert(bestSkipped.end(), oneSkipped.begin(), oneSkipped.end());
      }
      if (best.IsNull() || !bestSkipped.empty()) {
        // OCCT left edges out: Mintr's own construction does the whole set, or nothing.
        TopoDS_Shape built;
        bool constructed = false;
        try {
          constructed = treatEdgesByConstruction(kind, selected, amount, chamferAngle, built);
        } catch (const Standard_Failure&) {
        } catch (...) {
        }
        if (constructed) {
          out = built;
          skipped.clear();
          return true;
        }
      }
      if (!best.IsNull()) {
        out = best;
        skipped = bestSkipped;
        return true;
      }
    } else if (workable.size() == 1) {
      try {
        TopoDS_Shape alone;
        double allowance = 0.0;
        if (treatEdgesTogether(kind, workable, amount, chamferAngle, filletProfile, alone, allowance) && sound(alone, allowance)) {
          out = alone;
          return true;
        }
      } catch (const Standard_Failure&) {
      } catch (...) {
      }
    }
    skipped.clear();
  }
  if (!cove) {
    try {
      TopoDS_Shape built;
      if (treatEdgesByConstruction(kind, selected, amount, chamferAngle, built)) {
        out = built;
        return true;
      }
    } catch (const Standard_Failure&) {
    } catch (...) {
    }
  }
  if (outOfTime()) return false;
  try {
    std::string why;
    if (treatEdgesByCornerCut(kind, selected, amount, chamferAngle, filletProfile, out, skipped, why)) return true;
  } catch (const Standard_Failure&) {
  } catch (...) {
  }
  skipped.clear();
  return false;
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
  const bool cove = kind == "fillet" && filletProfile == "cove";
  const double before = volumeOf(gSession.base);
  double low = 0.0;
  double high = requested;
  // Nothing under a twentieth of the size asked for counts as fitting, and nothing under a
  // quarter of a millimetre is worth naming, so neither is tried: a sliver of a blend is
  // where OCCT can spin for ever.
  const double least = std::max(requested * 0.05, 0.25);
  gTreatDeadline = TreatClock::now() + std::chrono::milliseconds(1500);
  for (int step = 0; step < 7 && !treatTimeIsUp(); ++step) {
    const double middle = (low + high) / 2.0;
    if (middle < least) break;
    TopoDS_Shape treated;
    double allowance = 0.0;
    double change = 0.0;
    const bool fits = treatEdgesTogether(kind, selected, middle, chamferAngle, filletProfile, treated, allowance)
      && (cove
        ? volumeOf(treated) + 1e-3 < before && kernelShapeIsValid(treated)
        : treatmentLooksSound(gSession.base, treated, allowance, change));
    if (fits) low = middle;
    else high = middle;
  }
  const double tidy = low >= 1.0 ? std::floor(low * 10.0) / 10.0 : std::floor(low * 100.0) / 100.0;
  return tidy >= least && tidy > 0.0 ? tidy : 0.0;
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

// Face outlines feed Pad/Pocket and Push Pull, which build solids from them, so a curve is
// sampled finely: no more than 0.02 mm off the true curve and no more than 6 degrees of turn
// between points. The old 0.35 mm chord left a small fillet or a crescent's hollow as a few
// flat facets. Fine samples also let Pad/Pocket tell a sampled curve from a real corner.
constexpr double kFaceOutlineAngle = 0.105;
constexpr double kFaceOutlineSag = 0.02;

std::vector<gp_Pnt> sampleFaceOutlineEdge(const BRepAdaptor_Curve& curve) {
  std::vector<gp_Pnt> sampled;
  try {
    GCPnts_TangentialDeflection discret(curve, kFaceOutlineAngle, kFaceOutlineSag, 2);
    const int count = discret.NbPoints();
    sampled.reserve(static_cast<std::size_t>(count));
    for (int p = 1; p <= count; ++p) sampled.push_back(discret.Value(p));
  } catch (...) {
    sampled.clear();
  }
  if (sampled.size() >= 2) return sampled;
  GCPnts_QuasiUniformDeflection fallback(curve, 0.35);
  if (!fallback.IsDone()) return {};
  for (int p = 1; p <= fallback.NbPoints(); ++p) sampled.push_back(fallback.Value(p));
  return sampled;
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
    std::vector<gp_Pnt> sampled = sampleFaceOutlineEdge(curve);
    if (sampled.size() < 2) continue;
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
  // Material wraps more than half way round an inside edge. A shallow crease, such as where a
  // box meets a cylinder it is joined to, is barely past half, so it is sampled finely.
  int inside = 0;
  const double reach = 0.08;
  const int probes = 32;
  for (int step = 0; step < probes; ++step) {
    const double angle = ((step + 0.5) / probes) * kPi * 2;
    const gp_Pnt probe = sample.Translated(across * (std::cos(angle) * reach) + around * (std::sin(angle) * reach));
    if (containsPoint(solid, probe)) inside += 1;
  }
  return inside >= probes / 2 + 2;
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

nlohmann::json previewMesh(const TopoDS_Shape& shape, int requestId, MeshQuality quality, bool includeBrep, double targetTriangles = 0.0) {
  nlohmann::json positions, normals, indices;
  if (!tessellatePreview(shape, quality.linear, positions, normals, indices, quality.angular, targetTriangles)) {
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
    // Meshed about as densely as the part was before the push (matchTriangles), not at a fixed quality.
    return previewMesh(result, requestId, meshForQuality(job.value("quality", "standard")), true, job.value("matchTriangles", 0.0));
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
    std::string slow;
    if (!stretched && !treatEdges(job.value("kind", "fillet"), edgeIds, job.value("amount", 1.0), job.value("chamferAngle", 45.0), job.value("filletProfile", "round"), result, skipped, &slow)) {
      if (!slow.empty()) return modifierFail(slow, false, requestId);
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
