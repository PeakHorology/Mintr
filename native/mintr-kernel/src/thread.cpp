#include "thread.hpp"
#include "occtio.hpp"

#include <BOPAlgo_GlueEnum.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <GeomAPI_Interpolate.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Standard_Failure.hxx>
#include <TColgp_HArray1OfPnt.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <gp_Ax1.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <BRepAlgoAPI_Common.hxx>
#include <memory>
#include <string>
#include <utility>
#include <vector>

// Exact threads, built from the same numbers as the print mesh in metricThreadSolid.ts, so a
// part made exact keeps its size, fit and chamfers. The axis is +Y with the base at y = 0. A
// tooth rises as it turns from +X toward -Z for a right-hand thread (the right-hand rule).

namespace {

using Outline = std::vector<std::pair<double, double>>;

/** MINTR_THREAD_TRACE=1 prints each step's time to stderr. */
void trace(const char* step, double value = 0.0) {
  static const bool on = std::getenv("MINTR_THREAD_TRACE") != nullptr;
  static auto last = std::chrono::steady_clock::now();
  if (!on) return;
  const auto now = std::chrono::steady_clock::now();
  std::fprintf(stderr, "[thread] %-28s %8.0f ms  %g\n", step, std::chrono::duration<double, std::milli>(now - last).count(), value);
  last = now;
}

/** A half outline in the X / Y plane ([radius, height]), closed and spun a full turn round Y. */
bool revolveOutline(const Outline& points, TopoDS_Shape& out) {
  BRepBuilderAPI_MakePolygon polygon;
  for (const auto& [r, y] : points) polygon.Add(gp_Pnt(r, y, 0));
  polygon.Close();
  if (!polygon.IsDone()) return false;
  BRepBuilderAPI_MakeFace face(polygon.Wire(), true);
  if (!face.IsDone()) return false;
  BRepPrimAPI_MakeRevol turned(face.Face(), gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0)), 2.0 * kKernelPi);
  turned.Build();
  if (!turned.IsDone() || turned.Shape().IsNull()) return false;
  out = turned.Shape();
  return true;
}

bool cylinderY(double radius, double y0, double y1, TopoDS_Shape& out) {
  return revolveOutline({ { 0, y0 }, { radius, y0 }, { radius, y1 }, { 0, y1 } }, out);
}

/** A hexagon `across` its flats, corners at 30° + 60° steps as the print mesh puts them. */
bool hexPrismY(double across, double y0, double y1, TopoDS_Shape& out) {
  const double corner = (across / 2.0) / std::cos(kKernelPi / 6.0);
  BRepBuilderAPI_MakePolygon polygon;
  for (int index = 0; index < 6; ++index) {
    const double angle = kKernelPi / 6.0 + index * kKernelPi / 3.0;
    polygon.Add(gp_Pnt(std::cos(angle) * corner, y0, std::sin(angle) * corner));
  }
  polygon.Close();
  BRepBuilderAPI_MakeFace face(polygon.Wire(), true);
  if (!face.IsDone()) return false;
  BRepPrimAPI_MakePrism prism(face.Face(), gp_Vec(0, y1 - y0, 0));
  if (!prism.IsDone()) return false;
  out = prism.Shape();
  return true;
}

/**
 * The tooth in the plane through the axis at +X: from just inside the root, out over the crest
 * and back in, starting at height y0. `points` are [share of pitch, share of depth], from root to
 * root. Smooth teeth (Whitworth, round) run as one curve through them; the others are straight.
 */
