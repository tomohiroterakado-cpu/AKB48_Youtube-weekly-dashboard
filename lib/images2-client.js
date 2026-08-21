const MAX_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_DIMENSION_STEP = 16;
// GPT Image models reject small custom canvases. Keep custom requests above this
// floor and let the API pick a supported canvas for anything smaller.
const MIN_IMAGE_PIXEL_BUDGET = 1024 * 1024;

function alignImageDimension(value) {
  const lower = Math.floor(value / IMAGE_DIMENSION_STEP) * IMAGE_DIMENSION_STEP;
  const upper = Math.ceil(value / IMAGE_DIMENSION_STEP) * IMAGE_DIMENSION_STEP;
  if (lower < 512) return upper;
  return value - lower <= upper - value ? lower : upper;
}

function normalizedOutputSize(outputSize) {
  const width = Number(outputSize?.width);
  const height = Number(outputSize?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 512 || height < 512 || width > 3840 || height > 3840) return "auto";
  const normalizedWidth = alignImageDimension(width);
  const normalizedHeight = alignImageDimension(height);
  if (normalizedWidth > 3840 || normalizedHeight > 3840) return "auto";
  if (normalizedWidth * normalizedHeight < MIN_IMAGE_PIXEL_BUDGET) return "auto";
  return `${normalizedWidth}x${normalizedHeight}`;
}

function normalizedQuality(quality) {
  return ["low", "medium", "high"].includes(quality) ? quality : "high";
}

function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw Object.assign(new Error("PNG、JPEG、またはWebPの画像を選択してください。"), { status: 400 });
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_SOURCE_IMAGE_BYTES) throw Object.assign(new Error("画像は8MB以下にしてください。"), { status: 400 });
  return { type: match[1], bytes };
}

function summarizeBrushZone(editRegions) {
  const points = editRegions.flatMap((region) => region.points || []);
  const widestBrush = Math.max(...editRegions.map((region) => Number(region.brushSize) || 0));
  const padding = widestBrush / 2;
  const coordinate = (value) => Math.max(0, Math.min(1, value)).toFixed(3);
  return `x ${coordinate(Math.min(...points.map((point) => Number(point.x))) - padding)}–${coordinate(Math.max(...points.map((point) => Number(point.x))) + padding)}, y ${coordinate(Math.min(...points.map((point) => Number(point.y))) - padding)}–${coordinate(Math.max(...points.map((point) => Number(point.y))) + padding)}`;
}

function buildImageEditPrompt(production) {
  const brief = production?.images2Brief;
  if (!brief?.requestedCopy || !brief?.direction) throw Object.assign(new Error("生成する候補を選択してください。"), { status: 400 });
  const editRegions = brief.editRegions || [];
  if (!editRegions.length) throw Object.assign(new Error("編集するブラシ範囲を指定してください。"), { status: 400 });
  const brushZone = summarizeBrushZone(editRegions);
  return [
    "You are preparing a subtle design layer for an existing Japanese YouTube thumbnail.",
    `Creative direction: ${brief.direction}`,
    "Do not render any Japanese text. The app will place the exact copy locally.",
    `Only prepare visual treatment inside this normalized editable zone: ${brushZone}.`,
    "The app will apply the result only through an exact brush mask. Every pixel outside it remains the original image.",
    "Do not add, remove, replace, or alter faces, eyes, mouths, hairstyles, hands, uniforms, partner logos, or important background.",
    "Inside the brush area, provide restrained decorative accents, moderate metallic highlights, subtle gloss, clean depth, and a background plate only when useful for text legibility.",
    "Use a polished but restrained commercial treatment: one tone calmer than a flashy gaming thumbnail. Avoid excessive glitter, sparks, lens flares, neon glow, chrome effects, or overly thick multi-layer outlines.",
    "The typography must feel like a premium commercial Japanese YouTube thumbnail, not a flat banner. Keep all faces and eyes free from important text.",
    "Do not invent additional Japanese copy. Do not change existing official logos. No watermark."
  ].join("\n");
}

async function generateImages2Design({ originalImage, production, outputSize, quality = "high", fetchImpl = fetch, apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2" }) {
  if (!apiKey) throw Object.assign(new Error("Images2.0を使うにはCloud RunにOPENAI_API_KEYを設定してください。"), { status: 503 });
  const source = dataUrlToBlob(originalImage);
  const requestedSize = normalizedOutputSize(outputSize);
  const requestedQuality = normalizedQuality(quality);
  const requestImageEdit = async (size) => {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", buildImageEditPrompt(production));
    form.append("image[]", new Blob([source.bytes], { type: source.type }), `original.${source.type.split("/")[1]}`);
    form.append("size", size);
    form.append("quality", requestedQuality);
    form.append("output_format", "png");
    const response = await fetchImpl("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    });
    return { response, payload: await response.json().catch(() => ({})) };
  };

  let size = requestedSize;
  let { response, payload } = await requestImageEdit(size);
  const errorMessage = String(payload?.error?.message || "");
  if (!response.ok && size !== "auto" && /minimum pixel budget|invalid size/i.test(errorMessage)) {
    size = "auto";
    ({ response, payload } = await requestImageEdit(size));
  }
  if (!response.ok) throw Object.assign(new Error(payload?.error?.message || `Images2.0生成に失敗しました (${response.status})`), { status: response.status || 502 });
  const image = payload?.data?.[0]?.b64_json;
  if (!image) throw Object.assign(new Error("Images2.0から画像が返りませんでした。"), { status: 502 });
  return { imageDataUrl: `data:image/png;base64,${image}`, model, outputSize: size, quality: requestedQuality, prompt: buildImageEditPrompt(production), usage: payload.usage || null };
}

module.exports = { IMAGE_DIMENSION_STEP, MAX_SOURCE_IMAGE_BYTES, MIN_IMAGE_PIXEL_BUDGET, alignImageDimension, normalizedOutputSize, normalizedQuality, dataUrlToBlob, buildImageEditPrompt, generateImages2Design };
