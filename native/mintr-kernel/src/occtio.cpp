#include "occtio.hpp"

#include <Bnd_Box.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <Precision.hxx>
#include <Standard_Failure.hxx>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <map>
#include <memory>
#include <sstream>
#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_GTransform.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
#include <BRepLProp_SLProps.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Extrema_ExtPS.hxx>
#include <GCPnts_QuasiUniformDeflection.hxx>
#include <GProp_GProps.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Poly_Triangulation.hxx>
#include <STEPControl_Reader.hxx>
#include <STEPControl_Writer.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepLib.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <Geom2d_Line.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <gp.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir2d.hxx>
#include <gp_Ax1.hxx>
#include <gp_Dir.hxx>
#include <gp_GTrsf.hxx>
#include <gp_Mat.hxx>
#include <gp_Pnt.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Vec.hxx>
#include <gp_XYZ.hxx>

#include <algorithm>
#include <cmath>
#include <map>
#include <memory>
#include <sstream>

gp_Trsf kernelPoseTrsf(const nlohmann::json& solid, double height) {
  gp_Trsf trsf;
  const double rotZ = solid.value("rotationZ", 0.0) * kKernelDeg;
  const double rotY = solid.value("rotation", 0.0) * kKernelDeg;
  const double rotX = solid.value("rotationX", 0.0) * kKernelDeg;
  gp_Trsf rz, ry, rx, move;
  if (std::abs(rotZ) > 1e-12) rz.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), rotZ);
  if (std::abs(rotY) > 1e-12) ry.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0)), rotY);
  if (std::abs(rotX) > 1e-12) rx.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0)), rotX);
  const double x = solid.value("x", 0.0);
  const double z = solid.value("z", 0.0);
  const double elevation = solid.value("elevation", 0.0);
  move.SetTranslation(gp_Vec(x, elevation + height / 2.0, z));
  trsf = move * rx * ry * rz;
  if (solid.value("mirrorX", false)) {
    gp_Trsf mx;
    mx.SetMirror(gp::YOZ());
    trsf = trsf * mx;
  }
  if (solid.value("mirrorY", false)) {
    gp_Trsf my;
    my.SetMirror(gp::ZOX());
    trsf = trsf * my;
  }
  if (solid.value("mirrorZ", false)) {
    gp_Trsf mz;
    mz.SetMirror(gp::XOY());
    trsf = trsf * mz;
  }
  return trsf;
}

bool kernelHelixWire(const gp_Pnt& origin, const gp_Dir& axis, const gp_Dir& u, double radius, double pitch, double length, bool left, TopoDS_Wire& wire) {
  if (!(radius > 0.0) || !(pitch > 0.0) || !(length > 0.0) || axis.IsParallel(u, 1e-9)) return false;
  try {
    Handle(Geom_CylindricalSurface) surface = new Geom_CylindricalSurface(gp_Ax3(origin, axis, u), radius);
    // On the unrolled cylinder U is the angle and V the height: one turn climbs one pitch.
    const gp_Dir2d direction(left ? -2.0 * kKernelPi : 2.0 * kKernelPi, pitch);
    Handle(Geom2d_Line) line = new Geom2d_Line(gp_Pnt2d(0.0, 0.0), direction);
    const double span = (length / pitch) * std::sqrt(4.0 * kKernelPi * kKernelPi + pitch * pitch);
    TopoDS_Edge edge = BRepBuilderAPI_MakeEdge(line, surface, 0.0, span).Edge();
    BRepLib::BuildCurves3d(edge);
    wire = BRepBuilderAPI_MakeWire(edge).Wire();
    return !wire.IsNull();
  } catch (...) {
    return false;
  }
}

bool kernelSweepAlongHelix(const TopoDS_Wire& helix, const TopoDS_Wire& profile, const gp_Dir& axis, TopoDS_Shape& out) {
  try {
    BRepOffsetAPI_MakePipe pipe(helix, profile);
    pipe.Build();
    if (pipe.IsDone()) {
      TopoDS_Shape swept = pipe.Shape();
      if (!swept.IsNull() && swept.ShapeType() == TopAbs_SOLID && kernelShapeIsValid(swept)) {
        out = swept;
        return true;
      }
    }
  } catch (...) {
    // A binormal shell below keeps the tooth upright when the plain pipe twists.
  }
  try {
    BRepOffsetAPI_MakePipeShell shell(helix);
    shell.SetMode(axis);
    shell.Add(profile, false, true);
    shell.Build();
    if (!shell.IsDone()) return false;
    shell.MakeSolid();
    out = shell.Shape();
    return !out.IsNull() && kernelShapeIsValid(out);
  } catch (...) {
    return false;
  }
}

