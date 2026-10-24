#include "occtio.hpp"

#include <Bnd_Box.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_GTransform.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Poly_Triangulation.hxx>
#include <STEPControl_Reader.hxx>
#include <STEPControl_Writer.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <gp.hxx>
#include <gp_Ax1.hxx>
#include <gp_Dir.hxx>
#include <gp_GTrsf.hxx>
#include <gp_Mat.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <gp_XYZ.hxx>

#include <cmath>
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
  BRepBndLib::Add(shape, box);
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
  if (kernelBounds(local, xmin, ymin, zmin, xmax, ymax, zmax)) {
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

bool kernelTessellateIndexed(
  const TopoDS_Shape& shape,
  nlohmann::json& positions,
  nlohmann::json& normals,
  nlohmann::json& indices,
  double linear
) {
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
      positions.push_back(a.X());
      positions.push_back(a.Y());
      positions.push_back(a.Z());
      positions.push_back(b.X());
      positions.push_back(b.Y());
      positions.push_back(b.Z());
      positions.push_back(c.X());
      positions.push_back(c.Y());
      positions.push_back(c.Z());
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
