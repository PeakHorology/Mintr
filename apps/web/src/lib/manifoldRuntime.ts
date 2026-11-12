import type { ManifoldToplevel } from "manifold-3d";

let manifoldRuntimePromise: Promise<ManifoldToplevel> | null = null;
let manifoldRuntimeLoaded: ManifoldToplevel | null = null;

/** The runtime if it has finished loading (the editor loads it when it opens), for work that cannot wait. */
export function manifoldRuntimeIfReady(): ManifoldToplevel | null {
  return manifoldRuntimeLoaded;
}

function manifoldAssetUrl(file: string) {
  if (typeof window === "undefined") {
    return `/${file}`;
  }
  return new URL(`/${file}`, window.location.origin).href;
}

/**
 * Load Manifold from public/manifold.js + manifold.wasm (copied by copy-occt-wasm.mjs).
 * Do not import the WASM as base64 into the editor chunk — that inflates every page load.
 */
export function getManifoldRuntime() {
  manifoldRuntimePromise ??= (async () => {
    const scriptUrl = manifoldAssetUrl("manifold.js");
    const module = (await import(/* webpackIgnore: true */ scriptUrl)) as {
      default: (config: { locateFile: (file: string) => string }) => Promise<ManifoldToplevel>;
    };
    const runtime = await module.default({
      locateFile: (file: string) => (
        file.endsWith(".wasm") ? manifoldAssetUrl("manifold.wasm") : manifoldAssetUrl(file)
      ),
    });
    runtime.setup();
    manifoldRuntimeLoaded = runtime;
    return runtime;
  })().catch((error: unknown) => {
    manifoldRuntimePromise = null;
    throw error;
  });
  return manifoldRuntimePromise;
}

export function clearManifoldRuntimeCache() {
  manifoldRuntimePromise = null;
  manifoldRuntimeLoaded = null;
}

export function resetManifoldRuntimeForTests() {
  clearManifoldRuntimeCache();
}