TopoDS_Shape kernelPlaced(const TopoDS_Shape& shape, const nlohmann::json& solid, double height) {
  return BRepBuilderAPI_Transform(shape, kernelPoseTrsf(solid, height), true).Shape();
}

TopoDS_Shape kernelUnify(const TopoDS_Shape& shape) {
  try {
    ShapeUpgrade_UnifySameDomain unify(shape, true, true, true);
    unify.Build();
    return unify.Shape();
  } catch (...) {
    return shape;
  }
}

bool kernelBounds(
  const TopoDS_Shape& shape,
  double& xmin, double& ymin, double& zmin,
  double& xmax, double& ymax, double& zmax
) {
  Bnd_Box box;
  // Add() inflates by face tolerance. A chamfer leaves a tolerance gap big
  // enough that fitting the solid into that box pulls the real faces inward.
  BRepBndLib::AddOptimal(shape, box, false, false);
  if (box.IsVoid()) return false;
  box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
  return true;
}

TopoDS_Shape kernelRecenterToLocalMeshFrame(const TopoDS_Shape& shape) {
  double xmin, ymin, zmin, xmax, ymax, zmax;
  if (!kernelBounds(shape, xmin, ymin, zmin, xmax, ymax, zmax)) return shape;
  const double cx = (xmin + xmax) / 2.0;
  const double cz = (zmin + zmax) / 2.0;
  // Always exactly: the app places a stored solid by its exact bounds, so a solid left a
  // few hundredths off centre here moved by that much every time it was grouped again.
  if (std::abs(cx) < 1e-9 && std::abs(cz) < 1e-9 && std::abs(ymin) < 1e-9) return shape;
  gp_Trsf move;
  move.SetTranslation(gp_Vec(-cx, -ymin, -cz));
  return BRepBuilderAPI_Transform(shape, move, true).Shape();
}

TopoDS_Shape kernelFitImportedLocal(const TopoDS_Shape& shape, const nlohmann::json& solid) {
  TopoDS_Shape local = kernelRecenterToLocalMeshFrame(shape);
  const double width = solid.value("width", 0.0);
  const double depth = solid.value("depth", 0.0);
  const double height = solid.value("height", 0.0);
  double xmin, ymin, zmin, xmax, ymax, zmax;
  // An unresized fillet or chamfer already is the exact solid. Scaling it so a
  // loose box matches the display mesh is what shrinks the part on the next
  // Group or sketch cut. Only a real resize asks for fitScale.
  if (solid.value("fitScale", true) && kernelBounds(local, xmin, ymin, zmin, xmax, ymax, zmax)) {
    const double measuredW = xmax - xmin;
    const double measuredH = ymax - ymin;
    const double measuredD = zmax - zmin;
    const double sx = (measuredW > 1e-6 && width > 1e-6) ? width / measuredW : 1.0;
    const double sy = (measuredH > 1e-6 && height > 1e-6) ? height / measuredH : 1.0;
    const double sz = (measuredD > 1e-6 && depth > 1e-6) ? depth / measuredD : 1.0;
    local = kernelScale(local, sx, sy, sz);
  }
  if (height > 1e-6) {
    gp_Trsf down;
    down.SetTranslation(gp_Vec(0, -height / 2.0, 0));
    local = BRepBuilderAPI_Transform(local, down, true).Shape();
  }
  return local;
}

TopoDS_Shape kernelScale(const TopoDS_Shape& shape, double sx, double sy, double sz) {
  if (std::abs(sx - 1.0) < 5e-4 && std::abs(sy - 1.0) < 5e-4 && std::abs(sz - 1.0) < 5e-4) return shape;
  gp_GTrsf gtrsf;
  gtrsf.SetVectorialPart(gp_Mat(sx, 0, 0, 0, sy, 0, 0, 0, sz));
  return BRepBuilderAPI_GTransform(shape, gtrsf, true).Shape();
}

namespace {

const char* const kStoredBrepOpen = "/* MINTR-BREP 1\n";
const char* const kStoredBrepClose = "\nMINTR-BREP-END */\n";

/** The engine's own copy of the solid, when this STEP came from kernelStoreStep. */
bool readStoredBrep(const std::string& text, TopoDS_Shape& out) {
  const std::size_t open = text.rfind(kStoredBrepOpen);
  if (open == std::string::npos) return false;
  const std::size_t start = open + std::strlen(kStoredBrepOpen);
  const std::size_t close = text.find(kStoredBrepClose, start);
  if (close == std::string::npos) return false;
  TopoDS_Shape read;
  try {
    if (!kernelReadBrep(text.substr(start, close - start), read) || read.IsNull()) return false;
  } catch (...) {
    return false;
  }
  out = read;
  return true;
}

} // namespace