bool toothProfile(const nlohmann::json& tooth, double minorR, double depth, double pitch, double y0, TopoDS_Wire& out) {
  if (!tooth.contains("points") || !tooth["points"].is_array() || tooth["points"].size() < 2) return false;
  const bool smooth = tooth.value("smooth", false);
  // Sunk a little into the core so the two fuse into one solid, not two touching ones.
  const double base = minorR - std::max(0.02, depth * 0.15);
  std::vector<gp_Pnt> crest;
  for (const auto& point : tooth["points"]) {
    const double u = point[0].get<double>();
    const double h = point[1].get<double>();
    crest.emplace_back(minorR + depth * h, y0 + u * pitch, 0.0);
  }
  // A straight tooth's root corners sit right on the core's surface, so its root edges would lie
  // along the core, which booleans read unreliably (on some sizes the tooth and core never join).
  // Each flank runs on into the core instead and crosses its surface cleanly.
  if (!smooth && crest.size() >= 2) {
    const auto sunk = [&](const gp_Pnt& root, const gp_Pnt& next) {
      const double rise = next.X() - root.X();
      if (rise < 1e-9) return root;
      const double t = (base - root.X()) / rise;
      const double y = root.Y() + t * (next.Y() - root.Y());
      if (y < y0 || y > y0 + pitch) return root;
      return gp_Pnt(base, y, 0.0);
    };
    crest.front() = sunk(crest[0], crest[1]);
    crest.back() = sunk(crest[crest.size() - 1], crest[crest.size() - 2]);
  }
  BRepBuilderAPI_MakeWire wire;
  const gp_Pnt first(base, crest.front().Y(), 0.0);
  const gp_Pnt last(base, crest.back().Y(), 0.0);
  if (first.Distance(crest.front()) > 1e-9) wire.Add(BRepBuilderAPI_MakeEdge(first, crest.front()).Edge());
  if (smooth && crest.size() >= 3) {
    Handle(TColgp_HArray1OfPnt) poles = new TColgp_HArray1OfPnt(1, static_cast<int>(crest.size()));
    for (size_t index = 0; index < crest.size(); ++index) poles->SetValue(static_cast<int>(index) + 1, crest[index]);
    GeomAPI_Interpolate curve(poles, false, 1e-7);
    curve.Perform();
    if (!curve.IsDone()) return false;
    wire.Add(BRepBuilderAPI_MakeEdge(curve.Curve()).Edge());
  } else {
    for (size_t index = 0; index + 1 < crest.size(); ++index) {
      if (crest[index].Distance(crest[index + 1]) < 1e-9) continue;
      wire.Add(BRepBuilderAPI_MakeEdge(crest[index], crest[index + 1]).Edge());
    }
  }
  if (crest.back().Distance(last) > 1e-9) wire.Add(BRepBuilderAPI_MakeEdge(crest.back(), last).Edge());
  wire.Add(BRepBuilderAPI_MakeEdge(last, first).Edge());
  if (!wire.IsDone()) return false;
  out = wire.Wire();
  return true;
}

double solidVolume(const TopoDS_Shape& shape) {
  GProp_GProps props;
  BRepGProp::VolumeProperties(shape, props);
  return std::abs(props.Mass());
}

/**
 * The tooth swept round a helix. The Frenet frame turns with the helix exactly, so the tooth
 * keeps its place against the axis all the way up; the plain pipe drifts and leaves a solid the
 * core will not join cleanly.
 */
bool sweepTooth(const TopoDS_Wire& helix, const TopoDS_Wire& profile, TopoDS_Shape& out) {
  try {
    BRepOffsetAPI_MakePipeShell shell(helix);
    shell.SetMode(true);
    // With correction: without it the straight-sided teeth sweep into garbage. It turns the tooth
    // square to the helix, which widens it along the axis by 1 / cos(helix angle): 0.2 % on
    // M6 x 1, about 1 % on a small coarse custom thread.
    shell.Add(profile, false, true);
    shell.Build();
    if (!shell.IsDone()) return false;
    shell.MakeSolid();
    out = shell.Shape();
    if (out.IsNull()) return false;
    // Depending on how the frame turns, the solid can come out inside out (a negative volume),
    // which a boolean reads as everything but the tooth.
    GProp_GProps props;
    BRepGProp::VolumeProperties(out, props);
    if (props.Mass() < 0.0) out.Reverse();
    return kernelShapeIsValid(out, 200000);
  } catch (...) {
    return false;
  }
}

