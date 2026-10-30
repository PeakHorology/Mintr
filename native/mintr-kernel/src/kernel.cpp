#include "kernel.hpp"
#include "fillet.hpp"
#include "occtio.hpp"
#include "primitives.hpp"
#include "print.hpp"
#include "recipe.hpp"
#include "sketch.hpp"
#include "split.hpp"

#include <BRepAlgoAPI_Common.hxx>
#include <BRep_Builder.hxx>
#include <Standard_Failure.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Shape.hxx>

#include <array>
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
      TopoDS_Shape shared;
      if (!kernelBoolean(KernelBooleanOp::Common, acc, all[i], shared)) return false;
      acc = shared;
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
    if (type == "buildRecipe") return handleBuildRecipe(job);
    if (type == "buildLoft") return handleBuildLoft(job);
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
      if (!kernelShapeIsValid(result)) {
        return kernelFail("native boolean produced an invalid solid", true);
      }
      nlohmann::json positions = nlohmann::json::array();
      nlohmann::json normals = nlohmann::json::array();
      nlohmann::json indices = nlohmann::json::array();
      const double angular = job.value("angularDeflection", 0.32);
      if (!kernelTessellateIndexed(result, positions, normals, indices, 0.12, angular)) {
        return kernelFail("native tessellation failed", true);
      }
      nlohmann::json displayEdges = nlohmann::json::array();
      try {
        displayEdges = kernelDisplayEdges(result);
      } catch (...) {
        displayEdges = nlohmann::json::array();
      }
      return {
        { "ok", true },
        { "positions", positions },
        { "normals", normals },
        { "indices", indices },
        { "brepStep", kernelExportStep(kernelRecenterToLocalMeshFrame(result), false) },
        { "quality", "exact" },
        { "displayEdges", displayEdges },
      };
    }
    if (type == "exportStep") {
      std::vector<TopoDS_Shape> solids;
      std::vector<std::string> names;
      std::vector<TopoDS_Shape> holes;
      for (const auto& item : job.value("solids", nlohmann::json::array())) {
        const std::string name = item.value("name", std::string("Part"));
        if (item.value("kind", "") == "group" && item.value("op", "") == "assemble" && !item.value("hole", false)) {
          // An assemble group at the top keeps its bodies apart in the file, as in the browser.
          if (!kernelGroupParts(item, solids)) return kernelFail("native kernel could not build export solids", true);
          names.resize(solids.size(), name);
          continue;
        }
        TopoDS_Shape shape;
        if (!buildKernelSolid(item, shape)) return kernelFail("native kernel could not build export solids", true);
        if (item.value("hole", false)) {
          holes.push_back(shape);
        } else {
          solids.push_back(shape);
          names.push_back(name);
        }
      }
      // Each hole is tried on its own, and only on parts its box reaches. One hole that
      // will not cut used to drop every cut on the part without a word; now the rest
      // still go in and the part is named in the warning, as the browser does.
      std::vector<std::array<double, 6>> holeBoxes;
      for (const auto& hole : holes) {
        std::array<double, 6> box{};
        if (!kernelBounds(hole, box[0], box[1], box[2], box[3], box[4], box[5])) box = { -1e300, -1e300, -1e300, 1e300, 1e300, 1e300 };
        holeBoxes.push_back(box);
      }
      BRep_Builder builder;
      TopoDS_Compound compound;
      builder.MakeCompound(compound);
      int exported = 0;
      nlohmann::json degraded = nlohmann::json::array();
      for (size_t index = 0; index < solids.size(); ++index) {
        TopoDS_Shape cut = solids[index];
        std::array<double, 6> partBox{};
        const bool bounded = kernelBounds(cut, partBox[0], partBox[1], partBox[2], partBox[3], partBox[4], partBox[5]);
        int missed = 0;
        for (size_t h = 0; h < holes.size(); ++h) {
          const auto& hb = holeBoxes[h];
          const double gap = 1e-6;
          if (bounded && (hb[0] > partBox[3] + gap || hb[3] < partBox[0] - gap
            || hb[1] > partBox[4] + gap || hb[4] < partBox[1] - gap
            || hb[2] > partBox[5] + gap || hb[5] < partBox[2] - gap)) continue;
          TopoDS_Shape next;
          if (kernelBoolean(KernelBooleanOp::Cut, cut, holes[h], next) && !next.IsNull()) cut = next;
          else missed += 1;
        }
        if (missed > 0) {
          degraded.push_back({
            { "name", index < names.size() ? names[index] : std::string("Part") },
            { "kind", "solid" },
            { "reason", missed == 1 ? "one hole could not be cut, so it is missing" : std::to_string(missed) + " holes could not be cut, so they are missing" },
          });
        }
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
        { "degraded", degraded },
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