bool kernelReadStep(const std::string& text, TopoDS_Shape& out) {
  if (readStoredBrep(text, out)) return true;
  std::istringstream in(text);
  STEPControl_Reader reader;
  if (reader.ReadStream("mintr", in) != IFSelect_RetDone) return false;
  reader.TransferRoots();
  out = reader.OneShape();
  return !out.IsNull();
}

std::string kernelStoreStep(const TopoDS_Shape& shape) {
  std::string step = kernelExportStep(shape, false);
  if (step.empty()) return step;
  const std::string brep = kernelExportBrep(shape);
  // A comment cannot hold its own end mark; such a copy is left out and STEP is read as before.
  if (brep.empty() || brep.find("*/") != std::string::npos) return step;
  // Inside the file, before its end line: a comment is allowed anywhere between entries.
  const std::size_t end = step.rfind("END-ISO-10303-21;");
  if (end == std::string::npos) return step;
  return step.substr(0, end) + kStoredBrepOpen + brep + kStoredBrepClose + step.substr(end);
}

bool kernelReadBrep(const std::string& text, TopoDS_Shape& out) {
  std::istringstream in(text);
  BRep_Builder builder;
  BRepTools::Read(out, in, builder);
  return !out.IsNull();
}

std::string kernelExportStep(const TopoDS_Shape& shape, bool zUp) {
  TopoDS_Shape out = shape;
  if (zUp) {
    gp_Trsf rot;
    rot.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0)), 90.0 * kKernelDeg);
    out = BRepBuilderAPI_Transform(shape, rot, true).Shape();
  }
  STEPControl_Writer writer;
  writer.Transfer(out, STEPControl_AsIs);
  std::ostringstream stream;
  if (writer.WriteStream(stream) != IFSelect_RetDone) return {};
  return stream.str();
}

std::string kernelExportBrep(const TopoDS_Shape& shape) {
  std::ostringstream out;
  BRepTools::Write(shape, out);
  return out.str();
}

bool kernelTessellate(const TopoDS_Shape& shape, std::vector<double>& positions, double deflection) {
  BRepMesh_IncrementalMesh mesh(shape, deflection, false, 0.28, true);
  (void)mesh;
  positions.clear();
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
      positions.push_back(a.X());
      positions.push_back(a.Y());
      positions.push_back(a.Z());
      positions.push_back(b.X());
      positions.push_back(b.Y());
      positions.push_back(b.Z());
      positions.push_back(c.X());
      positions.push_back(c.Y());
      positions.push_back(c.Z());
    }
  }
  return positions.size() >= 9;
}

