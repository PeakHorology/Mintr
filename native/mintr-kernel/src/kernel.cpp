#include "kernel.hpp"
#include "fillet.hpp"
#include "occtio.hpp"
#include "primitives.hpp"
#include "print.hpp"
#include "sketch.hpp"
#include "split.hpp"

#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRep_Builder.hxx>
#include <Standard_Failure.hxx>
#include <TopTools_ListOfShape.hxx>
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
    if (solids.size() > 1) {
      BRepAlgoAPI_Fuse fuse;
      TopTools_ListOfShape args;
      TopTools_ListOfShape tools;
      args.Append(solids[0]);
      for (size_t i = 1; i < solids.size(); ++i) tools.Append(solids[i]);
      fuse.SetArguments(args);
      fuse.SetTools(tools);
      fuse.SetRunParallel(true);
      fuse.SetFuzzyValue(0.04);
      fuse.Build();
      if (!fuse.IsDone()) return false;
      acc = fuse.Shape();
    }
    if (op == "subtract" && !holes.empty()) {
      BRepAlgoAPI_Cut cut;
      TopTools_ListOfShape args;
      TopTools_ListOfShape tools;
      args.Append(acc);
      for (const auto& hole : holes) tools.Append(hole);
      cut.SetArguments(args);
      cut.SetTools(tools);
      cut.SetRunParallel(true);
      cut.SetFuzzyValue(0.04);
      cut.Build();
      if (!cut.IsDone()) return false;
      acc = cut.Shape();
    }
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
  // Live Group returns the boolean as-is. UnifySameDomain on a cylinder-into-box
  // fuse walks the intersection curve and is the difference between tens of
  // milliseconds and a hitch; fillet/export still unify on their own paths.
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
        for (const auto& hole : holes) {
          BRepAlgoAPI_Cut cut(part, hole);
          cut.SetRunParallel(true);
          cut.Build();
          if (cut.IsDone()) part = cut.Shape();
        }
        builder.Add(compound, part);
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
