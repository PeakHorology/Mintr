# Bring a design over from Tinkercad

Status: first version built 30 Oct 2026 (Send to Mintr bookmark, Ctrl+V, all basic shapes, groups, holes, bundles as Ties). Tested by the user in Chrome. Paraboloid, star and text are still left out.

## In short

You open one of your designs in Tinkercad, click a **Send to Mintr** bookmark, and the design
opens in Mintr with its shapes, groups, holes, colours and hidden parts kept. Boxes, cylinders,
cones, spheres, tubes and the other basic shapes arrive as real Mintr shapes you can resize;
anything else arrives as a mesh. Nothing is uploaded anywhere: the design goes straight from the
Tinkercad tab to the Mintr tab (or to a file for the desktop app).

Two honest caveats:

1. **Tinkercad has no public way to read a design.** The bookmark has to read the design out of
   Tinkercad's own web page. Nobody outside Autodesk documents how that page stores a design, so
   before we build anything, you run a two-minute **probe** on your own Tinkercad tab (section 3).
   It prints the *shape* of the data (key names, shape types, one sample), not your design, and
   we build from that. Tinkercad can change its page at any time, so this feature will need
   looking after.
2. **Undo history does not come over.** Tinkercad only exposes the current design. What Mintr
   can show is the design's *structure* as steps: every group lists its parts, in order, solid or
   hole, and you can edit, turn off or ungroup them. That is the "history" (section 6).

**Copy and paste.** Plain Ctrl+C in Tinkercad then Ctrl+V in Mintr most likely will *not* work
as it stands: Tinkercad's help says Copy puts the shape "in memory" (one selection at a time),
and it pastes between its own tabs in a way that looks like browser storage, not the system
clipboard. The probe settles that in ten seconds. What *is* feasible, and this plan makes it the
headline flow, is one click closer: select shapes in Tinkercad, click the **Copy for Mintr**
bookmark, then Ctrl+V in Mintr. It needs no new tab, no pop-up, works on the desktop app too,
and lets you drop part of a Tinkercad design into a design you already have in Mintr. Section 4.4.

Is there an easier way than that? Not one that keeps editable shapes and groups. Tinkercad's own
exports (STL/OBJ/GLTF) give meshes with holes already cut; Autodesk Fusion can receive a
Tinkercad design and export STEP, which Mintr opens as exact but un-editable solids. Section 8
compares every option.

---

## 0. Discovery results (30 Oct 2026, from the user's own Tinkercad tab)

The probes answered the main unknowns:

- **Copy is internal.** Tinkercad's Ctrl+C writes JSON to `localStorage["corelibClipboard"]` on
  tinkercad.com, not to the system clipboard. So the flow is Ctrl+C in Tinkercad, then the
  **Copy for Mintr** bookmark (it reads that key and writes it to the system clipboard with a
  Mintr prefix), then Ctrl+V in Mintr.
- **Clipboard format:** `[{ nodelist: Node[], nodeIDs, copiedBB, copiedWP, copiedRV }]`.
- **Live design:** `adsk.TinkercadApplication._editor3DContent._editor3D.root.objectMap._content`
  holds a document object with `rootNode`, `nodes`, `unit` ("mm"), `scale`, `workplaneMatrix`.
  Its members are wrapped: read `.value`. `rootNode.value.toJSON()` returns the whole tree in
  the **same Node format** as the clipboard, so whole-design import and paste share one mapper.
  The editor model has `zUp: true`.
- **Node:** `{ matrix: number[16] (column-major, local to parent), dataType, params, tags, children? }`
  - `dataType: "preset"`: a primitive. `params.id` is the kind (`box`: width/depth/height/radius/step;
    `cylinder`: radiusBottom/height/radialSegments/bevel/bevelSegments).
  - `dataType: "csg"`: a group, `params.groupType` (1 seen), `children`, tags `isAllHole`,
    `isMulticolor`, `isMixedOpacity`.
  - `tags.volumePolarity`: 1 solid, -1 hole. `tags.renderingMaterial.color`: 24-bit RGB int.
    `tags.label`: the shape's name.
  - Preset geometry is **Y-up** in its own frame: the matrix maps local Y (height) onto world Z.
    Non-uniform size lives in the matrix scale (a 10 mm × 21 mm cylinder hole was
    `radiusBottom: 10, height: 20` with scales 0.5 / 1.05 / 0.5).
- No geometry is stored in nodes: groups are evaluated by `csg-prd.tinkercad.com/evaluate`, so
  Mintr evaluates groups itself (`csg.dirty: true`).
- `root.undoStack` / `redoStack` exist in memory, but only for the current session; history
  still does not come over.

A real sample (box + cylinder hole in one group) is saved as the first test fixture.

## 1. Goal and what "as editable as possible" means in Mintr terms

| Want | Mintr model it maps to |
|---|---|
| Shape list and groups intact | One `WorkplaneShape` per Tinkercad shape; groups become shapes with `groupedShapes` + `csg` meta, nested as in Tinkercad |
| Holes stay holes | `hole: true` on the leaf (and on a group when Tinkercad flags the whole group as a hole) |
| Colours and hidden parts kept | `color`, `hidden`, `locked`; `solidColor` kept for holes |
| Basic shapes become real shapes | `kind: "box" | "cylinder" | "cone" | "sphere" | "tube" | ...` with `width/depth/height` and the kind's parameters (`sides`, `bevel`, `radius`, `topRadius`...) |
| Everything else as a mesh | `kind: "mesh"` with `importedMesh` (`sourceFormat: "json"`) |
| Ungroup works | Children stored in the group's local frame the way `buildGroupedShapeFromSelection` does (`cloneAsGroupChild`), so `ungroupSelected` → `pickGroupToUngroup` → `groupPointToWorld` just works |

Relevant code: `apps/web/src/types/sketchforge.ts` (model), `apps/web/src/lib/shapeCatalog.ts`
(`sceneShape` is the right constructor: it spreads unknown fields and canonicalises),
`apps/web/src/lib/editorBoolean.ts` (`buildGroupedShapeFromSelection`,
`remeshCsgGroupFromWorldChildren`, `groupPointToWorld`), `apps/web/src/lib/csgTree.ts`
(`withCsgMeta`, `inferCsgOp`, `viewportGroupChildren`, `pickGroupToUngroup`),
`apps/web/src/lib/introProject.ts` (`createIntroShapes` is a tiny worked example of a hand-built
subtract group: box + cylinder hole, `csg.dirty: true` so Mintr evaluates it itself).

## 2. What is publicly known about Tinkercad's data, and what is not

### Known (from Tinkercad's UI, blog and public material)

- **Model.** Constructive solid geometry: every shape is *solid* or *hole*; a hole does nothing
  until it is grouped with solids. Groups nest. "Bundle groups" (2025) hold any shapes including
  holes and other bundles without fusing them. Groups can be one colour or **multicolour** (each
  part keeps its colour).
