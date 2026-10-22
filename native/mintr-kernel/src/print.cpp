#include "print.hpp"
#include "occtio.hpp"
#include "primitives.hpp"

#include <BRepAdaptor_Surface.hxx>
#include <BRepIntCurveSurface_Inter.hxx>
#include <BRepLProp_SLProps.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <GeomAdaptor_Curve.hxx>
#include <Geom_Line.hxx>
#include <Poly_Triangulation.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax1.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <queue>
#include <vector>

namespace {

struct Tri {
  gp_Pnt a;
  gp_Pnt b;
  gp_Pnt c;
  gp_Dir n;
};

struct FaceTris {
  std::vector<Tri> tris;
  gp_Pnt sample;
  gp_Dir outward;
  bool hasSample = false;
  GeomAbs_SurfaceType type = GeomAbs_OtherSurface;
  double radius = 0;
};

bool triangleNeedsSupport(double y0, double y1, double y2, double normalY, double angleDeg) {
  const double clamped = std::max(0.0, std::min(85.0, angleDeg));
  const double limit = std::sin(clamped * 3.14159265358979323846 / 180.0);
  if (!(normalY < -limit - 1e-4)) return false;
  const double midY = (y0 + y1 + y2) / 3.0;
  if (midY <= 0.6 && normalY < -0.85) return false;
  return true;
}

void pushTri(nlohmann::json& positions, nlohmann::json& normals, const Tri& tri) {
  positions.push_back(tri.a.X());
  positions.push_back(tri.a.Y());
  positions.push_back(tri.a.Z());
  positions.push_back(tri.b.X());
  positions.push_back(tri.b.Y());
  positions.push_back(tri.b.Z());
  positions.push_back(tri.c.X());
  positions.push_back(tri.c.Y());
  positions.push_back(tri.c.Z());
  for (int i = 0; i < 3; ++i) {
    normals.push_back(tri.n.X());
    normals.push_back(tri.n.Y());
    normals.push_back(tri.n.Z());
  }
}

bool collectFaces(const TopoDS_Shape& shape, std::vector<FaceTris>& faces, double deflection) {
  BRepMesh_IncrementalMesh mesh(shape, deflection, false, 0.28, true);
  (void)mesh;
  faces.clear();
  for (TopExp_Explorer exp(shape, TopAbs_FACE); exp.More(); exp.Next()) {
    const TopoDS_Face face = TopoDS::Face(exp.Current());
    FaceTris entry;
    BRepAdaptor_Surface surf(face);
    entry.type = surf.GetType();
    if (entry.type == GeomAbs_Cylinder) entry.radius = surf.Cylinder().Radius();
    else if (entry.type == GeomAbs_Cone) entry.radius = std::abs(surf.Cone().RefRadius());
    Standard_Real umin, umax, vmin, vmax;
    BRepTools::UVBounds(face, umin, umax, vmin, vmax);
    BRepLProp_SLProps props(surf, 0.5 * (umin + umax), 0.5 * (vmin + vmax), 1, 1e-6);
    if (props.IsNormalDefined()) {
      entry.sample = props.Value();
      gp_Dir n = props.Normal();
      if (face.Orientation() == TopAbs_REVERSED) n.Reverse();
      entry.outward = n;
      entry.hasSample = true;
    }
    TopLoc_Location loc;
    Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, loc);
    if (tri.IsNull()) {
      faces.push_back(entry);
      continue;
    }
    const gp_Trsf trsf = loc.Transformation();
    const bool reverse = face.Orientation() == TopAbs_REVERSED;
    for (int i = 1; i <= tri->NbTriangles(); ++i) {
      int n1, n2, n3;
      tri->Triangle(i).Get(n1, n2, n3);
      if (reverse) std::swap(n2, n3);
      Tri t;
      t.a = tri->Node(n1).Transformed(trsf);
      t.b = tri->Node(n2).Transformed(trsf);
      t.c = tri->Node(n3).Transformed(trsf);
      gp_Vec ab(t.a, t.b);
      gp_Vec ac(t.a, t.c);
      gp_Vec n = ab.Crossed(ac);
      if (n.Magnitude() < 1e-12) continue;
      t.n = gp_Dir(n);
      entry.tris.push_back(t);
      if (!entry.hasSample) {
        entry.sample = gp_Pnt(
          (t.a.X() + t.b.X() + t.c.X()) / 3.0,
          (t.a.Y() + t.b.Y() + t.c.Y()) / 3.0,
          (t.a.Z() + t.b.Z() + t.c.Z()) / 3.0
        );
        entry.outward = t.n;
        entry.hasSample = true;
      }
    }
    faces.push_back(std::move(entry));
  }
  return !faces.empty();
}

