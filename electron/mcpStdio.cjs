const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MCP_ROUTE = "/api/peakcad-mcp";
const FALLBACK_ROUTE = "/api/sketchforge-mcp";

const editorTargetSchema = {
  type: "object",
  properties: {
    editorNumber: { type: "number", description: "The 5-digit PeakCAD project number from peakcad_list_editors." },
    editorId: { type: "string", description: "Optional internal editor id. Prefer editorNumber." },
    timeoutMs: { type: "number", description: "Command timeout in milliseconds. Defaults to 15000, or 120000 for changes." },
  },
};

function tool(name, description, inputSchema) {
  return { name, description, inputSchema };
}

const tools = [
  tool("peakcad_list_editors", "List PeakCAD projects that are open, including editorNumber and projectName.", { type: "object", properties: {} }),
  tool("peakcad_read_scene", "Read the current project, selection, units, and object dimensions.", {
    ...editorTargetSchema,
    properties: { ...editorTargetSchema.properties, includeRawShapes: { type: "boolean" } },
  }),
  tool("peakcad_list_objects", "List objects with ids, dimensions, position, and rotation.", editorTargetSchema),
  tool("peakcad_select_objects", "Select objects by id.", {
    ...editorTargetSchema,
    required: ["ids"],
    properties: { ...editorTargetSchema.properties, ids: { type: "array", items: { type: "string" } } },
  }),
  tool("peakcad_delete_objects", "Delete objects by id, or the current selection when ids are omitted.", {
    ...editorTargetSchema,
    properties: { ...editorTargetSchema.properties, ids: { type: "array", items: { type: "string" } }, id: { type: "string" } },
  }),
  tool("peakcad_create_shape", "Create a box, cube, cylinder, sketch extrusion, sphere, cone, pyramid, roof, polygon, round roof, half sphere, torus, ring, or text.", {
    ...editorTargetSchema,
    required: ["kind"],
    properties: {
      ...editorTargetSchema.properties,
      kind: { type: "string", enum: ["box", "cube", "cylinder", "sketch", "sphere", "cone", "pyramid", "roof", "polygon", "roundRoof", "halfSphere", "torus", "tube", "text"] },
      text: { type: "string", description: "Lettering when kind is text." },
      name: { type: "string" },
      color: { type: "string" },
      x: { type: "number" },
      z: { type: "number" },
      elevation: { type: "number" },
      width: { type: "number" },
      depth: { type: "number" },
      height: { type: "number" },
      size: { type: "number" },
      rotation: { type: "number" },
      rotationX: { type: "number" },
      rotationZ: { type: "number" },
      sides: { type: "number" },
      hostShapeId: { type: "string" },
    },
  }),
  tool("peakcad_import_mesh", "Import a triangle mesh from a position array.", {
    ...editorTargetSchema,
    required: ["positions"],
    properties: {
      ...editorTargetSchema.properties,
      name: { type: "string" },
      color: { type: "string" },
      positions: { type: "array", items: { type: "number" } },
      normals: { type: "array", items: { type: "number" } },
    },
  }),
  tool("peakcad_update_object", "Update one object's dimensions, position, color, name, hole state, or rotation.", {
    ...editorTargetSchema,
    required: ["id"],
    properties: {
      ...editorTargetSchema.properties,
      id: { type: "string" },
      name: { type: "string" },
      color: { type: "string" },
      hole: { type: "boolean" },
      x: { type: "number" },
      z: { type: "number" },
      elevation: { type: "number" },
      width: { type: "number" },
      depth: { type: "number" },
      height: { type: "number" },
      size: { type: "number" },
      rotation: { type: "number" },
      rotationX: { type: "number" },
      rotationZ: { type: "number" },
    },
  }),
  tool("peakcad_align_objects", "Align two or more objects the way the Alignment button does.", {
    ...editorTargetSchema,
    required: ["axis", "target"],
    properties: {
      ...editorTargetSchema.properties,
      ids: { type: "array", items: { type: "string" } },
      anchorId: { type: "string" },
      axis: { type: "string", enum: ["x", "y", "z"] },
      target: { type: "string", enum: ["min", "center", "max"] },
    },
  }),
  tool("peakcad_group_objects", "Fuse objects into one solid.", {
    ...editorTargetSchema,
    required: ["ids"],
    properties: { ...editorTargetSchema.properties, ids: { type: "array", items: { type: "string" } } },
  }),
  tool("peakcad_ungroup_objects", "Ungroup one level.", {
    ...editorTargetSchema,
    properties: { ...editorTargetSchema.properties, ids: { type: "array", items: { type: "string" } }, id: { type: "string" } },
  }),
  tool("peakcad_tie_objects", "Tie objects so they move together and stay separate solids. Group fuses them instead.", {
    ...editorTargetSchema,
    required: ["ids"],
    properties: { ...editorTargetSchema.properties, ids: { type: "array", items: { type: "string" } } },
  }),
  tool("peakcad_intersect_objects", "Keep only the overlap of solids and holes.", {
    ...editorTargetSchema,
    required: ["ids"],
    properties: { ...editorTargetSchema.properties, ids: { type: "array", items: { type: "string" } } },
  }),
  tool("peakcad_mirror_objects", "Mirror objects across their own center on x, y, or z.", {
    ...editorTargetSchema,
    properties: {
      ...editorTargetSchema.properties,
      ids: { type: "array", items: { type: "string" } },
      axis: { type: "string", enum: ["x", "y", "z"] },
    },
  }),
  tool("peakcad_circular_pattern", "Copy objects around a center. Count includes the original.", {
    ...editorTargetSchema,
    required: ["ids"],
    properties: {
      ...editorTargetSchema.properties,
      ids: { type: "array", items: { type: "string" } },
      count: { type: "number" },
      radius: { type: "number" },
      rotation: { type: "number", description: "Extra yaw in degrees. Snaps to 0, 90, 180, or 270." },
      centerX: { type: "number" },
      centerZ: { type: "number" },
    },
  }),
  tool("peakcad_linear_pattern", "Copy objects in a grid along X, Z, and Y.", {
    ...editorTargetSchema,
    required: ["ids"],
    properties: {
      ...editorTargetSchema.properties,
      ids: { type: "array", items: { type: "string" } },
      countX: { type: "number" },
      countY: { type: "number" },
      countZ: { type: "number" },
      spacingX: { type: "number" },
      spacingY: { type: "number" },
      spacingZ: { type: "number" },
    },
  }),
  tool("peakcad_duplicate_objects", "Duplicate objects in place.", {
    ...editorTargetSchema,
    properties: { ...editorTargetSchema.properties, ids: { type: "array", items: { type: "string" } } },
  }),
  tool("peakcad_hide_objects", "Hide or show objects.", {
    ...editorTargetSchema,
    properties: {
      ...editorTargetSchema.properties,
      ids: { type: "array", items: { type: "string" } },
      hidden: { type: "boolean" },
    },
  }),
  tool("peakcad_drop_objects", "Drop objects onto the workplane.", {
    ...editorTargetSchema,
    properties: { ...editorTargetSchema.properties, ids: { type: "array", items: { type: "string" } } },
  }),
  tool("peakcad_undo", "Undo the last change.", editorTargetSchema),
  tool("peakcad_redo", "Redo the last undone change.", editorTargetSchema),
  tool("peakcad_reduce_mesh", "Lower the triangle count of an imported mesh.", {
    ...editorTargetSchema,
    required: ["id"],
    properties: {
      ...editorTargetSchema.properties,
      id: { type: "string" },
      keepFraction: { type: "number", description: "Share of triangles to keep, from 0 to 1." },
    },
  }),
  tool("peakcad_export_model", "Export STL, OBJ, or 3MF. Use peakcad_export_step for STEP.", {
    ...editorTargetSchema,
    properties: {
      ...editorTargetSchema.properties,
      format: { type: "string", enum: ["stl", "obj", "3mf"] },
      ids: { type: "array", items: { type: "string" } },
    },
  }),
  tool("peakcad_sketch", "Draw a sketch with the same tools as Sketch mode, then extrude or revolve it. Pass hostShapeId to sketch on a face.", {
    ...editorTargetSchema,
    required: ["shapes"],
    properties: {
      ...editorTargetSchema.properties,
      shapes: {
        type: "array",
        description: "Profiles in sketch coordinates. kind is rectangle, square, roundedRect, slot, ellipse, circle, polygon, triangle, star, arc, or line.",
        items: { type: "object" },
      },
      height: { type: "number" },
      hole: { type: "boolean", description: "Cut the sketch through the host instead of joining a solid." },
      finish: { type: "string", enum: ["extrude", "revolve"] },
      hostShapeId: { type: "string" },
      face: { type: "string", enum: ["top", "bottom", "front", "back", "left", "right"] },
      x: { type: "number" },
      z: { type: "number" },
      elevation: { type: "number" },
      name: { type: "string" },
      color: { type: "string" },
      axisX1: { type: "number" },
      axisZ1: { type: "number" },
      axisX2: { type: "number" },
      axisZ2: { type: "number" },
    },
  }),
  tool("peakcad_edit_sketch", "Open a sketched solid for dimension edits.", {
    ...editorTargetSchema,
    properties: { ...editorTargetSchema.properties, id: { type: "string" } },
  }),
  tool("peakcad_set_sketch_dimension", "Set a driving sketch dimension in millimetres and rebuild the solid.", {
    ...editorTargetSchema,
    required: ["value"],
    properties: {
      ...editorTargetSchema.properties,
      id: { type: "string" },
      dimensionId: { type: "string" },
      value: { type: "number" },
    },
  }),
  tool("peakcad_boolean_cut", "Cut solids with hole objects. The result replaces the operands.", {
    ...editorTargetSchema,
    required: ["solidIds", "holeIds"],
    properties: {
      ...editorTargetSchema.properties,
      solidIds: { type: "array", items: { type: "string" } },
      holeIds: { type: "array", items: { type: "string" } },
    },
  }),
  tool("peakcad_separate_parts", "Separate one disconnected object into independent objects.", {
    ...editorTargetSchema,
    properties: { ...editorTargetSchema.properties, id: { type: "string" } },
  }),
  tool("peakcad_list_edges", "List CAD edge ids so a fillet or chamfer can target them.", {
    ...editorTargetSchema,
    required: ["id"],
    properties: { ...editorTargetSchema.properties, id: { type: "string" }, sharpAngle: { type: "number" } },
  }),
  tool("peakcad_apply_edge_treatment", "Chamfer or fillet edge ids from peakcad_list_edges.", {
    ...editorTargetSchema,
    required: ["id", "kind", "edgeIds", "amount"],
    properties: {
      ...editorTargetSchema.properties,
      id: { type: "string" },
      kind: { type: "string", enum: ["chamfer", "fillet"] },
      edgeIds: { anyOf: [{ type: "array", items: { type: "number" } }, { type: "string", enum: ["all"] }] },
      amount: { type: "number" },
      chamferAngle: { type: "number" },
      sharpAngle: { type: "number" },
      quality: { type: "string", enum: ["draft", "standard", "fine"] },
    },
  }),
  tool("peakcad_hollow", "Turn one solid into walls. Openings are top, bottom, front, back, left, or right.", {
    ...editorTargetSchema,
    required: ["id", "thickness"],
    properties: {
      ...editorTargetSchema.properties,
      id: { type: "string" },
      thickness: { type: "number", description: "Wall thickness in millimetres." },
      openings: { type: "array", items: { type: "string", enum: ["top", "bottom", "front", "back", "left", "right"] } },
      corners: { type: "string", enum: ["sharp", "round"] },
      cornerRadius: { type: "number" },
    },
  }),
  tool("peakcad_split", "Cut one object into two along x, y, or z. Offset is millimetres from the middle.", {
    ...editorTargetSchema,
    required: ["id"],
    properties: {
      ...editorTargetSchema.properties,
      id: { type: "string" },
      axis: { type: "string", enum: ["x", "y", "z"] },
      offset: { type: "number" },
    },
  }),
  tool("peakcad_snap_faces", "Turn the source face onto the target face and center it there.", {
    ...editorTargetSchema,
    required: ["sourceId", "sourceFace", "targetId", "targetFace"],
    properties: {
      ...editorTargetSchema.properties,
      sourceId: { type: "string" },
      targetId: { type: "string" },
      sourceFace: { type: "string", enum: ["top", "bottom", "front", "back", "left", "right"] },
      targetFace: { type: "string", enum: ["top", "bottom", "front", "back", "left", "right"] },
    },
  }),
  tool("peakcad_lay_flat", "Turn a face down onto the workplane.", {
    ...editorTargetSchema,
    required: ["id", "face"],
    properties: {
      ...editorTargetSchema.properties,
      id: { type: "string" },
      face: { type: "string", enum: ["top", "bottom", "front", "back", "left", "right"] },
    },
  }),
  tool("peakcad_create_thread", "Add a metric or named thread as a rod, screw, nut, or tapped hole.", {
    ...editorTargetSchema,
    properties: {
      ...editorTargetSchema.properties,
      designation: { type: "string", description: "Size such as M6 or 1/4-20." },
      role: { type: "string", enum: ["rod", "screw", "nut", "bore"] },
      head: { type: "string", enum: ["cylinder", "countersunk", "hex"] },
      length: { type: "number" },
      x: { type: "number" },
      z: { type: "number" },
      elevation: { type: "number" },
      name: { type: "string" },
    },
  }),
  tool("peakcad_export_step", "Export the project, or the given ids, as STEP text.", {
    ...editorTargetSchema,
    properties: { ...editorTargetSchema.properties, ids: { type: "array", items: { type: "string" } } },
  }),
  tool("peakcad_inspect_errors", "Read the editor notice and the last error.", editorTargetSchema),
  tool("peakcad_capture_image", "Capture a PNG of the viewport.", {
    ...editorTargetSchema,
    properties: {
      ...editorTargetSchema.properties,
      face: { type: "string", enum: ["current", "home", "top", "bottom", "front", "back", "right", "left"] },
    },
  }),
];