int solidCount(const TopoDS_Shape& shape) {
  int count = 0;
  for (TopExp_Explorer solid(shape, TopAbs_SOLID); solid.More(); solid.Next()) ++count;
  return count;
}

/**
 * One solid from solids that share faces: the shared faces are inside the part, so they are
 * dropped and the rest, already joined edge to edge, close up as one shell.
 */
bool mergeTouchingSolids(const TopoDS_Shape& shape, TopoDS_Shape& out) {
  TopTools_IndexedDataMapOfShapeListOfShape owners;
  TopExp::MapShapesAndAncestors(shape, TopAbs_FACE, TopAbs_SOLID, owners);
  BRep_Builder builder;
  TopoDS_Shell shell;
  builder.MakeShell(shell);
  int kept = 0;
  for (TopExp_Explorer solid(shape, TopAbs_SOLID); solid.More(); solid.Next()) {
    for (TopExp_Explorer face(solid.Current(), TopAbs_FACE); face.More(); face.Next()) {
      const int index = owners.FindIndex(face.Current());
      if (index > 0 && owners.FindFromIndex(index).Extent() > 1) continue;
      builder.Add(shell, face.Current());
      ++kept;
    }
  }
  if (kept == 0) return false;
  // The faces left must close up as one piece: every edge on exactly two faces, and every face
  // reachable from the first. Anything else (two shells, a gap) is not one solid.
  TopTools_IndexedDataMapOfShapeListOfShape edgeFaces;
  TopExp::MapShapesAndAncestors(shell, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
  TopTools_IndexedMapOfShape faces;
  TopExp::MapShapes(shell, TopAbs_FACE, faces);
  std::vector<std::vector<int>> neighbours(static_cast<size_t>(faces.Extent()) + 1);
  for (int index = 1; index <= edgeFaces.Extent(); ++index) {
    if (BRep_Tool::Degenerated(TopoDS::Edge(edgeFaces.FindKey(index)))) continue;
    std::vector<int> around;
    for (const TopoDS_Shape& face : edgeFaces.FindFromIndex(index)) {
      const int id = faces.FindIndex(face);
      if (std::find(around.begin(), around.end(), id) == around.end()) around.push_back(id);
    }
    // A seam lies twice on one face; any other edge joins exactly two.
    if (around.size() == 1) {
      if (edgeFaces.FindFromIndex(index).Extent() != 2) return false;
      continue;
    }
    if (around.size() != 2) return false;
    neighbours[static_cast<size_t>(around[0])].push_back(around[1]);
    neighbours[static_cast<size_t>(around[1])].push_back(around[0]);
  }
  std::vector<char> reached(neighbours.size(), 0);
  std::vector<int> pending = { 1 };
  reached[1] = 1;
  int count = 1;
  while (!pending.empty()) {
    const int face = pending.back();
    pending.pop_back();
    for (const int next : neighbours[static_cast<size_t>(face)]) {
      if (reached[static_cast<size_t>(next)]) continue;
      reached[static_cast<size_t>(next)] = 1;
      pending.push_back(next);
      ++count;
    }
  }
  if (count != faces.Extent()) return false;
  shell.Closed(true);
  TopoDS_Solid merged;
  builder.MakeSolid(merged);
  builder.Add(merged, shell);
  out = merged;
  return true;
}

/**
 * Joins slices stacked up the axis into one solid. Each meets the next on a flat face that is
 * the same on both, so they are glued rather than intersected, which keeps a long fine thread
 * quick. A fuse joins objects to tools but can leave shapes on the same side apart, so
 * neighbours go on opposite sides; any that still come back as separate solids sharing a face
 * are closed up into one.
 */
bool glueStack(const std::vector<TopoDS_Shape>& pieces, double fuzzy, TopoDS_Shape& out) {
  if (pieces.empty()) return false;
  if (pieces.size() == 1) {
    out = kernelUnify(pieces.front());
    return true;
  }
  for (const BOPAlgo_GlueEnum glue : { BOPAlgo_GlueFull, BOPAlgo_GlueShift }) {
    TopTools_ListOfShape even;
    TopTools_ListOfShape odd;
    for (size_t index = 0; index < pieces.size(); ++index) (index % 2 == 0 ? even : odd).Append(pieces[index]);
    BRepAlgoAPI_Fuse glued;
    glued.SetArguments(even);
    glued.SetTools(odd);
    glued.SetGlue(glue);
    if (fuzzy > 0.0) glued.SetFuzzyValue(fuzzy);
    glued.SetRunParallel(true);
    glued.Build();
    if (!glued.IsDone() || glued.HasErrors() || glued.Shape().IsNull()) continue;
    TopoDS_Shape joined = glued.Shape();
    trace("glued, solids", solidCount(joined));
    if (solidCount(joined) > 1 && !mergeTouchingSolids(joined, joined)) continue;
    joined = kernelUnify(joined);
    if (solidCount(joined) != 1 || !kernelShapeIsValid(joined, 200000)) {
      trace("joined badly, solids", solidCount(joined));
      continue;
    }
    out = joined;
    return true;
  }
  return false;
}

TopoDS_Shape movedUp(const TopoDS_Shape& shape, double rise) {
  gp_Trsf up;
  up.SetTranslation(gp_Vec(0, rise, 0));
  return BRepBuilderAPI_Transform(shape, up, true).Shape();
}

/** A stretch of the part, from `low` to `high` up the axis, that meets the next on a flat face. */
struct Slice {
  TopoDS_Shape shape;
  double low;
  double high;
};

/**
 * A fuse or common that must come out as one solid. On some sizes (a fine custom pitch, a big
 * pipe thread, a coarse left-hand inch thread) the exact boolean misses where the tooth meets
 * the core and hands back both apart, nothing at all, or one solid bigger than both together;
 * a hair of tolerance finds the meeting. A fuse holds no less than the bigger part and no more
 * than both; a common no more than the smaller.
 */
bool oneSolidBoolean(bool fuse, const TopoDS_Shape& base, const TopoDS_Shape& tool, TopoDS_Shape& out) {
  const double a = solidVolume(base);
  const double b = solidVolume(tool);
  const double slack = 1e-6 * (a + b);
  for (const double fuzzy : { 0.0, 1e-4, 1e-3 }) {
    TopTools_ListOfShape arguments;
    TopTools_ListOfShape tools;
    arguments.Append(base);
    tools.Append(tool);
    std::unique_ptr<BRepAlgoAPI_BooleanOperation> algo;
    if (fuse) algo = std::make_unique<BRepAlgoAPI_Fuse>();
    else algo = std::make_unique<BRepAlgoAPI_Common>();
    algo->SetArguments(arguments);
    algo->SetTools(tools);
    algo->SetRunParallel(true);
    if (fuzzy > 0.0) algo->SetFuzzyValue(fuzzy);
    try {
      algo->Build();
    } catch (...) {
      continue;
    }
    if (!algo->IsDone() || algo->HasErrors() || algo->Shape().IsNull()) continue;
    if (solidCount(algo->Shape()) != 1) {
      trace(fuse ? "tooth stayed apart from the core at fuzzy" : "slice came out empty or split at fuzzy", fuzzy);
      continue;
    }
    const double volume = solidVolume(algo->Shape());
    const bool sized = fuse ? volume >= std::max(a, b) - slack && volume <= a + b + slack : volume <= std::min(a, b) + slack;
    if (!sized) {
      trace("boolean came out the wrong size at fuzzy", fuzzy);
      continue;
    }
    out = algo->Shape();
    return true;
  }
  return false;
}

/**
 * The threaded body from y0 to y1 as slices a pitch tall: a core at the minor radius with the
 * tooth swept round it on an exact helix, cut off square at both ends. Teeth sit where the print
 * mesh puts them, by height from y = 0.
 *
 * A thread repeats exactly every pitch, so one slice, made once and checked, copied up the axis
 * is the whole thread; the end slices are cut short. Ends are shaped on just the slices they
 * reach and the slices are glued last, so no boolean ever runs over the full length. The helix
 * can run at any radius without moving the tooth, and some radii join to the core more cleanly
 * than others, so a few are tried in turn.
 */
bool threadSlices(const nlohmann::json& thread, double y0, double y1, double offset, std::vector<Slice>& out, std::string& error) {
  const double pitch = thread.value("pitch", 1.0);
  const double minorR = thread.value("minorR", 1.0);
  const double majorR = thread.value("majorR", 1.5);
  const double depth = thread.value("toothDepth", majorR - minorR);
  const bool left = thread.value("hand", "right") == "left";
  const double far = majorR + depth + 1.0;
  out.clear();
  if (thread.value("plain", false)) {
    TopoDS_Shape core;
    if (!cylinderY(minorR, y0, y1, core)) {
      error = "Could not make the thread's core";
      return false;
    }
    out.push_back({ core, y0, y1 });
    return true;
  }
  // The tooth's area off the root, from its outline.
  double toothArea = 0.0;
  // How far out the tooth's area sits, as a share of its depth (first moment over area).
  double toothMoment = 0.0;
  {
    const auto& points = thread["tooth"]["points"];
    for (size_t index = 0; index + 1 < points.size(); ++index) {
      const double u0 = points[index][0].get<double>(), h0 = points[index][1].get<double>();
      const double u1 = points[index + 1][0].get<double>(), h1 = points[index + 1][1].get<double>();
      toothArea += (u1 - u0) * (h0 + h1) / 2.0;
      toothMoment += (u1 - u0) * (h0 * h0 + h0 * h1 + h1 * h1) / 6.0;
    }
    toothMoment = toothArea > 0.0 ? toothMoment / toothArea : 0.5;
    toothArea *= pitch * depth;
  }
  // A pitch of height holds the core plus the tooth's area swept once round its centroid
  // (Pappus), to within the tooth's tilt to the helix and the curve through a smooth tooth's
  // points. A slice outside that did not join properly.
  const double coreSlice = kKernelPi * minorR * minorR * pitch;
  const double toothSlice = toothArea * 2.0 * kKernelPi * (minorR + depth * toothMoment);
  const double lowest = coreSlice + 0.96 * toothSlice;
  const double highest = coreSlice + 1.03 * toothSlice;
  // Slices start `offset` of a pitch along: on a whole pitch the cut runs through the tooth's
  // corners, which leaves slivers of edge the slices cannot be joined on. The helix still starts
  // on a whole pitch, so the teeth stay where the print mesh puts them, and the slice
  // [base, base + pitch] holds parts of the four turns from two pitches below it.
  const double base = (std::floor(y0 / pitch - offset) + offset) * pitch;
  const double start = (std::floor(base / pitch) - 2.0) * pitch;
  TopoDS_Wire profile;
  TopoDS_Shape core;
  TopoDS_Shape slab;
  if (!toothProfile(thread["tooth"], minorR, depth, pitch, start, profile)
    || !cylinderY(minorR, start, start + 5.0 * pitch, core)
    || !cylinderY(far, base, base + pitch, slab)) {
    error = "Could not draw the thread's tooth";
    return false;
  }
  // A revolved core has its seam at +X, in the plane of the tooth's end faces; an edge lying on
  // an edge throws the boolean at fine pitches, so the seam is turned out of the way.
  gp_Trsf turnSeam;
  turnSeam.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0)), 1.0);
  core = BRepBuilderAPI_Transform(core, turnSeam, true).Shape();
  TopoDS_Shape slice;
  const auto fits = [&](const TopoDS_Shape& cut) {
    const double volume = solidVolume(cut);
    trace("slice", (volume - lowest) / (highest - lowest));
    return volume >= lowest && volume <= highest && solidCount(cut) == 1 && kernelShapeIsValid(cut, 200000);
  };
  for (const double spine : { majorR, (majorR + minorR) / 2.0, minorR }) {
    TopoDS_Wire helix;
    TopoDS_Shape ridge;
    TopoDS_Shape body;
    TopoDS_Shape cut;
    // Four turns in one sweep cover the slice; a sweep this short stays true to the helix.
    if (!kernelHelixWire(gp_Pnt(0, start, 0), gp_Dir(0, 1, 0), gp_Dir(1, 0, 0), spine, pitch, 4.0 * pitch, left, helix)) continue;
    if (!sweepTooth(helix, profile, ridge)) continue;
    if (!oneSolidBoolean(true, core, ridge, body)) continue;
    if (oneSolidBoolean(false, body, slab, cut) && fits(cut)) {
      slice = cut;
      break;
    }
  }
  if (slice.IsNull()) {
    error = "The thread's tooth did not join its core";
    return false;
  }
  const int count = static_cast<int>(std::ceil((y1 - base) / pitch - 1e-9));
  for (int index = 0; index < count; ++index) {
    const double low = base + index * pitch;
    const double high = low + pitch;
    TopoDS_Shape piece = index == 0 ? slice : movedUp(slice, index * pitch);
    const bool cutLow = low < y0 - 1e-9;
    const bool cutHigh = high > y1 + 1e-9;
    const double keptLow = cutLow ? y0 : low;
    const double keptHigh = cutHigh ? y1 : high;
    if (keptHigh - keptLow < 1e-6) continue;
    if (cutLow || cutHigh) {
      // Only a cut end is trimmed; the other runs past, so the joining face stays the slice's.
      TopoDS_Shape keep;
      TopoDS_Shape trimmed;
      if (!cylinderY(far, cutLow ? y0 : low - 1.0, cutHigh ? y1 : high + 1.0, keep)
        || !kernelBoolean(KernelBooleanOp::Common, piece, keep, trimmed, &error)) return false;
      piece = trimmed;
    }
    out.push_back({ piece, keptLow, keptHigh });
  }
  trace("slices", static_cast<double>(out.size()));
  return !out.empty();
}