double firstHit(const TopoDS_Shape& shape, const gp_Pnt& origin, const gp_Dir& dir, double maxW) {
  Handle(Geom_Line) line = new Geom_Line(gp_Ax1(origin, dir));
  BRepIntCurveSurface_Inter explorer;
  explorer.Init(shape, GeomAdaptor_Curve(line), 1e-4);
  double best = 1e100;
  while (explorer.More()) {
    const double w = explorer.W();
    if (w > 0.02 && w < best) best = w;
    explorer.Next();
  }
  if (best > maxW) return -1;
  return best;
}

struct Occupancy {
  int nx = 0;
  int ny = 0;
  int nz = 0;
  double voxel = 1;
  double originX = 0;
  double originY = 0;
  double originZ = 0;
  std::vector<std::uint8_t> cells;
};

int cellIndex(const Occupancy& grid, int x, int y, int z) {
  return (z * grid.ny + y) * grid.nx + x;
}

bool buildOccupancy(const std::vector<FaceTris>& faces, Occupancy& grid) {
  double minX = 1e100, minY = 1e100, minZ = 1e100;
  double maxX = -1e100, maxY = -1e100, maxZ = -1e100;
  int count = 0;
  for (const auto& face : faces) {
    for (const auto& tri : face.tris) {
      minX = std::min({ minX, tri.a.X(), tri.b.X(), tri.c.X() });
      minY = std::min({ minY, tri.a.Y(), tri.b.Y(), tri.c.Y() });
      minZ = std::min({ minZ, tri.a.Z(), tri.b.Z(), tri.c.Z() });
      maxX = std::max({ maxX, tri.a.X(), tri.b.X(), tri.c.X() });
      maxY = std::max({ maxY, tri.a.Y(), tri.b.Y(), tri.c.Y() });
      maxZ = std::max({ maxZ, tri.a.Z(), tri.b.Z(), tri.c.Z() });
      count += 1;
    }
  }
  if (count == 0) return false;
  const double span = std::max({ maxX - minX, maxY - minY, maxZ - minZ });
  if (!(span > 0.05)) return false;
  constexpr int maxAxis = 40;
  grid.voxel = std::max(0.5, span / (maxAxis - 4));
  const double pad = grid.voxel * 1.5;
  grid.originX = minX - pad;
  grid.originY = minY - pad;
  grid.originZ = minZ - pad;
  grid.nx = std::max(4, std::min(maxAxis, static_cast<int>(std::ceil((maxX - minX + pad * 2) / grid.voxel))));
  grid.ny = std::max(4, std::min(maxAxis, static_cast<int>(std::ceil((maxY - minY + pad * 2) / grid.voxel))));
  grid.nz = std::max(4, std::min(maxAxis, static_cast<int>(std::ceil((maxZ - minZ + pad * 2) / grid.voxel))));
  grid.cells.assign(static_cast<size_t>(grid.nx * grid.ny * grid.nz), 0);
  const double reach = grid.voxel * 0.87;
  for (const auto& face : faces) {
    for (const auto& tri : face.tris) {
      const double loX = std::min({ tri.a.X(), tri.b.X(), tri.c.X() }) - reach;
      const double loY = std::min({ tri.a.Y(), tri.b.Y(), tri.c.Y() }) - reach;
      const double loZ = std::min({ tri.a.Z(), tri.b.Z(), tri.c.Z() }) - reach;
      const double hiX = std::max({ tri.a.X(), tri.b.X(), tri.c.X() }) + reach;
      const double hiY = std::max({ tri.a.Y(), tri.b.Y(), tri.c.Y() }) + reach;
      const double hiZ = std::max({ tri.a.Z(), tri.b.Z(), tri.c.Z() }) + reach;
      const int x0 = std::max(0, static_cast<int>(std::floor((loX - grid.originX) / grid.voxel)));
      const int y0 = std::max(0, static_cast<int>(std::floor((loY - grid.originY) / grid.voxel)));
      const int z0 = std::max(0, static_cast<int>(std::floor((loZ - grid.originZ) / grid.voxel)));
      const int x1 = std::min(grid.nx - 1, static_cast<int>(std::floor((hiX - grid.originX) / grid.voxel)));
      const int y1 = std::min(grid.ny - 1, static_cast<int>(std::floor((hiY - grid.originY) / grid.voxel)));
      const int z1 = std::min(grid.nz - 1, static_cast<int>(std::floor((hiZ - grid.originZ) / grid.voxel)));
      for (int z = z0; z <= z1; ++z) {
        for (int y = y0; y <= y1; ++y) {
          for (int x = x0; x <= x1; ++x) {
            grid.cells[static_cast<size_t>(cellIndex(grid, x, y, z))] = 1;
          }
        }
      }
    }
  }
  std::queue<int> open;
  auto tryPush = [&](int x, int y, int z) {
    if (x < 0 || y < 0 || z < 0 || x >= grid.nx || y >= grid.ny || z >= grid.nz) return;
    const int i = cellIndex(grid, x, y, z);
    if (grid.cells[static_cast<size_t>(i)] != 0) return;
    grid.cells[static_cast<size_t>(i)] = 2;
    open.push(i);
  };
  for (int z = 0; z < grid.nz; ++z) {
    for (int y = 0; y < grid.ny; ++y) {
      tryPush(0, y, z);
      tryPush(grid.nx - 1, y, z);
    }
  }
  for (int z = 0; z < grid.nz; ++z) {
    for (int x = 0; x < grid.nx; ++x) {
      tryPush(x, 0, z);
      tryPush(x, grid.ny - 1, z);
    }
  }
  for (int y = 0; y < grid.ny; ++y) {
    for (int x = 0; x < grid.nx; ++x) {
      tryPush(x, y, 0);
      tryPush(x, y, grid.nz - 1);
    }
  }
  while (!open.empty()) {
    const int i = open.front();
    open.pop();
    const int x = i % grid.nx;
    const int y = (i / grid.nx) % grid.ny;
    const int z = i / (grid.nx * grid.ny);
    tryPush(x - 1, y, z);
    tryPush(x + 1, y, z);
    tryPush(x, y - 1, z);
    tryPush(x, y + 1, z);
    tryPush(x, y, z - 1);
    tryPush(x, y, z + 1);
  }
  return true;
}

