const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("peakcadDesktop", true);

contextBridge.exposeInMainWorld("peakcadModels", {
  session: () => ipcRenderer.invoke("peakcad:model-session"),
});

let saveBeforeCloseHandler = null;
let saveBeforeCloseToken = 0;

// Main always gets exactly one reply per request, so a window-close Save never waits forever.
ipcRenderer.on("peakcad:save-before-close", (_event, requestId) => {
  const handler = saveBeforeCloseHandler;
  const reply = (ok) => ipcRenderer.send("peakcad:save-before-close-result", requestId, ok === true);
  Promise.resolve()
    .then(() => (handler ? handler() : false))
    .then(reply, () => reply(false));
});

contextBridge.exposeInMainWorld("peakcadFile", {
  isDesktop: true,
  defaultDir: () => ipcRenderer.invoke("peakcad:file-default-dir"),
  open: () => ipcRenderer.invoke("peakcad:file-open"),
  read: (filePath) => ipcRenderer.invoke("peakcad:file-read", filePath),
  write: (payload) => ipcRenderer.invoke("peakcad:file-write", payload),
  saveAs: (payload) => ipcRenderer.invoke("peakcad:file-save-as", payload),
  writeNew: (payload) => ipcRenderer.invoke("peakcad:file-write-new", payload),
  resolveName: (defaultName) => ipcRenderer.invoke("peakcad:file-resolve-name", defaultName),
  transitionLegacy: (extraPaths) => ipcRenderer.invoke("peakcad:file-transition-legacy", extraPaths),
  pendingMoves: () => ipcRenderer.invoke("peakcad:file-pending-moves"),
  reveal: (filePath) => ipcRenderer.invoke("peakcad:file-reveal", filePath),
  onOpenPath: (listener) => {
    const wrapped = (_event, filePath) => listener(filePath);
    ipcRenderer.on("peakcad:open-path", wrapped);
    return () => ipcRenderer.removeListener("peakcad:open-path", wrapped);
  },
  onMenu: (listener) => {
    const wrapped = (_event, action) => listener(action);
    ipcRenderer.on("peakcad:menu", wrapped);
    return () => ipcRenderer.removeListener("peakcad:menu", wrapped);
  },
  onSaveBeforeClose: (handler) => {
    saveBeforeCloseToken += 1;
    const token = saveBeforeCloseToken;
    saveBeforeCloseHandler = handler;
    return () => {
      if (saveBeforeCloseToken === token) saveBeforeCloseHandler = null;
    };
  },
});

contextBridge.exposeInMainWorld("peakcadSlicer", {
  detect: () => ipcRenderer.invoke("peakcad:slicer-detect"),
  open: (payload) => ipcRenderer.invoke("peakcad:slicer-open", payload),
  choose: () => ipcRenderer.invoke("peakcad:slicer-choose"),
});

contextBridge.exposeInMainWorld("peakcadUpdate", {
  check: () => ipcRenderer.invoke("peakcad:update-check"),
  openDownload: () => ipcRenderer.invoke("peakcad:update-open"),
  install: () => ipcRenderer.invoke("peakcad:update-install"),
});

contextBridge.exposeInMainWorld("peakcadReport", {
  note: (message) => ipcRenderer.send("peakcad:crash-note", message),
  open: () => ipcRenderer.invoke("peakcad:report-problem"),
  feedback: () => ipcRenderer.invoke("peakcad:send-feedback"),
  text: () => ipcRenderer.invoke("peakcad:crash-text"),
});

contextBridge.exposeInMainWorld("peakcadKernel", {
  ready: () => ipcRenderer.invoke("peakcad:kernel-ready"),
  request: (job, timeoutMs) => ipcRenderer.invoke("peakcad:kernel-request", { job, timeoutMs }),
});