/** A boolean whose result replaces its first shape; the input stays whole until it is done. */
bool booleanInPlace(KernelBooleanOp op, TopoDS_Shape& body, const TopoDS_Shape& tool, std::string& error) {
  TopoDS_Shape result;
  if (!kernelBoolean(op, body, tool, result, &error) || result.IsNull()) return false;
  body = result;
  return true;
}

/** Runs `op` with `tool` on every slice that reaches between `from` and `to` up the axis. */
bool editSlices(std::vector<Slice>& slices, double from, double to, KernelBooleanOp op, const TopoDS_Shape& tool, std::string& error) {
  for (auto& slice : slices) {
    if (slice.high <= from + 1e-9 || slice.low >= to - 1e-9) continue;
    if (!booleanInPlace(op, slice.shape, tool, error)) return false;
  }
  return true;
}

/** Cuts a 45° chamfer into a screw or rod end: nothing past `inset` inside the root at the face. */
bool chamferEnds(std::vector<Slice>& slices, double minorR, double outerR, double length, double bottom, double top, std::string& error) {
  const double far = outerR + 1.0;
  if (bottom > 0.0) {
    const double r0 = std::max(0.05, minorR - bottom);
    TopoDS_Shape limit;
    // The 45° line r = r0 + y meets the axis at y = -r0 and clears the crest at y = outerR - r0.
    if (!revolveOutline({ { 0, -r0 }, { far, far - r0 }, { far, length + 1 }, { 0, length + 1 } }, limit)) return false;
    if (!editSlices(slices, -1.0, outerR - r0, KernelBooleanOp::Common, limit, error)) return false;
  }
  if (top > 0.0) {
    const double r0 = std::max(0.05, minorR - top);
    TopoDS_Shape limit;
    if (!revolveOutline({ { 0, -1 }, { far, -1 }, { far, length - (far - r0) }, { 0, length + r0 } }, limit)) return false;
    if (!editSlices(slices, length - (outerR - r0), length + 1.0, KernelBooleanOp::Common, limit, error)) return false;
  }
  return true;
}

