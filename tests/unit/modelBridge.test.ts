import { describe, expect, it } from "vitest";
import { modelActionLabel, modelActionNeedsConsent } from "@/lib/modelBridge";

describe("model bridge consent", () => {
  it("lets a model look without asking, and asks before a change", () => {
    expect(modelActionNeedsConsent("get_scene")).toBe(false);
    expect(modelActionNeedsConsent("capture_image")).toBe(false);
    expect(modelActionNeedsConsent("select_objects")).toBe(false);
    expect(modelActionNeedsConsent("create_shape")).toBe(true);
    expect(modelActionNeedsConsent("hollow")).toBe(true);
    expect(modelActionNeedsConsent("export_step")).toBe(true);
    expect(modelActionNeedsConsent("tie_objects")).toBe(true);
    expect(modelActionLabel("group_objects")).toBe("Group objects into one solid");
    expect(modelActionLabel("lay_flat")).toBe("Lay a face on the workplane");
  });
});
