import * as ort from "onnxruntime-node";
import sharp from "sharp";

// Real inference against the ONNX model exported by a completed
// ml/federation-engine training run (run.py -> output/model.onnx). This is
// a real forward pass through a real trained model — not simulated, not an
// LLM call — but it is a small research model trained on PneumoniaMNIST,
// not a diagnostic device. See docs/production-readiness.md.

export class ModelNotAvailableError extends Error {}
export class InvalidImageError extends Error {}

let cachedSession: ort.InferenceSession | undefined;
let cachedSessionPath: string | undefined;

async function getSession(): Promise<ort.InferenceSession> {
  const modelPath = process.env.MODEL_ONNX_PATH;
  if (!modelPath) {
    throw new ModelNotAvailableError(
      "MODEL_ONNX_PATH is not set. Run ml/federation-engine to produce output/model.onnx, then point MODEL_ONNX_PATH at it.",
    );
  }
  if (cachedSession && cachedSessionPath === modelPath) {
    return cachedSession;
  }
  cachedSession = await ort.InferenceSession.create(modelPath);
  cachedSessionPath = modelPath;
  return cachedSession;
}

export interface ClassificationResult {
  prediction: "normal" | "pneumonia";
  confidence: number;
  normalProbability: number;
  pneumoniaProbability: number;
}

export function softmax2(a: number, b: number): [number, number] {
  const max = Math.max(a, b);
  const expA = Math.exp(a - max);
  const expB = Math.exp(b - max);
  const sum = expA + expB;
  return [expA / sum, expB / sum];
}

const MAX_DIMENSION = 8000; // guards against decompression-bomb-style images

export async function classifyChestXray(imageBuffer: Buffer): Promise<ClassificationResult> {
  const session = await getSession();

  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(imageBuffer).metadata();
  } catch {
    throw new InvalidImageError("Could not read this file as an image. Upload a PNG or JPEG.");
  }
  if (!metadata.width || !metadata.height) {
    throw new InvalidImageError("Could not determine this image's dimensions.");
  }
  if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
    throw new InvalidImageError(`Image is too large (max ${MAX_DIMENSION}px per side).`);
  }

  // Must match ml/federation-engine's training preprocessing exactly:
  // 28x28 grayscale, pixel values normalized to [0, 1].
  let data: Buffer;
  try {
    ({ data } = await sharp(imageBuffer)
      .resize(28, 28, { fit: "fill" })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true }));
  } catch {
    throw new InvalidImageError("Could not process this image. Upload a PNG or JPEG.");
  }

  const floatData = new Float32Array(28 * 28);
  for (let i = 0; i < floatData.length; i++) {
    floatData[i] = data[i] / 255;
  }

  const inputTensor = new ort.Tensor("float32", floatData, [1, 1, 28, 28]);
  const outputs = await session.run({ image: inputTensor });
  const logits = outputs.logits.data as Float32Array;

  // Class 0 = normal, class 1 = pneumonia — matches PneumoniaMNIST's label
  // convention and ml/federation-engine/dataset.py's class_0_normal /
  // class_1_pneumonia naming.
  const [normalProbability, pneumoniaProbability] = softmax2(logits[0], logits[1]);
  const prediction = pneumoniaProbability >= normalProbability ? "pneumonia" : "normal";
  const confidence = Math.max(normalProbability, pneumoniaProbability);

  return { prediction, confidence, normalProbability, pneumoniaProbability };
}