- **Units and axes.** Millimetres (inches are a display choice). The workplane is **Z = 0 and Z is
  up**; X runs right, Y runs away from you. Shapes can sit below the workplane.
- **Primitive parameters shown in the Shape inspector** (these are the editable numbers we want
  to carry over): Box: *radius, steps*; Cylinder: *sides, bevel, segments*; Cone: *top radius,
  base radius, sides*; Sphere: *steps*; Tube: *radius, wall thickness, sides, bevel, segments*;
  Torus: *radius, tube, sides, steps*; Polygon: *sides*; Pyramid: *sides*; Round Roof: *steps*;
  Half Sphere: *steps*; Paraboloid: *sides, steps*; Text: *text, font, bevel, segments*; Roof and
  Wedge have no extra numbers. Size, position, rotation, mirror, colour, hole, hidden and locked
  are common to all.
- **Exports.** STL, OBJ (a zip with `tinker.obj` + `obj.mtl`, per-object colours), GLTF/GLB and
  SVG from the Export menu, plus "Send to Fusion". Since the September 2025 export update,
  ungrouped shapes stay separate objects in the export rather than being unioned; holes are
  applied. Multicolour is carried by OBJ+MTL (slicers read it).
- **Geometry is computed server-side.** Tinkercad's 2012 Shape Scripts announcement said scripts
  ran on its "Gen6 geometry kernel" server cluster, and today `api.tinkercad.com` serves a TLS
  certificate whose names include `csg.tinkercad.com` and `service-csg-alb…`: a CSG service.
  So the page most likely sends the shape tree to a service and receives tessellated meshes for
  groups and shapes. That matches the SimpCAD X note that "groups come with their finished shape".
- **No public API** for reading 3D designs. The old JavaScript shape-generator API was removed;
  Codeblocks replaced it. Share links and embeds exist only for designs the owner makes public.
- **Copy/paste across tabs** works inside Tinkercad (Ctrl+C in one design, Ctrl+V in another).
  Whether that uses the system clipboard with a readable text payload is **not documented**.

### Unknown (the probe answers these)

| Question | Why it matters |
|---|---|
| Where the live design object lives in the page (a global? a framework store? closure-only?) | Whether a bookmarklet can reach it at all without hooking module internals |
| Key names: shape type, size/scale, transform (matrix or position + Euler?), hole flag, colour, hidden, locked, name, group children | The whole mapping layer |
| Whether each *leaf* shape has its own tessellation in memory, or only groups do | Mesh fallback for non-primitives; Ungroup of a mesh-heavy group |
| How a group's own transform, colour and multicolour flag are stored | Group frames and colours |
| The URL and format of the design JSON the editor loads (visible in resource timing) | Fallback: the bookmarklet can `fetch` it same-origin with the user's cookies, nothing leaves the tab |
| Tinkercad's own COOP and CSP | Whether `window.opener` survives to our tab; whether bookmarklets run at all |
| The copy/paste payload | If it is text JSON, Mintr can accept a paste directly: the simplest possible UX |

We cannot log into your account, and we must not. The probe runs on *your* tab, reads memory
only, makes no network request, and copies a report to your clipboard for you to paste to us.

## 3. Discovery step: the read-only probe

### What you do

1. Open one of your designs in Tinkercad's 3D editor (a design with a box, a cylinder hole,
   one group and one coloured part is ideal). Let it finish loading.
2. Press **F12** (DevTools) → **Console** tab. Paste the snippet below, press Enter.
   On a phone or Chromebook without DevTools: make a bookmark whose address is
   `javascript:` followed by the snippet on one line, then tap it on the design page.
3. A box appears in the page with the report; it is also copied to your clipboard. Paste it to
   us. It contains key names, shape types, counts, URL *patterns* and one shape sample with
   strings cut to 24 characters. It does not contain your design.
4. Clipboard test (10 seconds, please do this one): click a plain box in Tinkercad, press
   Ctrl+C, open Notepad and press Ctrl+V. If text appears, paste that too (one box, nothing
   private). Then run the clipboard probe (after the main probe below) in the same Console. It reports which browser
   storage keys changed when you copied, and which clipboard types the browser will show the
   page. If Notepad stays empty and a storage key changed, Tinkercad's copy is internal, and
   the plan's "Copy for Mintr" bookmark is the way (section 4.4).

### The probe