const WRITE_TOOLS = new Set([
  "delete_objects",
  "create_shape",
  "import_mesh",
  "update_object",
  "align_objects",
  "group_objects",
  "ungroup_objects",
  "boolean_cut",
  "separate_parts",
  "apply_edge_treatment",
  "hollow",
  "split",
  "snap_faces",
  "lay_flat",
  "create_thread",
  "export_step",
  "tie_objects",
  "intersect_objects",
  "mirror_objects",
  "circular_pattern",
  "linear_pattern",
  "duplicate_objects",
  "hide_objects",
  "drop_objects",
  "undo",
  "redo",
  "reduce_mesh",
  "export_model",
  "edit_sketch",
  "set_sketch_dimension",
  "sketch",
]);

let clientName = "A model";

function sessionCandidates() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return [path.join(appData, "PeakCAD", "mcp-session.json")];
}

function readSessionFile() {
  for (const file of sessionCandidates()) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && typeof parsed.url === "string") return parsed;
    } catch {
      // The desktop app writes this file when it is open.
    }
  }
  return null;
}

function currentSession() {
  if (process.env.PEAKCAD_URL) {
    return { url: process.env.PEAKCAD_URL, token: process.env.PEAKCAD_MCP_TOKEN || "" };
  }
  return readSessionFile() || { url: "http://127.0.0.1:3000", token: "" };
}

