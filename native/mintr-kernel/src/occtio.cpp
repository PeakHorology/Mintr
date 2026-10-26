#include "occtio.hpp"

#include <Bnd_Box.hxx>
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
#include <gp.hxx>
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
  if (std::abs(cx) < 0.05 && std::abs(cz) < 0.05 && std::abs(ymin) < 0.05) return shape;
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

bool kernelReadStep(const std::string& text, TopoDS_Shape& out) {
  std::istringstream in(text);
  STEPControl_Reader reader;
  if (reader.ReadStream("mintr", in) != IFSelect_RetDone) return false;
  reader.TransferRoots();
  out = reader.OneShape();
  return !out.IsNull();
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
  double angular
) {
  double linearStep = std::max(0.01, linear);
  double angularStep = angular > 0.0 ? std::max(0.02, angular) : 0.32;
  TopoDS_Shape meshed = BRepBuilderAPI_Copy(shape).Shape();
  if (meshed.IsNull()) meshed = shape;
  for (int attempt = 0; attempt < 4; ++attempt) {
    BRepTools::Clean(meshed);
    BRepMesh_IncrementalMesh mesh(meshed, linearStep, false, angularStep, true);
    (void)mesh;
    if (triangulationTriangles(meshed) <= 180000 || attempt == 3) break;
    angularStep = std::min(0.5, angularStep * 1.75);
    linearStep = std::min(0.25, linearStep * 1.75);
  }
  positions = nlohmann::json::array();
  normals = nlohmann::json::array();
  indices = nlohmann::json::array();
  int next = 0;
  std::vector<gp_Vec> nodeNormals;
  std::vector<char> nodeReady;
  std::unique_ptr<BRepClass3d_SolidClassifier> classifier;
  try {
    classifier = std::make_unique<BRepClass3d_SolidClassifier>(shape);
  } catch (...) {
    classifier.reset();
  }
  for (TopExp_Explorer exp(meshed, TopAbs_FACE); exp.More(); exp.Next()) {
    const TopoDS_Face face = TopoDS::Face(exp.Current());
    TopLoc_Location loc;
    Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, loc);
    if (tri.IsNull()) continue;
    const gp_Trsf trsf = loc.Transformation();
    const bool reverse = face.Orientation() == TopAbs_REVERSED;
    const int nodeCount = tri->NbNodes();
    surfaceNormalsForFace(face, tri, nodeNormals, nodeReady);
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
        flipFace = classifier && facetPointsIntoSolid(*classifier, a, b, c, facet);
        flipDecided = true;
      }
      const int nodes[3] = { n1, n2, n3 };
      const gp_Pnt points[3] = { a, b, c };
      for (int corner = 0; corner < 3; ++corner) {
        const gp_Pnt& point = points[corner];
        positions.push_back(point.X());
        positions.push_back(point.Y());
        positions.push_back(point.Z());
        const int node = nodes[corner];
        gp_Vec use = facet;
        if (node >= 1 && node <= nodeCount && static_cast<int>(nodeReady.size()) >= node && nodeReady[static_cast<size_t>(node - 1)]) {
          use = nodeNormals[static_cast<size_t>(node - 1)];
          if (use.Dot(facet) < 0.0) use.Reverse();
        }
        if (flipFace) use.Reverse();
        normals.push_back(use.X());
        normals.push_back(use.Y());
        normals.push_back(use.Z());
      }
      indices.push_back(next++);
      indices.push_back(next++);
      indices.push_back(next++);
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