```js
(() => {
  const T0 = performance.now(), BUDGET_MS = 4000, MAX_NODES = 300000;
  const R = { probe: 1, when: new Date().toISOString(), ua: navigator.userAgent,
    page: { path: location.pathname.replace(/\/[A-Za-z0-9_-]{6,}/g, "/{id}"),
      crossOriginIsolated: self.crossOriginIsolated, iframes: document.querySelectorAll("iframe").length,
      canvases: document.querySelectorAll("canvas").length,
      cspMeta: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
      webgl: (() => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } })() },
    globals: [], roots: [], shapeCandidates: 0, typeValues: {}, meshLikeObjects: 0,
    sample: null, parentSample: null, resources: [], storage: {}, note: "" };

  // 1. Globals this page added (names only).
  try {
    const f = document.createElement("iframe"); f.style.display = "none"; document.body.appendChild(f);
    const base = new Set(Object.getOwnPropertyNames(f.contentWindow)); f.remove();
    R.globals = Object.getOwnPropertyNames(window).filter((k) => !base.has(k) && !/^(webkit|on)/.test(k)).slice(0, 200);
  } catch (e) { R.note += "globals: " + e.message + "; "; }

  // 2. Deep scan for shape-like objects. Values are summarised, never copied whole.
  const HOLE = /^(hole|isHole|solid|isSolid|holeMode|shapeType|material)$/i;
  const COLOR = /colou?r/i, XFORM = /^(matrix|transform|position|pos|rotation|rot|size|scale|dims?|dimensions|bbox|bounds)$/i;
  const TYPE = /^(type|kind|shape|shapeType|name|id|__type|typeName|generator|__class)$/i;
  const seen = new WeakSet(); let nodes = 0;
  const summarise = (v, depth) => {
    if (v === null || v === undefined) return v;
    const t = typeof v;
    if (t === "number" || t === "boolean") return v;
    if (t === "string") return v.length > 24 ? v.slice(0, 24) + "…(" + v.length + ")" : v;
    if (t === "function") return "ƒ";
    if (ArrayBuffer.isView(v)) return v.constructor.name + "[" + v.length + "]";
    if (Array.isArray(v)) return depth > 0 && v.length ? ["len " + v.length, summarise(v[0], depth - 1)] : "[" + v.length + "]";
    if (v instanceof Node) return "<" + v.nodeName + ">";
    if (depth <= 0) return "{" + Object.keys(v).slice(0, 12).join(",") + "}";
    const o = {}; for (const k of Object.keys(v).slice(0, 40)) { try { o[k] = summarise(v[k], depth - 1); } catch { o[k] = "!"; } } return o;
  };
  const isShapeLike = (o, keys) => keys.some((k) => HOLE.test(k)) && (keys.some((k) => COLOR.test(k)) || keys.some((k) => XFORM.test(k)));
  const walk = (v, path, depth) => {
    if (nodes++ > MAX_NODES || performance.now() - T0 > BUDGET_MS) return;
    if (!v || typeof v !== "object" || seen.has(v) || v instanceof Node || v === window) return;
    seen.add(v);
    if (ArrayBuffer.isView(v)) { if (v.length >= 9 && (v instanceof Float32Array || v instanceof Float64Array)) R.meshLikeObjects++; return; }
    let keys; try { keys = Object.keys(v); } catch { return; }
    if (!Array.isArray(v) && isShapeLike(v, keys)) {
      R.shapeCandidates++;
      for (const k of keys) if (TYPE.test(k) && (typeof v[k] === "string" || typeof v[k] === "number")) {
        const tv = String(v[k]).slice(0, 32); R.typeValues[tv] = (R.typeValues[tv] || 0) + 1;
      }
      if (!R.sample) R.sample = { path, keys, value: summarise(v, 2) };
    }
    if (Array.isArray(v) && v.length && v[0] && typeof v[0] === "object" && !ArrayBuffer.isView(v[0])) {
      let ck; try { ck = Object.keys(v[0]); } catch { ck = []; }
      if (isShapeLike(v[0], ck) && R.roots.length < 20) {
        R.roots.push({ path, count: v.length });
        if (!R.parentSample && path.includes(".")) R.parentSample = path;
      }
    }
    if (depth <= 0) return;
    for (const k of keys) {
      if (k === "parent" || k === "owner" || k === "_owner" || k === "window" || k === "document") continue;
      let c; try { c = v[k]; } catch { continue; }
      if (c && typeof c === "object") walk(c, path + "." + k, depth - 1);
    }
  };
  try {
    for (const g of R.globals) { try { walk(window[g], g, 14); } catch {} }
    // Framework roots: React fibers / other stores hung on DOM nodes.
    for (const el of document.querySelectorAll("body, body > *, canvas")) {
      for (const k of Object.keys(el)) if (/^__/.test(k)) { try { walk(el[k], "<" + el.tagName + ">." + k, 12); } catch {} }
    }
  } catch (e) { R.note += "scan: " + e.message + "; "; }
  R.scan = { nodes, ms: Math.round(performance.now() - T0), hitBudget: nodes > MAX_NODES || performance.now() - T0 > BUDGET_MS };

  // 3. Which Tinkercad/Autodesk resources the page loaded (URL patterns and sizes, no bodies).
  try {
    R.resources = performance.getEntriesByType("resource")
      .filter((r) => /tinkercad|autodesk/i.test(r.name) && !/\.(png|jpe?g|svg|woff2?|css|gif|ico)(\?|$)/i.test(r.name))
      .map((r) => ({ url: r.name.replace(/^https?:\/\//, "").replace(/[A-Za-z0-9_-]{10,}/g, "{id}").split("?")[0], via: r.initiatorType, kb: Math.round((r.decodedBodySize || r.transferSize || 0) / 1024) }))
      .sort((a, b) => b.kb - a.kb).slice(0, 60);
  } catch (e) { R.note += "resources: " + e.message + "; "; }

  // 4. Storage names only.
  try { R.storage.localStorageKeys = Object.keys(localStorage).slice(0, 60); } catch {}
  const finish = () => {
    const text = JSON.stringify(R, null, 1);
    try { console.log("MINTR PROBE REPORT\n" + text); } catch {}
    try { navigator.clipboard && navigator.clipboard.writeText(text); } catch {}
    const box = document.createElement("textarea");
    box.value = text; box.readOnly = true;
    box.style.cssText = "position:fixed;left:8px;top:8px;width:min(720px,90vw);height:70vh;z-index:2147483647;font:11px monospace;background:#fff;color:#000;border:2px solid #0a7;padding:8px";
    box.title = "Mintr probe report. Copied to the clipboard. Click to select all; press Esc to close.";
    box.onclick = () => box.select(); box.onkeydown = (e) => { if (e.key === "Escape") box.remove(); };
    document.body.appendChild(box); box.focus(); box.select();
  };
  if (indexedDB.databases) indexedDB.databases().then((d) => { R.storage.indexedDb = d.map((x) => x.name); }).catch(() => {}).finally(finish);
  else finish();
})();
```

Notes on the probe:

- It never calls `fetch`, never writes, never touches Tinkercad's objects (it only reads keys and
  summarises values). It stops after 4 seconds or 300k objects, whichever first.
- `shapeCandidates`, `typeValues`, `roots` and `sample` are what we are after. If
  `shapeCandidates` is 0 the design is held in module closures; the next move is the
  `resources` list: the design JSON URL and the CSG service calls show there, and a second probe
  can be written against that.
- Run it soon after the page loads: the browser keeps only the first ~250 resource entries.
- If you connect Claude to Chrome (the Claude-in-Chrome extension), we can run the probe in your
  own logged-in tab for you and read the report ourselves. It still uses only your session.

### The clipboard probe (run after the Ctrl+C)

```js
(async () => {
  const R = { clipboardProbe: 1, storageKeys: {}, clipboardTypes: null, textHead: null, note: "" };
  // Which localStorage keys look like a copy buffer: name + size + a 24-char head. No full values.
  try {
    for (const k of Object.keys(localStorage)) {
      const v = localStorage.getItem(k) || "";
      if (/clip|copy|paste|buffer|selection/i.test(k) || v.length > 2000) R.storageKeys[k] = { bytes: v.length, head: v.slice(0, 24) };
    }
  } catch (e) { R.note += "localStorage: " + e.message + "; "; }
  try { if (indexedDB.databases) R.indexedDb = (await indexedDB.databases()).map((d) => d.name); } catch {}
  // What the system clipboard holds (the browser may ask permission; that is expected).
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      R.clipboardTypes = items.flatMap((i) => i.types);
      const t = items.find((i) => i.types.includes("text/plain"));
      if (t) R.textHead = (await (await t.getType("text/plain")).text()).slice(0, 200);
    } else if (navigator.clipboard && navigator.clipboard.readText) {
      R.textHead = (await navigator.clipboard.readText()).slice(0, 200); R.clipboardTypes = ["text/plain?"];
    }
  } catch (e) { R.note += "clipboard: " + e.message + "; "; }
  const text = JSON.stringify(R, null, 1);
  console.log("MINTR CLIPBOARD PROBE\n" + text);
  try { await navigator.clipboard.writeText(text); } catch {}
  alert(text.length > 1500 ? text.slice(0, 1500) + "…(copied in full)" : text);
})();
```