function authHeaders(session) {
  const headers = { "Content-Type": "application/json" };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  return headers;
}

async function bridgeFetch(session, route, init) {
  const response = await fetch(new URL(route, session.url), { ...init, headers: { ...authHeaders(session), ...(init?.headers || {}) } });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function bridgeGet(session) {
  let lastError = null;
  for (const route of [MCP_ROUTE, FALLBACK_ROUTE]) {
    try {
      const { response, payload } = await bridgeFetch(session, route, { method: "GET" });
      if (response.ok) return payload;
      lastError = new Error(payload?.error || `PeakCAD returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("PeakCAD is not open");
}

async function bridgeCommand(action, args = {}, defaultTimeoutMs = 15000) {
  const session = currentSession();
  const { editorNumber, editorId, timeoutMs, ...params } = args || {};
  let targetNumber = typeof editorNumber === "number" ? editorNumber : undefined;
  let targetId = typeof editorId === "string" ? editorId : undefined;
  if (!targetNumber && !targetId) {
    const { editors = [] } = await bridgeGet(session);
    if (editors.length === 1) targetNumber = editors[0].editorNumber;
    else throw new Error(editors.length === 0 ? "No open PeakCAD project" : "Provide editorNumber because more than one project is open");
  }
  const body = JSON.stringify({
    type: "command",
    editorNumber: targetNumber,
    editorId: targetId,
    action,
    params,
    timeoutMs: typeof timeoutMs === "number" ? timeoutMs : defaultTimeoutMs,
    clientName,
  });
  let lastError = null;
  for (const route of [MCP_ROUTE, FALLBACK_ROUTE]) {
    try {
      const { response, payload } = await bridgeFetch(session, route, { method: "POST", body });
      if (payload?.ok) return payload.data;
      if (response.status === 404) continue;
      throw new Error(payload?.error || `PeakCAD command failed with HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("PeakCAD is not open");
}

function actionOf(name) {
  return name.replace(/^(peakcad|sketchforge)_/, "");
}

async function callTool(name, args) {
  const action = actionOf(name);
  const timeout = WRITE_TOOLS.has(action) ? 120000 : 15000;
  switch (action) {
    case "list_editors":
      return bridgeGet(currentSession());
    case "read_scene":
      return bridgeCommand("get_scene", args, timeout);
    case "list_objects":
      return bridgeCommand("list_objects", args, timeout);
    case "select_objects":
      return bridgeCommand("select_objects", args, timeout);
    case "delete_objects":
      return bridgeCommand("delete_objects", args, timeout);
    case "create_shape":
      return bridgeCommand("create_shape", args, timeout);
    case "import_mesh":
      return bridgeCommand("import_mesh", args, timeout);
    case "update_object":
      return bridgeCommand("update_object", args, timeout);
    case "align_objects":
      return bridgeCommand("align_objects", args, timeout);
    case "group_objects":
      return bridgeCommand("group_objects", args, timeout);
    case "ungroup_objects":
      return bridgeCommand("ungroup_objects", args, timeout);
    case "tie_objects":
      return bridgeCommand("tie_objects", args, timeout);
    case "intersect_objects":
      return bridgeCommand("intersect_objects", args, timeout);
    case "mirror_objects":
      return bridgeCommand("mirror_objects", args, timeout);
    case "circular_pattern":
      return bridgeCommand("circular_pattern", args, timeout);
    case "linear_pattern":
      return bridgeCommand("linear_pattern", args, timeout);
    case "duplicate_objects":
      return bridgeCommand("duplicate_objects", args, timeout);
    case "hide_objects":
      return bridgeCommand("hide_objects", args, timeout);
    case "drop_objects":
      return bridgeCommand("drop_objects", args, timeout);
    case "undo":
      return bridgeCommand("undo", args, timeout);
    case "redo":
      return bridgeCommand("redo", args, timeout);
    case "reduce_mesh":
      return bridgeCommand("reduce_mesh", args, timeout);
    case "export_model":
      return bridgeCommand("export_model", args, timeout);
    case "edit_sketch":
      return bridgeCommand("edit_sketch", args, timeout);
    case "sketch":
      return bridgeCommand("sketch", args, timeout);
    case "set_sketch_dimension":
      return bridgeCommand("set_sketch_dimension", args, timeout);
    case "boolean_cut":
      return bridgeCommand("boolean_cut", args, timeout);
    case "separate_parts":
      return bridgeCommand("separate_parts", args, timeout);
    case "list_edges":
      return bridgeCommand("list_edges", args, timeout);
    case "apply_edge_treatment":
      return bridgeCommand("apply_edge_treatment", args, timeout);
    case "hollow":
      return bridgeCommand("hollow", args, timeout);
    case "split":
      return bridgeCommand("split", args, timeout);
    case "snap_faces":
      return bridgeCommand("snap_faces", args, timeout);
    case "lay_flat":
      return bridgeCommand("lay_flat", args, timeout);
    case "create_thread":
      return bridgeCommand("create_thread", args, timeout);
    case "export_step":
      return bridgeCommand("export_step", args, timeout);
    case "inspect_errors":
      return bridgeCommand("inspect_errors", args, timeout);
    case "capture_image":
      return bridgeCommand("capture_image", args, timeout);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function textContent(value) {
  return { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) };
}

function toolResult(value) {
  if (value?.dataUrl?.startsWith?.("data:image/png;base64,")) {
    return {
      content: [
        textContent({ face: value.face, bytesApprox: value.bytesApprox }),
        { type: "image", data: value.dataUrl.slice("data:image/png;base64,".length), mimeType: "image/png" },
      ],
    };
  }
  if (typeof value?.step === "string" && value.step.length > 0) {
    const summary = { ...value };
    delete summary.step;
    return {
      content: [
        textContent(summary),
        { type: "text", text: value.step },
      ],
    };
  }
  return { content: [textContent(value)] };
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleMessage(message) {
  if (!message || typeof message !== "object") return;
  const { id, method, params } = message;
  try {
    if (method === "initialize") {
      if (typeof params?.clientInfo?.name === "string" && params.clientInfo.name) {
        clientName = params.clientInfo.name;
      }
      sendResult(id, {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "peakcad", version: "1.0.6" },
      });
      return;
    }
    if (method === "notifications/initialized" || method === "notifications/cancelled") return;
    if (method === "ping") {
      sendResult(id, {});
      return;
    }
    if (method === "tools/list") {
      const aliases = tools.map((entry) => ({ ...entry, name: entry.name.replace(/^peakcad_/, "sketchforge_") }));
      sendResult(id, { tools: [...tools, ...aliases] });
      return;
    }
    if (method === "tools/call") {
      const name = params?.name;
      if (typeof name !== "string") {
        sendError(id, -32602, "Expected tool name");
        return;
      }
      const result = await callTool(name, params?.arguments || {});
      sendResult(id, toolResult(result));
      return;
    }
    if (method === "resources/list") {
      sendResult(id, { resources: [] });
      return;
    }
    sendError(id, -32601, `Unknown method: ${method}`);
  } catch (error) {
    if (method === "tools/call") {
      sendResult(id, { isError: true, content: [textContent(error instanceof Error ? error.message : String(error))] });
      return;
    }
    sendError(id, -32000, error instanceof Error ? error.message : String(error));
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || "";
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      void handleMessage(JSON.parse(trimmed));
    } catch (error) {
      sendError(null, -32700, error instanceof Error ? error.message : String(error));
    }
  });
});
