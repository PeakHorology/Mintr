import type { TraceClick } from "@/lib/photoTrace/segment";
import type { Rgba } from "@/lib/photoTrace/picture";

/**
 * Better tracing: SlimSAM, a slimmed Segment Anything model (Apache-2.0), run on this
 * computer through transformers.js (Apache-2.0). Neither ships with Mintr: both download
 * the first time someone turns Better tracing on, about 30 MB, and the browser keeps them.
 * Photos never leave the computer.
 */
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/dist/transformers.min.js";
const MODEL_ID = "Xenova/slimsam-77-uniform";
/** The biggest model file; once the browser holds it, the model counts as downloaded. */
const MODEL_FILE_URL = `https://huggingface.co/${MODEL_ID}/resolve/main/onnx/vision_encoder_quantized.onnx`;
const CACHE_NAME = "transformers-cache";

type Tensor = { data: ArrayLike<number | bigint | boolean>; dims: number[] };
type TransformersModule = {
  env: { allowLocalModels: boolean; backends: { onnx: { wasm: { proxy: boolean } } } };
  SamModel: { from_pretrained: (id: string, options: Record<string, unknown>) => Promise<SamModelInstance> };
  AutoProcessor: { from_pretrained: (id: string, options: Record<string, unknown>) => Promise<SamProcessor> };
  RawImage: new (data: Uint8ClampedArray, width: number, height: number, channels: number) => unknown;
  Tensor: new (type: string, data: ArrayLike<number> | BigInt64Array, dims: number[]) => Tensor;
};
type SamInputs = { pixel_values: Tensor; original_sizes: number[][]; reshaped_input_sizes: number[][] };
type SamProcessor = ((image: unknown) => Promise<SamInputs>) & {
  post_process_masks: (masks: Tensor, original: number[][], reshaped: number[][]) => Promise<Tensor[]>;
};
type SamModelInstance = {
  get_image_embeddings: (inputs: SamInputs) => Promise<Record<string, Tensor>>;
  (inputs: Record<string, unknown>): Promise<{ pred_masks: Tensor; iou_scores: Tensor }>;
};

export type AiProgress = { loaded: number; total: number };

let loading: Promise<{ lib: TransformersModule; model: SamModelInstance; processor: SamProcessor }> | null = null;

/** Whether the model is already on this computer, so turning it on needs no download. */
export async function aiTracerDownloaded() {
  try {
    if (typeof caches === "undefined") return false;
    const cache = await caches.open(CACHE_NAME);
    return Boolean(await cache.match(MODEL_FILE_URL));
  } catch {
    return false;
  }
}

/** Downloads (the first time) and starts the model. */
export function loadAiTracer(onProgress?: (progress: AiProgress) => void) {
  if (!loading) {
    loading = (async () => {
      const lib = (await import(/* webpackIgnore: true */ TRANSFORMERS_URL)) as TransformersModule;
      lib.env.allowLocalModels = false;
      // Run the model off the page's own thread, so the window stays smooth while it thinks.
      lib.env.backends.onnx.wasm.proxy = true;
      const files = new Map<string, AiProgress>();
      const progress_callback = (event: { status?: string; file?: string; loaded?: number; total?: number }) => {
        if (event.status !== "progress" || !event.file) return;
        files.set(event.file, { loaded: event.loaded ?? 0, total: event.total ?? 0 });
        let loaded = 0;
        let total = 0;
        files.forEach((file) => {
          loaded += file.loaded;
          total += file.total;
        });
        onProgress?.({ loaded, total });
      };
      const [model, processor] = await Promise.all([
        lib.SamModel.from_pretrained(MODEL_ID, { dtype: "q8", device: "wasm", progress_callback }),
        lib.AutoProcessor.from_pretrained(MODEL_ID, { progress_callback }),
      ]);
      return { lib, model, processor };
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** The model, looking at one picture: work out the picture once, then answer each set of clicks quickly. */
export async function aiTracerFor(picture: Rgba) {
  const { lib, model, processor } = await loadAiTracer();
  const image = new lib.RawImage(new Uint8ClampedArray(picture.data), picture.width, picture.height, 4);
  const inputs = await processor(image);
  const embeddings = await model.get_image_embeddings(inputs);
  const [reshapedHeight, reshapedWidth] = inputs.reshaped_input_sizes[0];
  return async (clicks: readonly TraceClick[]): Promise<Uint8Array | null> => {
    if (!clicks.some((click) => click.keep)) return null;
    const points = clicks.flatMap((click) => [click.x * (reshapedWidth / picture.width), click.y * (reshapedHeight / picture.height)]);
    const input_points = new lib.Tensor("float32", points, [1, 1, clicks.length, 2]);
    const input_labels = new lib.Tensor("int64", BigInt64Array.from(clicks.map((click) => BigInt(click.keep ? 1 : 0))), [1, 1, clicks.length]);
    const outputs = await model({ ...embeddings, input_points, input_labels });
    const masks = await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
    const scores = Array.from(outputs.iou_scores.data as ArrayLike<number>);
    const best = scores.indexOf(Math.max(...scores));
    const size = picture.width * picture.height;
    const data = masks[0].data;
    const mask = new Uint8Array(size);
    for (let index = 0; index < size; index += 1) mask[index] = data[best * size + index] ? 1 : 0;
    return mask;
  };
}