**Can the probe be skipped?** Only by building blind. The alternative is to ship a bookmark that
tries several guesses and shows this same report when all of them fail, which is the probe with
an extra release cycle in front of it. Two minutes now saves a week of guessing.

## 4. Getting the design from the Tinkercad tab into Mintr

### 4.1 Do we need COOP/COEP at all?

`apps/web/public/_headers` sets `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: credentialless` on every path; `electron/desktopMain.cjs` and the
dev `next.config.ts` send the same. The stated reason is SharedArrayBuffer for threaded WASM, but:

- `native/mintr-kernel/CMakeLists.txt` builds the WASM kernel **without** pthreads
  (`-sENVIRONMENT=worker,node`, `ALLOW_MEMORY_GROWTH`, no `-pthread`/`USE_PTHREADS`).
- Nothing in `apps/web/src` references `SharedArrayBuffer` or `crossOriginIsolated` (the only
  hit is the comment in `desktopMain.cjs`).

So the headers are not needed today. They do no harm for the editor, and we may want threads
later, so the plan is: **keep them on the app, remove them on one receive path.** Cloudflare
Pages `_headers` can detach a header set by a broader rule with a `!` line:

```
/receive/*
  ! Cross-Origin-Opener-Policy
  ! Cross-Origin-Embedder-Policy
```

(Netlify's `_headers` has no detach syntax; if the site ever moves there, drop COOP globally
instead. `docs/WEB-VERSION.md` should gain a line about this.)

COOP recap: when a tinkercad.com page opens an app.mintr3d.com page whose COOP is `same-origin`,
the browser puts the new tab in its own browsing-context group, `window.opener` is `null` and
the opener's handle reports `closed === true`. Removing COOP on `/receive/` keeps the link, *as
long as Tinkercad itself does not send `COOP: same-origin`*. We cannot see Tinkercad's headers
from JavaScript, but the bookmarklet can test it live: open `/receive/`, wait for its "ready"
message, and if none arrives in four seconds fall back (below).

### 4.2 Web: three carriers, chosen by size

| Carrier | How | Limit | When |
|---|---|---|---|
| **URL fragment** | `https://app.mintr3d.com/?import=tinkercad#d=<base64url(deflate(JSON))>` opened in a new tab. The fragment never reaches the server or the logs; Mintr reads `location.hash`, decompresses with `DecompressionStream("deflate-raw")`, then `history.replaceState` to clear it. | Keep the whole URL under ~600 KB after base64 (Firefox's URL limit is 1 MB; Chrome's 2 MB). A 500-shape primitive-only design is ~100 KB raw, ~15 KB deflated. | Default for primitive-only designs and small meshes. Works even if COOP severs the link, no handshake, one tab. |
| **postMessage handshake** | Bookmarklet opens `/receive/`; the page posts `{type:"mintr-ready"}` to `window.opener` with target origin `https://www.tinkercad.com`; the bookmarklet replies with the payload (structured clone, so no base64) to target origin `https://app.mintr3d.com`; `/receive/` validates `event.origin`, writes the payload to IndexedDB (`mintr-handoff`, same origin as the app, COOP does not matter), then `location.replace("/?import=tinkercad&handoff=<id>")`. | Structured clone handles tens of MB comfortably. Cap at 200 MB; Mintr's own project limit is 512 MB (`PEAKCAD_MAX_BYTES`). | Designs with meshes. |
| **File download** | Bookmarklet builds a Blob `Design name.tinkercad.json` and clicks a temporary `<a download>`. The user drags it onto Mintr or uses Import…. | None that matters. | Pop-up blocked and no gesture left; handshake timed out; **always** in desktop mode. |

Order of attempts: if the compressed payload fits the fragment, use the fragment. Otherwise open
`/receive/` and wait for ready; on timeout show a small in-page bar in Tinkercad with two buttons,
**Open Mintr** (a fresh click is a user gesture, so the pop-up is allowed) and **Save file
instead**. This mirrors SimpCAD X's behaviour without copying anything of theirs.

The bookmarklet stays dumb on purpose: find the design, serialise it, send it. All mapping lives
in Mintr where it is typed, versioned and unit-tested. The bookmarklet carries
`{ source: "tinkercad", bookmarklet: 1, url: <design id only>, design: <raw Tinkercad object> }`
so an old bookmark still works with a newer Mintr.

Security: the receive side treats the payload as untrusted data: origin check, size cap, schema
check in `tinkercadImport.ts`, no `eval`, strings length-capped, numbers finite-checked, colours
re-parsed. Nothing is stored until the user sees "Brought over from Tinkercad" and the project is
created like any other.

Where it lands: a new project in the browser's project store (`saveStoredProject` in
`apps/web/src/lib/projectStoreClient.ts`), named after the Tinkercad design, then the editor
opens it (`page.tsx` already reads `?editor=1&project=<id>`; `?import=tinkercad` joins that
startup branch at the `useEffect` around line 1324). Web storage note: designs live in this
browser; `docs/WEB-VERSION.md` already says so and the first-visit note covers Save as….

### 4.3 Desktop (Electron)

- The desktop app cannot be a `window.open` target. Two routes:
  1. **File.** The bookmark, switched to "I use the Mintr app" (a checkbox under the bookmark in
     Mintr's Import panel changes the bookmark's address to carry `m=file`), saves
     `Design.tinkercad.json`. Phase 1: Import… and drag-and-drop accept it (the editor's
     `selectFile` in `SketchForgeEditor.tsx` adds a `.json` branch that sniffs for
     `"source":"tinkercad"`). Phase 3: the bookmark saves a real `.mintr` wrapper document
     (`{ format: "peakcad", version: 1, importSource: { kind: "tinkercad", design } }`), which
     the existing `.mintr` file association opens by double-click and `hydrate` converts on
     load. Double extensions like `.tinkercad.json` cannot be associated on Windows without
     hijacking `.json`, so the wrapper is the clean way.
  2. **`mintr://` protocol.** Register with `app.setAsDefaultProtocolClient("mintr")` plus
     electron-builder `protocols` in `package.json` (next to `fileAssociations`), handle it in
     `second-instance` argv (Windows, like `findPeakcadArg`) and `open-url` (macOS). Windows
     caps a command line at 32,767 characters, so this can only carry a *tiny* design or a
     pointer, not a mesh. Useful later as a "wake the app and open the file I just saved" nudge;
     not a data carrier.
- Electron's `MAX_BYTES` in `electron/peakcadPath.cjs` and `writeTextFile` already guard size.

### 4.4 Copy and paste (first-class)