namespace {

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
// location, so the normal is not transformed again. A reversed face stores
// the geometric normal on the inside; flip it to match the drawn triangles.
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
    BRepAdaptor_Surface adaptor(face, true);
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

// True when `facet` points into the material. Hole walls and coves are often
// meshed that way, so a light from outside the solid misses them.
bool facetPointsIntoSolid(
  BRepClass3d_SolidClassifier& classifier,
  const gp_Pnt& a,
  const gp_Pnt& b,
  const gp_Pnt& c,
  const gp_Vec& facet
) {
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

// Which way round each face's facets sit compared with its neighbours'. Two facets
// on the outside of a solid run along the edge they share in opposite directions,
// so faces joined by edges form one piece that a single inside/outside test
// orients: a face running a shared edge the same way as its neighbour is the
// other way round to it. One test per piece instead of one per smooth patch
// keeps a part with hundreds of faces (a long exact thread) quick to mesh.
// Corners are matched to a thousandth of a millimetre, as in orientSolidNormals.
struct FaceSide {
  int piece;
  bool turned;
};

std::vector<FaceSide> faceSides(const TopoDS_Shape& meshed) {
  struct CornerKey {
    long long x, y, z;
    bool operator<(const CornerKey& other) const {
      if (x != other.x) return x < other.x;
      if (y != other.y) return y < other.y;
      return z < other.z;
    }
  };
  struct Owner {
    int face;
    bool forward;
  };
  struct EdgeUse {
    int count;
    Owner first;
    Owner second;
  };
  std::vector<int> parent;
  // Whether a face is turned compared with its parent.
  std::vector<char> turnedFromParent;
  const auto find = [&](int index) {
    bool turned = false;
    int root = index;
    while (parent[static_cast<size_t>(root)] != root) {
      turned = turned != (turnedFromParent[static_cast<size_t>(root)] != 0);
      root = parent[static_cast<size_t>(root)];
    }
    // Path compression: point straight at the root, keeping each face's turn.
    bool remaining = turned;
    while (parent[static_cast<size_t>(index)] != root) {
      const int next = parent[static_cast<size_t>(index)];
      const bool own = turnedFromParent[static_cast<size_t>(index)] != 0;
      parent[static_cast<size_t>(index)] = root;
      turnedFromParent[static_cast<size_t>(index)] = remaining ? 1 : 0;
      remaining = remaining != own;
      index = next;
    }
    return std::make_pair(root, turned);
  };
  const auto key = [](const gp_Pnt& point) {
    return CornerKey{ std::llround(point.X() * 1000.0), std::llround(point.Y() * 1000.0), std::llround(point.Z() * 1000.0) };
  };
  std::map<std::pair<CornerKey, CornerKey>, EdgeUse> edges;
  int faceIndex = 0;
  for (TopExp_Explorer exp(meshed, TopAbs_FACE); exp.More(); exp.Next(), ++faceIndex) {
    parent.push_back(faceIndex);
    turnedFromParent.push_back(0);
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
      const gp_Pnt points[3] = { tri->Node(n1).Transformed(trsf), tri->Node(n2).Transformed(trsf), tri->Node(n3).Transformed(trsf) };
      if (gp_Vec(points[0], points[1]).Crossed(gp_Vec(points[0], points[2])).Magnitude() < 1e-12) continue;
      for (int slot = 0; slot < 3; ++slot) {
        const CornerKey a = key(points[slot]);
        const CornerKey b = key(points[(slot + 1) % 3]);
        const bool forward = a < b;
        EdgeUse& use = edges[forward ? std::make_pair(a, b) : std::make_pair(b, a)];
        if (use.count == 0) use.first = Owner{ faceIndex, forward };
        else if (use.count == 1) use.second = Owner{ faceIndex, forward };
        ++use.count;
      }
    }
  }
  // Only an edge with exactly two facets on it joins two faces; where solids touch along an
  // edge, more meet there and say nothing about which way round each solid is.
  for (const auto& [edge, use] : edges) {
    if (use.count != 2 || use.first.face == use.second.face) continue;
    const auto [mine, mineTurned] = find(use.second.face);
    const auto [theirs, theirsTurned] = find(use.first.face);
    if (mine == theirs) continue;
    // Same direction along the edge: the two faces are turned from each other.
    const bool apart = use.first.forward == use.second.forward;
    parent[static_cast<size_t>(mine)] = theirs;
    turnedFromParent[static_cast<size_t>(mine)] = (mineTurned != theirsTurned) != apart ? 1 : 0;
  }
  std::vector<FaceSide> sides;
  sides.reserve(static_cast<size_t>(faceIndex));
  for (int index = 0; index < faceIndex; ++index) {
    const auto [root, turned] = find(index);
    sides.push_back({ root, turned });
  }
  return sides;
}

bool faceNormalAt(const TopoDS_Face& face, const gp_Pnt& point, gp_Dir& normal) {
  try {
    BRepAdaptor_Surface adaptor(face, true);
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
    double u = 0;
    double v = 0;
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

} // namespace

bool kernelTessellateIndexed(
  const TopoDS_Shape& shape,
  nlohmann::json& positions,
  nlohmann::json& normals,
  nlohmann::json& indices,
  double linear,
  double angular,
  const KernelMeshOptions& options
) {
  double linearStep = std::max(0.01, linear);
  double angularStep = angular > 0.0 ? std::max(0.02, angular) : 0.32;
  TopoDS_Shape meshed = shape;
  if (options.copyFirst) {
    meshed = BRepBuilderAPI_Copy(shape).Shape();
    if (meshed.IsNull()) meshed = shape;
  }
  const auto meshAt = [&](double linearAt, double angularAt) {
    BRepTools::Clean(meshed);
    BRepMesh_IncrementalMesh mesh(meshed, linearAt, false, angularAt, true);
    (void)mesh;
    return static_cast<double>(triangulationTriangles(meshed));
  };
  const double target = options.targetTriangles;
  bool matched = false;
  if (target >= 12.0) {
    const auto off = [&](double count) { return std::abs(std::log(std::max(1.0, count) / target)); };
    const auto near = [&](double count) { return count <= target * 1.5 + 64.0 && count >= target / 1.5 - 64.0; };
    double count = meshAt(linearStep, angularStep);
    if (count > 0.0 && !near(count)) {
      const bool coarser = count > target;
      const double factor = coarser ? 1.6 : 1.0 / 1.6;
      double bestLinear = linearStep, bestAngular = angularStep, bestCount = count;
      double lastLinear = linearStep, lastAngular = angularStep;
      for (int step = 0; step < 5; ++step) {
        const double nextLinear = std::min(0.3, std::max(0.01, lastLinear * factor));
        const double nextAngular = std::min(0.5, std::max(0.03, lastAngular * factor));
        if (nextLinear == lastLinear && nextAngular == lastAngular) break;
        lastLinear = nextLinear;
        lastAngular = nextAngular;
        const double next = meshAt(lastLinear, lastAngular);
        if (next <= 0.0) break;
        if (off(next) < off(bestCount)) {
          bestLinear = lastLinear;
          bestAngular = lastAngular;
          bestCount = next;
        }
        if (near(next) || (coarser ? next <= target : next >= target)) break;
      }
      if (bestLinear != lastLinear || bestAngular != lastAngular) count = meshAt(bestLinear, bestAngular);
      else count = bestCount;
    }
    // The triangle budget still wins over matching a very dense part.
    matched = count > 0.0 && count <= 180000.0;
  }
  // Two cheap coarse meshes, at six and three times the angle, show how fast this part's count
  // grows as the angle closes: about twice per halving for a cylinder, four times for a torus.
  // From them, the count at the asked angle is foretold without meshing it. Only a fine angle
  // on a part that showed its count is probed.
  bool probeKept = false;
  double probePower = 0.0;
  if (!matched && options.shownTriangles >= 12.0 && angularStep < 0.2) {
    const double coarseAngular = std::min(0.5, angularStep * 6.0);
    const double probeAngular = std::min(0.5, angularStep * 3.0);
    const double coarse = meshAt(linearStep, coarseAngular);
    const double probe = meshAt(linearStep, probeAngular);
    if (coarse > 0.0 && probe > 0.0 && probeAngular < coarseAngular) {
      // Growth per halving of the angle, as a power: 1 for a cylinder, 2 for a torus.
      const double power = std::clamp(std::log(probe / coarse) / std::log(coarseAngular / probeAngular), 0.5, 2.5);
      const double foretold = probe * std::pow(probeAngular / angularStep, power);
      if (foretold > options.shownTriangles * 4.0) {
        probePower = power;
        // What the parts showed, inside the budget. Not more, or a Group grouped again (which
        // shows this result) would grow on every step; not less, or each part in it would get
        // coarser on every step.
        const double goal = std::min(options.shownTriangles, 150000.0);
        const double opened = probeAngular * std::pow(probe / goal, 1.0 / power);
        if (opened < probeAngular * 1.25 && opened > probeAngular / 1.25 && probe <= 180000.0) {
          // The probe already is about right: keep its mesh.
          angularStep = probeAngular;
          probeKept = true;
        } else {
          angularStep = std::clamp(opened, angularStep, 0.5);
        }
      }
    }
  }
  for (int attempt = 0; !matched && !probeKept && attempt < 4; ++attempt) {
    const double count = meshAt(linearStep, angularStep);
    if (count <= 180000.0 || attempt == 3) break;
    // With the part's growth measured, step straight to inside the budget.
    const double opening = probePower > 0.0 ? std::pow(count / 140000.0, 1.0 / probePower) : 1.75;
    angularStep = std::min(options.maxAngular, angularStep * std::max(1.2, opening));
    linearStep = std::min(0.25, linearStep * 1.75);
  }
  positions = nlohmann::json::array();
  normals = nlohmann::json::array();
  indices = nlohmann::json::array();
  int next = 0;
  std::vector<gp_Vec> nodeNormals;
  std::vector<char> nodeReady;
  // Where each triangulation node already went in the output, for shared corners.
  std::vector<int> emitted;
  // Built on first use: most pieces are decided by the first test.
  std::unique_ptr<BRepClass3d_SolidClassifier> classifier;
  bool classifierTried = false;
  const std::vector<FaceSide> sides = faceSides(meshed);
  // Per piece: whether its unturned faces point into the solid. One probe now decides a whole
  // piece, so each piece votes with the largest facet of up to three of its faces; a sliver
  // facet or a wall thinner than the probe step can then only be outvoted.
  std::vector<int> pieceFlip(sides.size(), 0);
  {
    std::vector<int> votes(sides.size(), 0);
    std::vector<int> flipVotes(sides.size(), 0);
    int probeFace = -1;
    for (TopExp_Explorer exp(meshed, TopAbs_FACE); exp.More(); exp.Next()) {
      ++probeFace;
      const FaceSide& side = sides[static_cast<size_t>(probeFace)];
      if (votes[static_cast<size_t>(side.piece)] >= 3) continue;
      const TopoDS_Face face = TopoDS::Face(exp.Current());
      TopLoc_Location loc;
      Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, loc);
      if (tri.IsNull()) continue;
      const gp_Trsf trsf = loc.Transformation();
      const bool reverse = face.Orientation() == TopAbs_REVERSED;
      double bestArea = 0.0;
      gp_Pnt best[3];
      gp_Vec bestFacet;
      for (int i = 1; i <= tri->NbTriangles(); ++i) {
        int n1, n2, n3;
        tri->Triangle(i).Get(n1, n2, n3);
        if (reverse) std::swap(n2, n3);
        const gp_Pnt a = tri->Node(n1).Transformed(trsf);
        const gp_Pnt b = tri->Node(n2).Transformed(trsf);
        const gp_Pnt c = tri->Node(n3).Transformed(trsf);
        const gp_Vec facet = gp_Vec(a, b).Crossed(gp_Vec(a, c));
        if (facet.Magnitude() <= bestArea) continue;
        bestArea = facet.Magnitude();
        best[0] = a;
        best[1] = b;
        best[2] = c;
        bestFacet = facet;
      }
      if (bestArea < 1e-12) continue;
      if (!classifierTried) {
        classifierTried = true;
        try {
          classifier = std::make_unique<BRepClass3d_SolidClassifier>(shape);
        } catch (...) {
          classifier.reset();
        }
      }
      if (!classifier) break;
      const bool into = facetPointsIntoSolid(*classifier, best[0], best[1], best[2], bestFacet.Normalized());
      votes[static_cast<size_t>(side.piece)] += 1;
      if (into != side.turned) flipVotes[static_cast<size_t>(side.piece)] += 1;
    }
    for (size_t piece = 0; piece < sides.size(); ++piece) {
      pieceFlip[piece] = votes[piece] > 0 && flipVotes[piece] * 2 > votes[piece] ? 1 : 0;
    }
  }
  int faceIndex = -1;
  for (TopExp_Explorer exp(meshed, TopAbs_FACE); exp.More(); exp.Next()) {
    ++faceIndex;
    const TopoDS_Face face = TopoDS::Face(exp.Current());
    TopLoc_Location loc;
    Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, loc);
    if (tri.IsNull()) continue;
    const gp_Trsf trsf = loc.Transformation();
    const bool reverse = face.Orientation() == TopAbs_REVERSED;
    const int nodeCount = tri->NbNodes();
    surfaceNormalsForFace(face, tri, nodeNormals, nodeReady);
    if (options.shareNodes) emitted.assign(static_cast<size_t>(nodeCount) + 1, -1);
    bool flipFace = false;
    bool flipDecided = false;
    for (int i = 1; i <= tri->NbTriangles(); ++i) {
      int n1, n2, n3;
      tri->Triangle(i).Get(n1, n2, n3);
      if (reverse) std::swap(n2, n3);
      const gp_Pnt a = tri->Node(n1).Transformed(trsf);
      const gp_Pnt b = tri->Node(n2).Transformed(trsf);
      const gp_Pnt c = tri->Node(n3).Transformed(trsf);
      gp_Vec ab(a, b);
      gp_Vec ac(a, c);
      gp_Vec facet = ab.Crossed(ac);
      if (facet.Magnitude() < 1e-12) continue;
      facet.Normalize();
      if (!flipDecided) {
        const FaceSide& side = sides[static_cast<size_t>(faceIndex)];
        flipFace = (pieceFlip[static_cast<size_t>(side.piece)] == 1) != side.turned;
        flipDecided = true;
      }
      const int nodes[3] = { n1, n2, n3 };
      const gp_Pnt points[3] = { a, b, c };
      for (int corner = 0; corner < 3; ++corner) {
        const int node = nodes[corner];
        // Corners are shared within one face only, so faces still meet at a crisp edge.
        if (options.shareNodes && node >= 1 && node <= nodeCount && emitted[static_cast<size_t>(node)] >= 0) {
          indices.push_back(emitted[static_cast<size_t>(node)]);
          continue;
        }
        const gp_Pnt& point = points[corner];
        positions.push_back(point.X());
        positions.push_back(point.Y());
        positions.push_back(point.Z());
        gp_Vec use = facet;
        if (node >= 1 && node <= nodeCount && static_cast<int>(nodeReady.size()) >= node && nodeReady[static_cast<size_t>(node - 1)]) {
          use = nodeNormals[static_cast<size_t>(node - 1)];
          if (use.Dot(facet) < 0.0) use.Reverse();
        }
        if (flipFace) use.Reverse();
        normals.push_back(use.X());
        normals.push_back(use.Y());
        normals.push_back(use.Z());
        if (options.shareNodes && node >= 1 && node <= nodeCount) emitted[static_cast<size_t>(node)] = next;
        indices.push_back(next++);
      }
    }
  }
  return positions.size() >= 9;
}

