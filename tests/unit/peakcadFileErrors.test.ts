import { describe, expect, it } from "vitest";
import { friendlyProjectFileError } from "@/lib/peakcadFile";

describe("friendlyProjectFileError", () => {
  it("strips Electron's remote-method prefix", () => {
    const error = friendlyProjectFileError(
      new Error("Error invoking remote method 'peakcad:file-write': Error: Mintr could not write the file."),
    );
    expect(error.message).toBe("Mintr could not write the file.");
  });

  it("explains a missing folder", () => {
    const error = friendlyProjectFileError(
      new Error("Error invoking remote method 'peakcad:file-write': Error: ENOENT: no such file or directory, open 'E:\\usb\\Plate.mintr'"),
    );
    expect(error.message).toMatch(/no longer there/i);
    expect(error.message).toMatch(/Save As/);
  });

  it("explains a locked file and a full drive", () => {
    expect(friendlyProjectFileError(new Error("EBUSY: resource busy or locked, rename")).message).toMatch(/locked or read-only/i);
    expect(friendlyProjectFileError(new Error("ENOSPC: no space left on device, write")).message).toMatch(/drive is full/i);
  });

  it("falls back to a generic message for empty errors", () => {
    expect(friendlyProjectFileError(undefined).message).toBe("Could not access the project file.");
    expect(friendlyProjectFileError("plain string").message).toBe("plain string");
  });
});
