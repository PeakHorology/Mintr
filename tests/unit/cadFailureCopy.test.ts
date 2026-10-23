import { describe, expect, it } from "vitest";
import {
  CAD_ENGINE_FAIL_NOTICE,
  CAD_GROUP_FAIL_NOTICE,
  CAD_GROUP_MESH_NOTICE,
  CAD_HOLE_FAIL_NOTICE,
  cadFailureCopy,
} from "@/lib/cadFailureCopy";

describe("cadFailureCopy", () => {
  it("rewrites kernel and worker jargon into what to try next", () => {
    expect(cadFailureCopy("The CAD worker could not start", "engine")).toBe(CAD_ENGINE_FAIL_NOTICE);
    expect(cadFailureCopy("native fillet could not rebuild this solid", "fillet")).toMatch(/Group it first|smaller fillet/i);
    expect(cadFailureCopy("The CAD kernel returned an empty body", "fillet")).toMatch(/smaller radius/i);
    expect(cadFailureCopy("native boolean failed", "group")).toBe(CAD_GROUP_FAIL_NOTICE);
    expect(cadFailureCopy("Could not cut with this hole mesh")).toBe(CAD_HOLE_FAIL_NOTICE);
    expect(cadFailureCopy("Exact CAD boolean unavailable — used mesh Group. STEP for this solid may be faceted.")).toBe(CAD_GROUP_MESH_NOTICE);
  });

  it("keeps beginner-ready fillet and sweep lines", () => {
    expect(cadFailureCopy("That edge could not be rounded. Try a smaller radius or select fewer edges.", "fillet"))
      .toBe("That edge could not be rounded. Try a smaller radius or select fewer edges.");
    expect(cadFailureCopy("This path cuts through itself.", "sweep")).toBe("This path cuts through itself.");
  });

  it("keeps beginner Push Pull lines", () => {
    expect(cadFailureCopy("That push went through the part. Try a smaller distance.", "pushPull"))
      .toBe("That push went through the part. Try a smaller distance.");
    expect(cadFailureCopy("Push Pull needs a flat face.", "pushPull")).toBe("Push Pull needs a flat face.");
    expect(cadFailureCopy("Push Pull could not move this face. Try a smaller distance, or Group the parts again.", "pushPull"))
      .toBe("Push Pull could not move this face. Try a smaller distance, or Group the parts again.");
    expect(cadFailureCopy("BRepAlgoAPI_Cut failed on TopoDS", "pushPull")).toBe("That push went through the part. Try a smaller distance.");
    expect(cadFailureCopy("BRepAlgoAPI_Fuse failed on TopoDS", "pushPull"))
      .toBe("Push Pull could not move this face. Try a smaller distance, or Group the parts again.");
  });
});