nlohmann::json kernelDisplayEdges(const TopoDS_Shape& shape) {
  nlohmann::json display = nlohmann::json::array();
  try {
    TopTools_IndexedDataMapOfShapeListOfShape map;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, map);
    for (int i = 1; i <= map.Extent(); ++i) {
      const TopoDS_Edge edge = TopoDS::Edge(map.FindKey(i));
      if (BRep_Tool::Degenerated(edge)) continue;
      const TopTools_ListOfShape& faces = map.FindFromIndex(i);
      if (faces.Extent() != 2) continue;
      BRepAdaptor_Curve curve(edge);
      GCPnts_QuasiUniformDeflection discret(curve, 0.05);
      if (!discret.IsDone() || discret.NbPoints() < 2) continue;
      const gp_Pnt mid = discret.Value((discret.NbPoints() + 1) / 2);
      gp_Dir na;
      gp_Dir nb;
      const bool haveNormals = faceNormalAt(TopoDS::Face(faces.First()), mid, na)
        && faceNormalAt(TopoDS::Face(faces.Last()), mid, nb);
      if (haveNormals) {
        const double dot = std::max(-1.0, std::min(1.0, na.XYZ().Dot(nb.XYZ())));
        const double turn = std::acos(dot);
        const double dihedral = std::min(turn, kKernelPi - turn);
        // A seam or a fillet meeting its wall is nearly tangent. A rim is not.
        if (dihedral < 12.0 * kKernelDeg) continue;
      }
      const gp_Pnt first = discret.Value(1);
      double reach = 0;
      nlohmann::json points = nlohmann::json::array();
      for (int p = 1; p <= discret.NbPoints(); ++p) {
        const gp_Pnt pt = discret.Value(p);
        reach = std::max(reach, first.Distance(pt));
        points.push_back(pt.X());
        points.push_back(pt.Y());
        points.push_back(pt.Z());
      }
      if (reach < 0.15 || points.size() < 6) continue;
      display.push_back({ { "points", points } });
    }
  } catch (...) {
    return nlohmann::json::array();
  }
  return display;
}