/**
 * Widens a hole's mouths like a countersink: at least `mouth` past the crest at each face. Each
 * slice the cone reaches takes it and is cut back to its own height, so the slices still meet
 * face to face.
 */
bool widenMouths(std::vector<Slice>& slices, double majorR, double minorR, double y0, double y1, double mouth, std::string& error) {
  if (mouth <= 0.0) return true;
  const double rim = majorR + mouth;
  // From a little past each face, so the cone and the face never meet edge to edge.
  const double over = 0.5;
  const double inner = std::max(0.05, minorR * 0.5);
  TopoDS_Shape low;
  TopoDS_Shape high;
  if (!revolveOutline({ { 0, y0 - over }, { rim + over, y0 - over }, { inner, y0 + rim - inner }, { 0, y0 + rim - inner } }, low)
    || !revolveOutline({ { 0, y1 + over }, { 0, y1 - (rim - inner) }, { inner, y1 - (rim - inner) }, { rim + over, y1 + over } }, high)) {
    return false;
  }
  for (auto& slice : slices) {
    const bool lowReaches = slice.low < y0 + rim - inner - 1e-9;
    const bool highReaches = slice.high > y1 - (rim - inner) + 1e-9;
    if (!lowReaches && !highReaches) continue;
    if (lowReaches && !booleanInPlace(KernelBooleanOp::Fuse, slice.shape, low, error)) return false;
    if (highReaches && !booleanInPlace(KernelBooleanOp::Fuse, slice.shape, high, error)) return false;
    TopoDS_Shape own;
    if (!cylinderY(rim + over + 1.0, slice.low, slice.high, own) || !booleanInPlace(KernelBooleanOp::Common, slice.shape, own, error)) return false;
  }
  return true;
}

} // namespace

