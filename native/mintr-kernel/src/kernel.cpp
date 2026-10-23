#include "kernel.hpp"
#include "fillet.hpp"
#include "occtio.hpp"
#include "primitives.hpp"
#include "print.hpp"
#include "sketch.hpp"
#include "split.hpp"

#include <BRepAlgoAPI_Common.hxx>
#include <BRep_Builder.hxx>
#include <Standard_Failure.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Shape.hxx>

#include <stdexcept>
#include <string>
#include <vector>

namespace {

bool booleanOp(
  const std::string& op,
  const std::vector<TopoDS_Shape>& solids,
  const std::vector<TopoDS_Shape>& holes,
  TopoDS_Shape& out
) {
  if (solids.empty()) return false;
  TopoDS_Shape acc = solids[0];
  if (op == "union" || op == "subtract") {
    // Two solids → one fuse. Three or more → one after another. Same helpers
    // as Split/print so a pile of bosses matches 1-solid+1-hole cadence.
    if (!kernelFuseSolids(solids, acc)) return false;
    if (op == "subtract" && !kernelCutHoles(acc, holes, acc)) return false;
    // Two-body Group (two solids, or one solid and one hole) stays as-is so a
    // cylinder-into-box does not hitch. Three or more operands unify leftover
    // faces so knurls match Split/print/export.
    const std::size_t busy = solids.size() + (op == "subtract" ? holes.size() : 0);
    if (busy >= 3) acc = kernelUnify(acc);
  } else if (op == "intersect") {
    std::vector<TopoDS_Shape> all = solids;
    all.insert(all.end(), holes.begin(), holes.end());
    if (all.size() < 2) return false;
    acc = all[0];
    for (size_t i = 1; i < all.size(); ++i) {
      BRepAlgoAPI_Common common(acc, all[i]);
      common.SetRunParallel(true);
      common.Build();
      if (!common.IsDone()) return false;
      acc = common.Shape();
    }
  } else {
    return false;
  }
  out = acc;
  return !out.IsNull();
}

bool collectSolids(const nlohmann::json& job, std::vector<TopoDS_Shape>& solids, std::vector<TopoDS_Shape>& holes) {
  if (!job.contains("solids") || !job["solids"].is_array()) return false;
  for (const auto& item : job["solids"]) {
    TopoDS_Shape shape;
    if (!buildKernelSolid(item, shape)) return false;
    if (item.value("hole", false)) holes.push_back(shape);
    else solids.push_back(shape);
  }
  return true;
}

} // namespace

nlohmann::json handleKernelJob(const nlohmann::json& job) {
  try {
    const std::string type = job.value("type", "");
    if (type == "ping") {
      return { { "ok", true }, { "native", true } };
    }
    if (type == "sketchExtrude") return handleSketchExtrude(job);
    if (type == "sketchSweep") return handleSketchSweep(job);
    if (type == "importStep") return handleImportStep(job);
    if (
      type == "prepare" || type == "preview" || type == "refine" || type == "finalize"
      || type == "dispose" || type == "warmup" || type == "hollow" || type == "previewThread"
      || type == "pushPull"
    ) {
      return handleModifierJob(job);
    }
    if (type == "split") return handleSplit(job);
    if (type == "printOverlay") return handlePrintOverlay(job);
    if (type == "measure") return handleMeasure(job);
    if (type == "boolean") {
      std::vector<TopoDS_Shape> solids;
      std::vector<TopoDS_Shape> holes;
      if (!collectSolids(job, solids, holes)) return kernelFail("native kernel could not build operands", true);
      TopoDS_Shape result;
      if (!booleanOp(job.value("op", "union"), solids, holes, result)) {
        return kernelFail("native boolean failed", true);
      }
      std::vector<double> positions;
      if (!kernelTessellate(result, positions)) return kernelFail("native tessellation failed", true);
      return {
        { "ok", true },
        { "positions", positions },
        { "brepStep", kernelExportStep(kernelRecenterToLocalMeshFrame(result), false) },
        { "quality", "exact" },
        { "displayEdges", nlohmann::json::array() },
      };
    }
    if (type == "exportStep") {
      std::vector<TopoDS_Shape> solids;
      std::vector<TopoDS_Shape> holes;
      if (!collectSolids(job, solids, holes)) return kernelFail("native kernel could not build export solids", true);
      BRep_Builder builder;
      TopoDS_Compound compound;
      builder.MakeCompound(compound);
      int exported = 0;
      for (auto part : solids) {
        TopoDS_Shape cut = part;
        if (!kernelCutHoles(part, holes, cut)) cut = part;
        builder.Add(compound, cut);
        exported += 1;
      }
      if (exported == 0) return kernelFail("No solid geometry to export as STEP", false);
      const std::string step = kernelExportStep(compound, true);
      if (step.empty()) return kernelFail("STEP export failed", true);
      return {
        { "ok", true },
        { "step", step },
        { "exportedCount", exported },
        { "exactCount", exported },
        { "facetedCount", 0 },
        { "skipped", nlohmann::json::array() },
        { "degraded", nlohmann::json::array() },
      };
    }
    return kernelFail("Unknown CAD kernel request", true);
  } catch (const Standard_Failure& error) {
    return kernelFail(error.what() ? error.what() : "OCCT failed", true);
  } catch (const std::exception& error) {
    return kernelFail(error.what(), true);
  } catch (...) {
    return kernelFail("native kernel aborted", true);
  }
}