double kernelVolume(const TopoDS_Shape& shape) {
  GProp_GProps props;
  BRepGProp::VolumeProperties(shape, props);
  return std::abs(props.Mass());
}

double kernelArea(const TopoDS_Shape& shape) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(shape, props);
  return std::abs(props.Mass());
}

namespace {

bool exactBox(const TopoDS_Shape& shape, Bnd_Box& box) {
  try {
    BRepBndLib::AddOptimal(shape, box, false, false);
  } catch (...) {
    return false;
  }
  return !box.IsVoid();
}

/**
 * A fuse that comes back well formed can still be wrong: OCCT can drop a part or keep the
 * wrong side of a face and pass every check (a ball added to a Group of balls vanished, and
 * half the ball it met went with it). A fuse holds all of each part, so it reaches as far as
 * every part does and holds at least as much as the biggest one.
 */
bool fuseHoldsParts(const TopoDS_Shape& base, const TopTools_ListOfShape& tools, const TopoDS_Shape& out) {
  Bnd_Box parts;
  if (!exactBox(base, parts)) return true;
  double biggest = kernelVolume(base);
  for (TopTools_ListOfShape::Iterator it(tools); it.More(); it.Next()) {
    if (!exactBox(it.Value(), parts)) return true;
    biggest = std::max(biggest, kernelVolume(it.Value()));
  }
  Bnd_Box result;
  if (!exactBox(out, result)) return false;
  double ax0, ay0, az0, ax1, ay1, az1, bx0, by0, bz0, bx1, by1, bz1;
  parts.Get(ax0, ay0, az0, ax1, ay1, az1);
  result.Get(bx0, by0, bz0, bx1, by1, bz1);
  const double reach = std::max(1e-4, std::sqrt(parts.SquareExtent()) * 1e-5);
  if (bx0 > ax0 + reach || by0 > ay0 + reach || bz0 > az0 + reach) return false;
  if (bx1 < ax1 - reach || by1 < ay1 - reach || bz1 < az1 - reach) return false;
  return kernelVolume(out) >= biggest * (1.0 - 1e-6) - 1e-6;
}

double booleanSpan(const TopoDS_Shape& base, const TopTools_ListOfShape& tools) {
  Bnd_Box box;
  try {
    BRepBndLib::Add(base, box);
    for (TopTools_ListOfShape::Iterator it(tools); it.More(); it.Next()) BRepBndLib::Add(it.Value(), box);
  } catch (...) {
    return 0.0;
  }
  if (box.IsVoid()) return 0.0;
  return std::sqrt(box.SquareExtent());
}

bool booleanOnce(KernelBooleanOp op, const TopoDS_Shape& base, const TopTools_ListOfShape& tools, double fuzzy, TopoDS_Shape& out, std::string& why) {
  std::unique_ptr<BRepAlgoAPI_BooleanOperation> algo;
  if (op == KernelBooleanOp::Fuse) algo = std::make_unique<BRepAlgoAPI_Fuse>();
  else if (op == KernelBooleanOp::Cut) algo = std::make_unique<BRepAlgoAPI_Cut>();
  else algo = std::make_unique<BRepAlgoAPI_Common>();
  TopTools_ListOfShape arguments;
  arguments.Append(base);
  algo->SetArguments(arguments);
  algo->SetTools(tools);
  algo->SetRunParallel(true);
  algo->SetNonDestructive(true);
  algo->SetUseOBB(true);
  if (fuzzy > 0) algo->SetFuzzyValue(fuzzy);
  try {
    algo->Build();
  } catch (const Standard_Failure& failure) {
    why = failure.GetMessageString() ? failure.GetMessageString() : "OCCT failed";
    return false;
  }
  if (!algo->IsDone() || algo->HasErrors() || algo->Shape().IsNull()) {
    std::ostringstream report;
    algo->DumpErrors(report);
    why = report.str();
    return false;
  }
  out = algo->Shape();
  return true;
}

} // namespace