namespace {

/** One go at the thread, sliced `offset` of a pitch along and glued with `fuzzy` slack. */
bool buildThreadOnce(const nlohmann::json& thread, double offset, double fuzzy, TopoDS_Shape& out, std::string& error) {
  try {
    const std::string role = thread.value("role", "rod");
    const double pitch = std::max(0.15, thread.value("pitch", 1.0));
    const double minorR = thread.value("minorR", 1.0);
    const double majorR = thread.value("majorR", 1.5);
    const double length = std::max(pitch, thread.value("length", 10.0));
    const double mouth = thread.value("mouth", 0.0);
    if (!(minorR > 0.0) || !(majorR > minorR - 1e-9)) {
      error = "The thread's sizes do not make a solid";
      return false;
    }
    std::vector<Slice> slices;
    if (!threadSlices(thread, 0, length, offset, slices, error)) return false;
    if (role == "nut" || role == "bore") {
      if (!widenMouths(slices, majorR, minorR, 0, length, mouth, error)) return false;
    } else {
      const double outer = thread.value("plain", false) ? minorR : majorR;
      if (!chamferEnds(slices, minorR, outer, length, thread.value("chamferBottom", 0.0), thread.value("chamferTop", 0.0), error)) return false;
    }
    if (role == "nut") {
      // Each stretch of nut is a stretch of hex with the matching stretch of thread cut out.
      const double across = thread.value("nutAcross", majorR * 3.2);
      for (auto& slice : slices) {
        TopoDS_Shape hex;
        TopoDS_Shape cut;
        if (!hexPrismY(across, slice.low, slice.high, hex) || !kernelBoolean(KernelBooleanOp::Cut, hex, slice.shape, cut, &error)) return false;
        slice.shape = cut;
      }
    }
    if (role == "screw" && thread.contains("head")) {
      const auto& head = thread["head"];
      const std::string kind = head.value("kind", "cylinder");
      const double across = head.value("across", majorR * 3.4);
      const double height = head.value("height", majorR * 2);
      TopoDS_Shape cap;
      bool made = false;
      if (kind == "hex") made = hexPrismY(across, length, length + height, cap);
      // Starts a hair outside the crest, so the cone never just touches a crest edge.
      else if (kind == "countersunk") made = revolveOutline({ { 0, length }, { majorR + 0.02, length }, { across / 2, length + height }, { 0, length + height } }, cap);
      // Sunk a hair into the top slice so the two join as one solid.
      else made = cylinderY(across / 2, std::max(slices.back().low, length - 0.01), length + height, cap);
      if (!made || !booleanInPlace(KernelBooleanOp::Fuse, slices.back().shape, cap, error)) return false;
    }
    trace("ends shaped");
    std::vector<TopoDS_Shape> pieces;
    for (const auto& slice : slices) pieces.push_back(slice.shape);
    if (!glueStack(pieces, fuzzy, out)) {
      error = "Could not join the thread's turns";
      return false;
    }
    if (!kernelShapeIsValid(out, 200000)) {
      error = "The exact thread came out invalid";
      return false;
    }
    trace("checked");
    return true;
  } catch (const Standard_Failure& failure) {
    error = failure.what() ? failure.what() : "OCCT failed on the thread";
    return false;
  }
}

} // namespace