**What Tinkercad does on Ctrl+C, as far as is public.** Tinkercad's help centre describes Copy
as putting the selected shape "in memory", one selection at a time, and its blog says you can
copy in one design's tab and paste in another. Nothing published says whether that memory is the
system clipboard. Two things point to an internal buffer: pasting between tabs works in every
browser, including ones (Firefox, Safari) that do not let a page read the system clipboard
silently; and a canvas app that pastes on Ctrl+V can do so from its own storage without any
permission prompt. So the working assumption is **a buffer in tinkercad.com's localStorage or
IndexedDB, shared by its tabs**, possibly with a text copy on the system clipboard as well. The
clipboard probe (section 3) tells us which.

Three outcomes, and what each gives:

| Probe finds | Flow for the user | What Mintr does |
|---|---|---|
| **Text or JSON on the system clipboard** | Ctrl+C in Tinkercad, Ctrl+V in Mintr. Done. | Paste handler sniffs the payload, runs the same mapper, pastes the shapes into the current design. |
| **A custom clipboard type** (e.g. `web application/x-tinkercad`) | Same. | Web: a DOM `paste` listener reads `clipboardData.getData(type)`; custom web types written with the async API are readable cross-origin in Chromium. Electron: `clipboard.availableFormats()` + `clipboard.readBuffer(format)` in the main process read any format. |
| **Internal only** (storage key changes, system clipboard empty): the likely case | Select shapes in Tinkercad, click **Copy for Mintr** (bookmark), Ctrl+V in Mintr. | The bookmark reads the selection (or the whole design when nothing is selected) from the page, or reads Tinkercad's own copy buffer from its storage (same origin, already serialised), and writes `TINKERCAD/1\n{…}` to the system clipboard with `navigator.clipboard.writeText` (allowed: the bookmark click is a user gesture). Mintr's paste sees the prefix and maps it. |

Why this deserves first place even though it is a bookmark too:

- No new tab, no pop-up blocker, no COOP, no handshake, no file. One click and Ctrl+V.
- Works identically on the web and in the desktop app (the Electron renderer gets the same
  `paste` event; Windows and macOS clipboards carry many MB of text).
- Pastes *into* the design you are working on, so you can pull one mechanism out of an old
  Tinkercad project rather than only whole designs. "Bring the whole design over" is then just
  "paste into a new design", or the same bookmark's Send mode (4.2) when a new project is wanted.
- Mintr already has the plumbing: `shapeClipboard.ts` prefixes its own system-clipboard text
  with `SKETCHFORGE3D/1\n` and `pasteShape` → `readShapeClipboard` reads it. A second prefix and a
  branch to `tinkercadImport.ts` is the whole change on the read side.

How Mintr reads it:

- **Web.** Today `readShapeClipboard` uses `navigator.clipboard.readText()`, which prompts for
  permission in Chrome and shows Firefox's paste bubble. Add a `document` `paste` event listener
  (editor focused, no text field active) that reads `event.clipboardData.getData("text/plain")`:
  no permission prompt, works in every browser, and is the standard way for cross-origin paste.
  Keep `readText` for the toolbar Paste button, which has no event.
- **Desktop.** Same DOM event. For diagnostics, a `peakcadClipboard.formats()` IPC can list
  `clipboard.availableFormats()` so a user's report shows what Tinkercad put there.
- **Size.** Chromium accepts clipboard text of tens of MB; the bookmark compresses nothing (the
  clipboard is not a URL), so meshes ride along as indexed, rounded triangles. Above ~50 MB fall
  back to the Send/file flows with a notice.

Limits to be honest about: Tinkercad's storage buffer, if that is what it is, holds only the
last thing copied, so the bookmark prefers the live selection from the page's data model (which
the main probe locates) and falls back to that buffer. If neither the selection nor the buffer
can be reached, the bookmark copies the whole design and Mintr offers "paste everything" or
"pick the groups to paste" from a small list.

### 4.5 Size limits for big designs

- Primitives are ~200 bytes each as JSON; 5,000 shapes ≈ 1 MB raw, ~150 KB deflated: fragment.
- Meshes: send **indexed** triangles (`positions` + `indices`), Float32, coordinates rounded to
  0.001 mm, per leaf. A 100k-triangle part is ~1.5 MB; `importedMesh.indices` is already
  supported. Over ~2 M triangles in one design, show the notice Mintr uses for heavy imports and
  keep going. Groups' finished meshes are taken from Tinkercad as the display cache (see 5.5) so
  nothing is recomputed up front.
- Bookmarklet itself: keep under ~8 KB minified; Chrome and Firefox have no practical bookmark
  size limit, Safari is fine to ~64 KB.

## 5. Mapping Tinkercad → Mintr

### 5.1 Coordinates

| | Tinkercad | Mintr |
|---|---|---|
| Units | mm | mm |
| Up | **Z** | **Y** (three.js) |
| Workplane | Z = 0 | Y = 0 |
| Axis map | (x, y, z) | (x, z, −y): x stays, Tinkercad z → Mintr y, Tinkercad y → Mintr −z. Right-handed, so no winding flips. |
| Position | Probably a 4×4 matrix or centre + Euler (probe) | `x`, `z` = footprint centre; `elevation` = bottom (may be negative: parts below the workplane stay there, exactly) |
| Rotation | Degrees about X/Y/Z | `rotationX`, `rotation` (yaw, Y), `rotationZ` in degrees, applied as three.js Euler order `"XYZ"` (`transformMesh` in `editorShapeMesh.ts`) |
| Mirror | A negative-scale axis | `mirrorX/Y/Z` flags |
| Size | Unit primitive × scale | `width` (X), `depth` (Z), `height` (Y) in mm; `size = max(width, depth)` |

Procedure per leaf: take Tinkercad's local-to-world matrix, re-express it in Mintr's axes
(conjugate by the axis-swap matrix), split into scale × rotation (polar decomposition is
overkill: column lengths give scale, signs give mirror, the normalised 3×3 goes to
`THREE.Euler.setFromRotationMatrix(m, "XYZ")`). Then `width/depth/height` = base size × scale,
`x/z` = world centre of the local box, `elevation` = world Y of the bottom. Do **not** round to
the grid. The accuracy test is: `transformMesh(meshForShape(mintrShape), mintrShape)` must match
the Tinkercad vertices within 0.001 mm for every primitive in the fixture.

### 5.2 Primitive table