bool isTrappedEmpty(const Occupancy& grid, double x, double y, double z) {
  const int ix = static_cast<int>(std::floor((x - grid.originX) / grid.voxel));
  const int iy = static_cast<int>(std::floor((y - grid.originY) / grid.voxel));
  const int iz = static_cast<int>(std::floor((z - grid.originZ) / grid.voxel));
  if (ix < 0 || iy < 0 || iz < 0 || ix >= grid.nx || iy >= grid.ny || iz >= grid.nz) return false;
  return grid.cells[static_cast<size_t>(cellIndex(grid, ix, iy, iz))] == 0;
}

} // namespace

nlohmann::json handlePrintOverlay(const nlohmann::json& job) {
  if (!job.contains("solids") || !job["solids"].is_array()) {
    return kernelFail("native print overlay needs solids", true);
  }
  TopoDS_Shape solid;
  if (!assembleKernelShape(job["solids"], solid)) {
    return kernelFail("native print overlay could not build the solid", true);
  }
  std::vector<FaceTris> faces;
  if (!collectFaces(solid, faces, 0.18)) {
    return kernelFail("native print overlay tessellation failed", true);
  }
  const bool overhang = job.value("overhang", false);
  const bool thinWalls = job.value("thinWalls", false);
  const bool smallHoles = job.value("smallHoles", false);
  const bool trappedResin = job.value("trappedResin", false);
  const double angle = job.value("angle", 45.0);
  const double nozzle = std::max(0.2, std::min(1.2, job.value("nozzleMm", 0.4)));

  nlohmann::json overhangPositions = nlohmann::json::array();
  nlohmann::json overhangNormals = nlohmann::json::array();
  nlohmann::json thinPositions = nlohmann::json::array();
  nlohmann::json thinNormals = nlohmann::json::array();
  nlohmann::json holePositions = nlohmann::json::array();
  nlohmann::json holeNormals = nlohmann::json::array();
  nlohmann::json trappedPositions = nlohmann::json::array();
  nlohmann::json trappedNormals = nlohmann::json::array();

  Occupancy grid;
  const bool haveGrid = trappedResin && buildOccupancy(faces, grid);

  for (const auto& face : faces) {
    bool thin = false;
    bool hole = false;
    if ((thinWalls || smallHoles) && face.hasSample) {
      const gp_Pnt inset(
        face.sample.X() - face.outward.X() * 0.02,
        face.sample.Y() - face.outward.Y() * 0.02,
        face.sample.Z() - face.outward.Z() * 0.02
      );
      if (thinWalls) {
        const double hit = firstHit(solid, inset, gp_Dir(face.outward.Reversed()), nozzle);
        if (hit > 0.02 && hit < nozzle - 1e-4) thin = true;
      }
      if (smallHoles) {
        if ((face.type == GeomAbs_Cylinder || face.type == GeomAbs_Cone) && face.radius > 0.02 && face.radius < nozzle * 2.0) {
          hole = true;
        } else {
          const gp_Pnt outset(
            face.sample.X() + face.outward.X() * 0.02,
            face.sample.Y() + face.outward.Y() * 0.02,
            face.sample.Z() + face.outward.Z() * 0.02
          );
          const double gap = firstHit(solid, outset, face.outward, nozzle);
          if (gap > 0.02 && gap < nozzle - 1e-4) hole = true;
        }
      }
    }
    for (const auto& tri : face.tris) {
      if (overhang && triangleNeedsSupport(tri.a.Y(), tri.b.Y(), tri.c.Y(), tri.n.Y(), angle)) {
        pushTri(overhangPositions, overhangNormals, tri);
      }
      if (thin) pushTri(thinPositions, thinNormals, tri);
      if (hole) pushTri(holePositions, holeNormals, tri);
      if (haveGrid) {
        const double offset = grid.voxel * 1.2;
        const gp_Pnt sample(
          (tri.a.X() + tri.b.X() + tri.c.X()) / 3.0 + tri.n.X() * offset,
          (tri.a.Y() + tri.b.Y() + tri.c.Y()) / 3.0 + tri.n.Y() * offset,
          (tri.a.Z() + tri.b.Z() + tri.c.Z()) / 3.0 + tri.n.Z() * offset
        );
        if (isTrappedEmpty(grid, sample.X(), sample.Y(), sample.Z())) {
          pushTri(trappedPositions, trappedNormals, tri);
        }
      }
    }
  }

  return {
    { "ok", true },
    { "overhangPositions", overhangPositions },
    { "overhangNormals", overhangNormals },
    { "thinPositions", thinPositions },
    { "thinNormals", thinNormals },
    { "holePositions", holePositions },
    { "holeNormals", holeNormals },
    { "trappedPositions", trappedPositions },
    { "trappedNormals", trappedNormals },
  };
}

nlohmann::json handleMeasure(const nlohmann::json& job) {
  if (!job.contains("solids") || !job["solids"].is_array()) {
    return kernelFail("native measure needs solids", true);
  }
  TopoDS_Shape solid;
  if (!assembleKernelShape(job["solids"], solid)) {
    return kernelFail("native measure could not build the solid", true);
  }
  return {
    { "ok", true },
    { "volume", kernelVolume(solid) },
    { "area", kernelArea(solid) },
  };
}
