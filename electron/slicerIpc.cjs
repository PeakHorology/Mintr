const { dialog } = require("electron");
const { detectLaserApps, detectSlicers, identifyExe, openInLaserApp, openInSlicer } = require("./slicerCatalog.cjs");

function registerSlicerIpc(ipcMain, getWindow) {
  ipcMain.handle("peakcad:slicer-detect", () => detectSlicers());

  ipcMain.handle("peakcad:slicer-open", (_event, payload) => openInSlicer(payload));

  ipcMain.handle("peakcad:laser-detect", () => detectLaserApps());

  ipcMain.handle("peakcad:laser-open", (_event, payload) => openInLaserApp(payload));

  ipcMain.handle("peakcad:slicer-choose", async () => {
    const window = getWindow();
    const result = await dialog.showOpenDialog(window ?? undefined, {
      title: "Choose slicer",
      filters: [{ name: "Program", extensions: ["exe"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return identifyExe(result.filePaths[0]);
  });
}

module.exports = { registerSlicerIpc };