Tinkercad shape → Mintr `kind` and parameters. Parameters not in the first column come from the
common transform above. "Mesh" means `kind: "mesh"` with `importedMesh` from the shape's own
tessellation when the page has one (otherwise the parent group's mesh carries it, see 5.5).

| Tinkercad | Mintr `kind` | Parameters | Notes |
|---|---|---|---|
| Box (radius 0) | `box` | `radius: 0` | |
| Box (radius > 0, steps) | `box` | `radius`, `steps` | Mintr's rounded box rounds all edges; Tinkercad's rounds all edges too. Check the fixture; mesh if it differs visibly. |
| Cylinder | `cylinder` | `sides`, `bevel`, `segments` | Elliptical allowed (`width ≠ depth`). Mintr defaults `bevel: 0, segments: 1`. |
| Cone | `cone` | `topRadius`, `baseRadius`, `sides`; set `coneFreeRange: true` when the scale is non-uniform | Mintr's `width/depth` is the base diameter; `coneUnitTopScale` derives from the two radii. |
| Sphere | `sphere` | `steps` | Ellipsoid via `width/depth/height`. |
| Half Sphere | `halfSphere` | `steps` | |
| Tube | `tube` | `bevel` = **wall thickness** (Mintr's `tube`/`ring` reuse the `bevel` field as wall thickness: `createBooleanHollowCylinderGeometry(width, height, depth, shape.bevel ?? 4)`), `sides` | Tinkercad's own tube *bevel* (edge rounding) has no Mintr equivalent: mesh fallback when it is non-zero, or import flat and tell the user. Decide after the fixture. |
| Torus | `torus` | `radius` = tube radius; `width/depth` = overall diameter; `steps`, `sides` | |
| Polygon | `polygon` | `sides` | |
| Pyramid | `pyramid` | `sides` (4) | |
| Roof | `roof` | `leftAngle`/`rightAngle` from the profile | Ridge axis may need `rotation ± 90`; the fixture decides. |
| Round Roof | `roundRoof` | `steps → sides` | Same ridge-axis check. |
| Wedge | `wedge` | | Mintr's wedge slopes up toward +X; map the orientation. |
| Text | `text` | `text`, `font` (nearest Mintr font), `bevel`, `segments` | Keep editable; fonts differ, so the shape may change slightly. Offer "keep exact" = mesh. |
| Paraboloid, Diamond, Heart, Star, Scribble, dice, letters, community/generator shapes, Codeblocks parts, imported STL/OBJ/SVG | `mesh` | `importedMesh` (`sourceFormat: "json"`) | Keeps colour, hole flag, transform; not resizable parametrically (Mintr scales the mesh). |
| Hole version of any shape | same kind | `hole: true`, `color` kept in `solidColor` | |
| Hidden / locked | same | `hidden: true` / `locked: true` | |

Everything is built through `sceneShape({...})` so canonicalisation, ids (`createLocalId`),
defaults and `catalogSidesForKind` tessellation densities behave exactly like a shape dragged from
the palette.

### 5.3 Colours

Tinkercad colours arrive as hex or RGB (probe). Mintr `color` is a CSS hex string. A hole's
colour goes to `solidColor` so "make solid again" restores it. Tinkercad's hole rendering colour
is not a user colour and is ignored.

### 5.4 Groups, nested groups, holes

A Tinkercad group becomes a Mintr group shape:

```ts
withCsgMeta(sceneShape({
  kind: "mesh", name, color, hole: groupIsHole,
  x, z, elevation, width, depth, height,            // the group's world box
  groupedBaseWidth/Depth/Height,                     // same, so later scaling works
  groupedShapes: children.map(toGroupLocalFrame),   // like cloneAsGroupChild: relative to group centre/bottom
  importedMesh: tinkercadGroupMesh ?? undefined,     // display cache, see 5.5
}), op, 1, /* dirty */ !tinkercadGroupMesh)
```

- `op` is `"subtract"` if any direct child is a hole, else `"union"`, following
  `buildGroupedShapeFromSelection` and `inferCsgOp`. Bundle groups (nothing fused) become
  `"assemble"`, which keeps every child live with its own colour.
- **Each part keeps its own solid/hole flag**, including a group inside a group. A hole-flagged
  group cuts its parent; inside it, its own children still union/subtract among themselves. This
  is the pitfall SimpCAD fixed as "groups of holes no longer cut away too much": never inherit
  the hole flag downward.
- Children are stored in the **group's local frame**: positions relative to the group's centre
  and bottom, rotations unchanged (Mintr groups are axis-aligned boxes; a rotated Tinkercad group
  is flattened into its children's world transforms first, then boxed). Ungroup then uses
  `groupPointToWorld` unchanged.
- Nesting depth is preserved one level per Tinkercad group so Ungroup peels one level at a time,
  as Mintr does for its own groups.

### 5.5 Speed on big designs

Tinkercad already holds every group's finished mesh (server CSG). Use it:

- Top-level groups: `importedMesh` = Tinkercad's mesh, `csg.dirty: false`. The design draws in
  one frame, no boolean work.
- Nested groups: `csg.dirty: true`, evaluated by Mintr's existing background remesh
  (`remeshCsgGroupFromWorldChildren`) only when the user ungroups or edits into them. Mintr's
  mesh is what gets exported, so the Tinkercad display mesh is never the final geometry.
- If the page holds no group mesh, mark the whole tree dirty and let the kernel build it; still
  correct, just slower on first open.

### 5.6 Multicolour groups

Mintr's fused groups are one colour; its `"assemble"` groups keep per-child colours but do not
cut holes. Mapping:

- Multicolour group **without holes** → `"assemble"` (exact: colours kept, nothing lost).
- Multicolour group **with holes** → one `"assemble"` whose children are *per-colour subtract
  groups*: solids of colour A + copies of the holes, solids of colour B + copies of the holes, …
  Colours and cuts both survive; the tree gains one level, labelled "Colour: red" etc. The flat
  alternative (one colour, holes cut) is offered when the colour count is large (> 8).
- Single-colour group → the group's colour on the body; children keep their own colours for
  Ungroup.

### 5.7 Placement and the workplane

Import exactly where Tinkercad had things, including below Z = 0, and do **not** auto-drop to
the workplane (SimpCAD's "designs sitting on the workplane rather than floating" fix was about
getting the offset right, not about moving parts). After import, show a one-line notice if the
lowest solid is below the bed ("Some parts sit below the workplane, as in Tinkercad") so it is
not mistaken for a bug.

## 6. "History"

What Tinkercad exposes is the current tree: shapes, groups, flags. There is no undo stack, no
step list, no revision history to read, and no public way to get one. So the true answer is: the
*history* does not come over, and no tool can bring it.

What Mintr should present instead, and it is close to what people mean by history:

- **One undo entry** labelled "Brought over from Tinkercad" (`editorHistoryEntry(shapes, [], label)`
  in `editorHistory.ts`). No faked step-by-step entries: they would be invented, not history.
- **The group tree as editable steps.** Mintr's model tree already lists a group's children with
  suppress, reorder and edit (`onSuppressFeature`, `onReorderFeature`, `onUpdateFeature`, see
  `docs/FEATURE-HISTORY.md`, "UI"). A Tinkercad group arrives as that list: *Box 40×20×10 → Hole
  cylinder ⌀6 → Hole cylinder ⌀6*. Turn a hole off, change a diameter, ungroup: each is a real
  step from here on.
- **Names** carry over so the tree reads like the Tinkercad one.

Say this plainly in the Import panel: "Your shapes, groups, holes and colours come over. Tinkercad
does not share its undo history, so Mintr's history starts here."

## 7. Phased build

### Phase 0: discovery (half a day, with you)

Run the probe (section 3) and the clipboard test. Capture one small design's raw object as a
test fixture, with names scrubbed, into `tests/fixtures/tinkercad/basic.json`. Decide from the
report which of the four extraction routes the bookmarklet uses: a global, a framework store,
the design JSON URL fetched same-origin, or webpack module hooking.

### Phase 1: smallest useful version (about a week)

Goal: one bookmark with two uses. Click it with shapes selected and it copies them for Ctrl+V in
Mintr (web or desktop); click it with nothing selected and it copies the whole design *and*
opens it in a new Mintr tab on the web (fragment or handshake), or saves the file in desktop
mode. Primitives, groups, holes, colours and hidden parts come over; meshes follow in Phase 2.

Files:

- `apps/web/src/lib/shapeClipboard.ts` — recognise a `TINKERCAD/1\n` prefix (and, if the probe
  finds one, Tinkercad's own clipboard text) and route it through `tinkercadImport.ts`;
  `SketchForgeEditor.tsx` — a `document` `paste` listener feeding `pasteShape`, so cross-origin
  paste needs no permission prompt.

- `apps/web/src/lib/tinkercadImport.ts` — pure mapper `tinkercadDesignToShapes(raw): { shapes, notices }`
  (axis swap, transform decomposition, primitive table, groups, holes, colours, hidden/locked,
  mesh leaves). No DOM, no network: fully unit-testable.
- `apps/web/src/lib/tinkercadHandoff.ts` — fragment encode/decode (deflate-raw + base64url),
  IndexedDB handoff read/write, size thresholds, payload schema check.
- `apps/web/src/lib/tinkercadBookmarklet.ts` — the bookmarklet source as a string builder
  (`bookmarkletHref({ origin, mode: "web" | "file" })`), minified at build time from a readable
  `tinkercadBookmarklet.source.js`.
- `apps/web/public/receive/index.html` — tiny static page: ready message, origin check, store,
  redirect. Plain HTML so it is not part of the Next bundle.
- `apps/web/public/_headers` — detach COOP/COEP under `/receive/*`.
- `apps/web/src/app/page.tsx` — handle `?import=tinkercad` (fragment or handoff id): convert,
  create the project, open the editor; show "Brought over from Tinkercad: N shapes, M groups".
- `apps/web/src/components/SketchForgeEditor.tsx` — Import panel entry (section 9); `selectFile`
  accepts `*.tinkercad.json`.
- `apps/web/src/lib/toolDescriptions.ts`, `apps/web/src/lib/releaseNotes.ts` — copy.
- `docs/WEB-VERSION.md` — the `/receive/` header exception.

Tests (vitest, `tests/unit`):

- `tinkercadImport.test.ts`: every primitive in the table maps to the right kind and sizes; Z-up
  → Y-up; a part below the workplane keeps a negative elevation; rotation + mirror
  decomposition round-trips (`transformMesh` vertices within 1e-3 mm of the fixture's);
  hole flags per part, including a hole group inside a solid group; nested group frames
  (`groupPointToWorld` of a child equals its Tinkercad world position); hidden/locked; colours;
  multicolour → assemble; unknown shape → mesh leaf; a 5,000-shape synthetic design converts in
  under a second; malformed payloads are rejected with a message, never thrown through.
- `shapeClipboard.test.ts` (extend): a `TINKERCAD/1` payload pastes as mapped shapes; Mintr's own
  `SKETCHFORGE3D/1` payload is unchanged; garbage text pastes nothing and says why; a paste event
  with the Tinkercad payload and a focused text input is left to the input.
- `tinkercadHandoff.test.ts`: encode/decode round trip (Node's `zlib` stands in for
  `CompressionStream`); fragment threshold; oversize refusal; payload schema.
- `tinkercadBookmarklet.test.ts`: the built bookmarklet parses (`new Function`), is under 8 KB,
  contains the configured origin only, and the `file` mode never calls `window.open`.
- `webHeaders.test.ts`: `_headers` still sets COOP/COEP on `/*` and detaches them on `/receive/*`.
- Extend `introProject.test.ts`-style checks: an imported subtract group evaluates with the
  kernel to the same volume as grouping the same leaves by hand (`buildGroupedShapeFromSelection`).

### Phase 2: fidelity and big designs (one to two weeks)

- Mesh leaves from per-shape tessellations; group display meshes as cache; nested groups dirty
  and evaluated in the background; triangle-count notice.
- Multicolour groups with holes (per-colour sub-groups).
- Text fonts mapping; tube edge bevel decision; roof/wedge orientation from the fixture.
- Pop-up blocked path (in-page bar with Open Mintr / Save file); handshake timeout.
- Phone: "Copy the bookmark address" button, instructions for Safari and Chrome.
- Accuracy check in CI: for each fixture, compare Mintr's evaluated group mesh volume and bounding
  box against the Tinkercad group mesh (within 0.5 % and 0.01 mm). Catches axis, hole and frame
  mistakes before users do.

### Phase 3: desktop polish and resilience (one week)

- `.mintr` wrapper document from the bookmark's file mode so a double-click opens the design
  (`hydrate` path in `peakcadDocument.ts` / `shapeJson.ts`).
- Optional `mintr://` protocol to focus the app after a save.
- Bookmarklet self-diagnosis: when it cannot find a design, it shows the probe report with a
  "copy" button, so a Tinkercad change produces a bug report, not a shrug.
- Native kernel parity: nothing new in C++, but the parity tests (`enginesParity.test.ts`) should
  include an imported fixture, since the desktop evaluates these groups with the native kernel.

### Risks

| Risk | Mitigation |
|---|---|
| Tinkercad changes its page internals | Bookmarklet is tiny and versioned; mapping is in Mintr; self-diagnosis report; keep two extraction routes (in-memory object and the design JSON URL). Expect to touch it a couple of times a year. |
| Terms of use | The user exports their own design from their own logged-in tab; nothing is sent to us or to any server; no Tinkercad endpoint is called that the page would not call itself. Autodesk's Tinkercad terms (last updated 2019) grant users a licence to their own content including making models from their designs; the pages could not be fetched for an exact quote, so read them once before release and keep the wording "your own designs" in the UI. Do not add bulk export, do not automate across many designs. |
| Tinkercad blocks bookmarklets (CSP) | Browsers exempt bookmarklets from page CSP in Chrome and Firefox, but managed school Chromebooks may block `javascript:` bookmarks: the probe's `cspMeta` and a first-run test tell us. Fallback is the browser-extension route (section 8). |
| COOP on Tinkercad's side severs `window.opener` | Fragment first for small designs; handshake with timeout; file fallback. |
| Pop-up blocked | Second click from an in-page bar; file fallback. |
| Performance on huge designs | Group meshes as cache; nested groups lazy; indexed meshes; triangle notice; convert in a worker if the mapper takes over 200 ms on the main thread. |
| Accuracy (axes, rotation order, mirrors, below-workplane) | Fixture-driven tests with 1e-3 mm vertex checks and CI volume comparison against Tinkercad's own group meshes. |
| Mintr groups are axis-aligned boxes; rotated Tinkercad groups | Flatten the group transform into the children (exact), box the result. Ungroup still restores the children exactly. |

## 8. Is there an easier way? Comparing the options

Plain answer: no option is both easy and keeps the design editable. Tinkercad never publishes an
editable file, so anything editable has to come out of the editor page itself. Here is each
option honestly.

| Option | What you do | What survives | Effort for us |
|---|---|---|---|
| **Tinkercad export → STL** (works today) | Export → STL, Import in Mintr | One mesh (or one per ungrouped top-level shape since the 2025 update, but STL has no object list so Mintr sees one body). Holes already cut, baked. No colours, no groups, no hidden parts, nothing editable. | None |
| **Tinkercad export → OBJ (+MTL)** | Export → OBJ, unzip, import | Meshes, **one per top-level object, each with its colour**. Holes baked. No groups below top level, no editable shapes, hidden parts dropped. | Mintr has no OBJ importer yet (`sourceFormat` lists `obj` but `importExtensionSupported` is STL/SVG/3MF). Adding one with per-object split and MTL colours is 1–2 days and is useful on its own. |
| **Tinkercad export → GLTF/GLB** | Export, import | Same as OBJ in principle (node per object, material colours). Not verified that Tinkercad writes per-object colours. | A GLB importer is 2–3 days; no advantage over OBJ here. |
| **Tinkercad export → SVG** | Export | A 2D outline only. | None; Mintr imports SVG already. Not a design transfer. |
| **Send to Fusion → export STEP → Mintr** (works today) | In Tinkercad, Send to → Autodesk Fusion (needs a free personal Fusion licence on a PC/Mac); in Fusion, Export STEP; Import in Mintr | **Exact solids** (B-rep), one body per top-level object, holes baked. Mintr's STEP import keeps them exact. Only primitive-built designs transfer (Tinkercad's limit); generator shapes and imported meshes do not. No groups, no editable primitives; colours depend on Fusion's STEP export. | None. Best interim path for exactness; worst for convenience. |
| **An official Tinkercad API or share link** | — | There is none for 3D designs. Public share links give a viewer page and an embed iframe, both cross-origin and only for designs you make public; private designs need your login. "Send to" integrations are Autodesk's own. | Not available |
| **Plain copy in Tinkercad, paste in Mintr** | Ctrl+C in Tinkercad, Ctrl+V in Mintr | *If* Tinkercad puts a readable payload on the system clipboard: everything the bookmarklet gets (shapes, flags, colours, groups) for the selection. Likely it does not (its Copy is "memory", shared between its own tabs). **The clipboard probe in section 3 answers this.** | Small: a second prefix in `shapeClipboard.ts` and a DOM `paste` listener. If it works, it is the headline UX. |
| **Copy for Mintr bookmark, then paste** (section 4.4) | Select in Tinkercad, click the bookmark once, Ctrl+V in Mintr | Same as the full bookmarklet: editable primitives, groups, holes per part, colours, hidden/locked, meshes for the rest; and it pastes into an existing design | Same mapper as the Send bookmark; the bookmark gains a clipboard write. Phase 1. |
| **Browser extension instead of a bookmarklet** | Install "Mintr for Tinkercad" from the Chrome Web Store; a button appears in Tinkercad | Same as the bookmarklet, plus: no pop-up or COOP trouble (extension messaging), works where bookmarklets are blocked, can add a toolbar button inside Tinkercad. | Much more: store listing and review, a privacy policy, separate Firefox/Safari builds, updates through the store, keeping up with Tinkercad changes in two places. Right as a Phase 4 if bookmarklets prove blocked for school users. |
| **Claude in Chrome runs the probe/bookmark for you** | Connect the extension, open your design, ask | Same data as the bookmarklet; mainly a way to do the discovery step without DevTools. | None |
| **Bookmarklet (this plan)** | Drag a bookmark once; click it on a design | Editable primitives with sizes, groups nested, holes per part, colours, hidden/locked, meshes for the rest | Phase 1 about a week, then upkeep |

So: STL/OBJ/STEP are available today and give meshes or exact solids with holes baked in and
nothing editable; the bookmarklet is the only route to editable shapes and groups, and the
copy/paste route is the one thing that could be simpler, which the probe step checks first.

## 9. UI

Minimal, following the product direction (unassuming; invisible wins over new UI):

- **Import panel** (`setTopPanel("import")` in `SketchForgeEditor.tsx`): one new row under the
  file types, **"Bring a design over from Tinkercad…"**. Expanding it shows:
  - a draggable **Copy for Mintr** bookmark (an `<a href="javascript:…" draggable>`), with two
    lines: "Drag this to your bookmarks bar. In Tinkercad, select some shapes and click it, then
    paste here with Ctrl+V. Click it with nothing selected to bring the whole design over." On
    touch devices the line reads "Copy the bookmark address and make a bookmark with it", with a
    Copy button.
  - a checkbox "I use the Mintr desktop app" (changes the bookmark to file mode; shown ticked and
    fixed in the desktop app).
  - one quiet line: "Shapes, groups, holes and colours come over. Tinkercad does not share its
    undo history, so Mintr's history starts here." and, on the web, "Designs live in this
    browser until you use Save as…" (same note the dashboard shows).
- **On arrival**: the project opens, named after the design, with the usual notice: "Brought over
  from Tinkercad: 42 shapes in 6 groups. 3 parts came over as meshes." Nothing else new on the
  dashboard or toolbar. The dashboard card looks like any other project.
- **Sage**: no new coaching. If a guide step ever references it, keep Sage low-key as usual.
- **Release notes** (`releaseNotes.ts`): one line.

## 10. Open questions for the discovery report

1. Where the design object lives and its key names (shape type, transform, hole, colour,
   hidden, locked, name, children, group colour/multicolour).
2. Whether leaves carry their own tessellation, or only groups do.
3. Transform representation (matrix vs position + rotation + scale) and whether group transforms
   can be non-uniform or rotated.
4. The design JSON URL pattern and the CSG service calls (resource list).
5. Whether `window.opener` survives to `/receive/` (Tinkercad's COOP), and whether a
   `javascript:` bookmark runs on the page at all.
6. The copy/paste payload: does Ctrl+C in Tinkercad write anything to the system clipboard
   (Notepad test, `clipboardTypes`), and which storage key changes (`storageKeys`)? If a storage
   key holds the copy buffer, its structure is a ready-made serialisation of a selection that
   the Copy for Mintr bookmark can reuse.