bool buildThreadLocal(const nlohmann::json& thread, TopoDS_Shape& out, std::string& error) {
  // Whether slices glue cleanly depends on where the cuts fall against the tooth: OCCT splits the
  // outline of each cut at its own points, so neighbouring slices only sometimes meet edge for
  // edge. A thread that will not join is sliced again elsewhere, and only then with a hair of
  // slack in the glue, which rarely helps on its own. The order is the quickest found over 40
  // sizes, profiles and parts. Every result is checked as one valid solid, so a retry never
  // trades a failure for a wrong part.
  for (const double fuzzy : { 0.0, 1e-4 }) {
    for (const double offset : { 0.37, 0.13, 0.83, 0.61, 0.25, 0.5 }) {
      std::string why;
      if (buildThreadOnce(thread, offset, fuzzy, out, why)) return true;
      trace(why.c_str(), offset);
      if (error.empty()) error = why;
    }
  }
  return false;
}

nlohmann::json handleBuildThread(const nlohmann::json& job) {
  if (!job.contains("thread")) return kernelFail("buildThread is missing its thread", true);
  TopoDS_Shape shape;
  std::string error;
  if (!buildThreadLocal(job["thread"], shape, error)) return kernelFail(error.empty() ? "Could not make an exact thread" : error, true);
  nlohmann::json reply = { { "ok", true }, { "cadBrep", kernelExportBrep(shape) }, { "quality", "exact" }, { "valid", kernelShapeIsValid(shape, 200000) } };
  if (job.value("mesh", false)) {
    nlohmann::json positions, normals, indices;
    const double linear = std::max(0.002, job.value("meshTolerance", 0.03));
    if (!kernelTessellateIndexed(shape, positions, normals, indices, linear, std::min(0.2, linear * 5.0), sharedCorners())) return kernelFail("native tessellation failed", true);
    reply["positions"] = positions;
    reply["normals"] = normals;
    reply["indices"] = indices;
  }
  return reply;
}