bool kernelBoolean(KernelBooleanOp op, const TopoDS_Shape& base, const TopTools_ListOfShape& tools, TopoDS_Shape& out, std::string* error) {
  if (base.IsNull() || tools.IsEmpty()) {
    if (error) *error = "boolean is missing a shape";
    return false;
  }
  // Exact first, like the browser kernel. Then a tolerance scaled to the parts (FreeCAD's
  // approach for faces that nearly touch). The old flat 0.04 mm is the last resort only.
  const double scaled = std::clamp(booleanSpan(base, tools) * 1e-6, Precision::Confusion() * 10.0, 1e-3);
  std::string why;
  for (const double fuzzy : { 0.0, scaled, 0.04 }) {
    if (!booleanOnce(op, base, tools, fuzzy, out, why)) continue;
    if (op == KernelBooleanOp::Fuse && !fuseHoldsParts(base, tools, out)) {
      why = "the fuse lost part of a solid";
      continue;
    }
    return true;
  }
  if (error) *error = why.empty() ? "boolean failed" : why;
  return false;
}

bool kernelBoolean(KernelBooleanOp op, const TopoDS_Shape& base, const TopoDS_Shape& tool, TopoDS_Shape& out, std::string* error) {
  TopTools_ListOfShape tools;
  tools.Append(tool);
  return kernelBoolean(op, base, tools, out, error);
}

nlohmann::json kernelFail(const std::string& message, bool fallback) {
  return { { "ok", false }, { "fallback", fallback }, { "message", message } };
}

bool kernelShapeIsValid(const TopoDS_Shape& shape, int maxFaces) {
  if (shape.IsNull()) return false;
  // BRepCheck is thorough but not cheap; a dense imported body with thousands
  // of faces is skipped rather than stalling every preview on it.
  int faces = 0;
  for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) {
    if (++faces > maxFaces) return true;
  }
  try {
    BRepCheck_Analyzer analyzer(shape, true);
    return analyzer.IsValid();
  } catch (...) {
    return false;
  }
}
