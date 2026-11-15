import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { updateSectionCaps } from "@/lib/xrayCaps";
import { shouldPreserveDrawingBufferForLocalAutomation } from "@/lib/viewportInteractionMath";
import { hardwareProfile, resolvePixelRatio } from "@/lib/desktopHardware";
import { DEFAULT_LIGHT_VIEWPORT_BACKGROUND, resolveViewportBackground } from "@/lib/uiTheme";
import { CAMERA_TARGET, DEFAULT_WORKSPACE, WORKPLANE_DEPTH, WORKPLANE_WIDTH } from "@/components/viewport/viewportConstants";
import type { ThreeState } from "@/components/viewport/viewportTypes";
import { rebuildWorkplane } from "@/components/viewport/workplaneScene";
import { resetCamera } from "@/components/viewport/camera";

export function resolveHostSize(host: HTMLElement) {
  return {
    width: Math.max(1, Math.floor(host.clientWidth)),
    height: Math.max(1, Math.floor(host.clientHeight)),
    isValid: host.clientWidth >= 2 && host.clientHeight >= 2,
  };
}

export function createThreeScene(host: HTMLDivElement): ThreeState {
  // Stencil is for X-ray's filled cut faces; three.js leaves it off unless asked.
  const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, powerPreference: "high-performance", preserveDrawingBuffer: shouldPreserveDrawingBufferForLocalAutomation() });
  renderer.setPixelRatio(resolvePixelRatio(window.devicePixelRatio || 1));
  renderer.shadowMap.autoUpdate = false;
  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
  });
  const initialSize = resolveHostSize(host);
  // Keep CSS (width/height: 100%) in charge of layout; only sync the drawing buffer.
  // updateStyle=true can lock the canvas to a 0-height first paint and leave the
  // workplane stranded as a thin strip until a window resize happens.
  renderer.setSize(initialSize.width, initialSize.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = DEFAULT_WORKSPACE.showShadows;
  renderer.shadowMap.type = hardwareProfile().highEnd ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(resolveViewportBackground(DEFAULT_LIGHT_VIEWPORT_BACKGROUND));

  const camera = new THREE.PerspectiveCamera(38, initialSize.width / initialSize.height, 0.1, 6000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  // Higher than 0.08 so the glide dies in fewer frames. controls.update() then
  // reports still sooner, and the measurement fade-in is not waiting on a long coast.
  controls.dampingFactor = 0.22;
  controls.rotateSpeed = 0.58;
  controls.zoomSpeed = 0.72;
  controls.panSpeed = 0.65;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.mouseButtons = {
    LEFT: null,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.minDistance = 18;
  controls.maxDistance = 4200;
  controls.minPolarAngle = 0.06;
  controls.maxPolarAngle = Math.PI - 0.06;
  controls.target.copy(CAMERA_TARGET);

  const ambient = new THREE.HemisphereLight("#ffffff", "#d6edf5", 2.1);
  scene.add(ambient);

  const key = new THREE.DirectionalLight("#ffffff", 3.1);
  key.position.set(70, 130, 75);
  key.castShadow = true;
  // The light does not follow the camera. Rebuilding the shadow map on every orbit
  // or drag frame redraws the whole assembly. Update it only when geometry moves.
  key.shadow.autoUpdate = false;
  key.shadow.camera.left = -130;
  key.shadow.camera.right = 130;
  key.shadow.camera.top = 130;
  key.shadow.camera.bottom = -130;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 400;
  key.shadow.mapSize.set(hardwareProfile().shadowMapSize, hardwareProfile().shadowMapSize);
  key.shadow.bias = -0.00008;
  key.shadow.normalBias = 0.045;
  key.shadow.camera.updateProjectionMatrix();
  scene.add(key);

  const fill = new THREE.DirectionalLight("#c8f4ff", 1.2);
  fill.position.set(-95, 45, -60);
  scene.add(fill);

  const workplaneLayer = new THREE.Group();
  workplaneLayer.name = "Workplane";
  const shapeLayer = new THREE.Group();
  shapeLayer.name = "Shapes";
  const helperLayer = new THREE.Group();
  helperLayer.name = "SelectionHelpers";
  const modifierLayer = new THREE.Group();
  modifierLayer.name = "EdgeModifier";
  const xrayLayer = new THREE.Group();
  xrayLayer.name = "XrayCuttingPlane";
  const sectionCapLayer = new THREE.Group();
  sectionCapLayer.name = "XraySectionCaps";
  const printLayer = new THREE.Group();
  printLayer.name = "Printer";
  printLayer.renderOrder = 6;
  scene.add(workplaneLayer, shapeLayer, printLayer, helperLayer, modifierLayer, xrayLayer, sectionCapLayer);
  // Cut faces follow their parts as they move, every frame, after the scene's matrices are worked out.
  scene.onBeforeRender = (renderer, _scene, camera) => updateSectionCaps(sectionCapLayer, camera, renderer);

  const raycaster = new THREE.Raycaster();
  raycaster.params.Line = { threshold: 1.15 };
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const clippingPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 40);

  let hadValidSize = initialSize.isValid;
  const resize = () => {
    const next = resolveHostSize(host);
    // Ignore collapsed hosts (display:none / zero layout). Shrinking the buffer
    // to 1×1 here left the workplane blank when the editor was shown again.
    if (!next.isValid) {
      return;
    }
    renderer.setPixelRatio(resolvePixelRatio(window.devicePixelRatio || 1));
    renderer.setSize(next.width, next.height, false);
    camera.aspect = next.width / next.height;
    camera.updateProjectionMatrix();
    // Resizing wipes the canvas. Draw again right away, before the browser paints, or the
    // workplane shows blank for a frame (a flicker whenever a panel or bar comes and goes).
    try {
      renderer.render(scene, camera);
    } catch {
      // The render loop reports failures; this is only the instant redraw.
    }
    // First time the host gets a real layout, snap home so a zero-size init
    // cannot leave the camera/frustum looking past an invisible workplane.
    if (!hadValidSize) {
      resetCamera(state);
      hadValidSize = true;
    }
    state.needsRender = true;
  };

  const state = {
    renderer,
    scene,
    camera,
    controls,
    keyLight: key,
    workplaneLayer,
    shapeLayer,
    helperLayer,
    modifierLayer,
    xrayLayer,
    sectionCapLayer,
    printLayer,
    printShapes: [],
    showPrinterBed: true,
    showOverhangStripes: false,
    showThinWalls: false,
    showSmallHoles: false,
    showTrappedResin: false,
    laserDesign: false,
    printerAngle: 45,
    nozzleMm: 0.4,
    overhangKey: "",
    thinWallKey: "",
    smallHoleKey: "",
    trappedResinKey: "",
    clippingPlane,
    edgeWipe: null,
    previewHold: new Map<string, THREE.Object3D>(),
    modifierPreviewActive: false,
    shapeRevision: 0,
    xray: {
      enabled: false,
      axis: "y" as const,
      position: 40,
      keepLow: true,
      showPlane: false,
      planeSize: Math.max(WORKPLANE_WIDTH, WORKPLANE_DEPTH) * 1.15,
      bounds: { min: -4, max: 24 },
    },
    xraySweep: null,
    raycaster,
    pointer,
    dragPlane,
    animationId: 0,
    needsRender: true,
    cameraTween: null,
    wasCameraMoving: false,
    cameraStillFrames: 0,
    cameraOverlayHold: false,
    cameraHoldPosition: new THREE.Vector3(),
    cameraHoldTarget: new THREE.Vector3(),
    cameraHoldQuaternion: new THREE.Quaternion(),
    lastOverlaySync: 0,
    lastViewCubeSync: 0,
    rotationHandleSides: null,
    disposeInteractionListeners: () => {},
    resize,
  };
  const requestRender = () => {
    state.needsRender = true;
  };
  const configureSketchForgeMouseButtons = (event: PointerEvent) => {
    controls.mouseButtons.LEFT = event.button === 0 && (event.ctrlKey || event.metaKey) ? THREE.MOUSE.PAN : null;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  };
  const resetSketchForgeMouseButtons = () => {
    controls.mouseButtons.LEFT = null;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  };
  const preventContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };
  // The canvas never takes focus, so a rename, a size label or the W×L field stayed focused
  // after a click in the view: the typed value was dropped and Delete/arrows went into the box.
  // Let go of the field first so it commits like it would on Tab.
  const releaseTextField = () => {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement)) return;
    if (active.closest("[data-keep-focus-on-view]")) return;
    active.blur();
  };
  controls.addEventListener("change", requestRender);
  renderer.domElement.addEventListener("pointerdown", releaseTextField, { capture: true });
  renderer.domElement.addEventListener("pointerdown", configureSketchForgeMouseButtons, { capture: true });
  renderer.domElement.addEventListener("pointerup", resetSketchForgeMouseButtons);
  renderer.domElement.addEventListener("pointercancel", resetSketchForgeMouseButtons);
  renderer.domElement.addEventListener("contextmenu", preventContextMenu);
  renderer.domElement.addEventListener("wheel", requestRender, { passive: true });
  renderer.domElement.addEventListener("pointerdown", requestRender);
  state.disposeInteractionListeners = () => {
    controls.removeEventListener("change", requestRender);
    renderer.domElement.removeEventListener("pointerdown", releaseTextField, { capture: true });
    renderer.domElement.removeEventListener("pointerdown", configureSketchForgeMouseButtons, { capture: true });
    renderer.domElement.removeEventListener("pointerup", resetSketchForgeMouseButtons);
    renderer.domElement.removeEventListener("pointercancel", resetSketchForgeMouseButtons);
    renderer.domElement.removeEventListener("contextmenu", preventContextMenu);
    renderer.domElement.removeEventListener("wheel", requestRender);
    renderer.domElement.removeEventListener("pointerdown", requestRender);
  };
  rebuildWorkplane(state, DEFAULT_WORKSPACE);
  return state;
}
