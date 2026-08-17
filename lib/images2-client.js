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

function normalizeCaptionSafeArea(input) {
  if (!input) return null;
  const values = [input.x, input.y, input.w, input.h].map(Number);
  if (values.some((value) => !Number.isFinite(value))) throw new Error("テロップ安全領域の形式が不正です。");
  const [x, y, w, h] = values;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 || y + h > 1) {
    throw new Error("テロップ安全領域が画像の範囲外です。");
  }
  return { x, y, w, h };
}

function buildImageEditPrompt(production, captionSafeArea) {
  const brief = production?.images2Brief;
  if (!brief?.requestedCopy || !brief?.direction) throw Object.assign(new Error("生成する候補を選択してください。"), { status: 400 });
  const protectedNames = (brief.protectedRegions || []).map((region) => region.name).join("、") || "人物・顔・公式ロゴ";
  const safeArea = normalizeCaptionSafeArea(captionSafeArea);
  const safeAreaInstruction = safeArea
    ? `Reserve this normalized caption-safe area for a browser compositor: x=${safeArea.x.toFixed(4)}, y=${safeArea.y.toFixed(4)}, width=${safeArea.w.toFixed(4)}, height=${safeArea.h.toFixed(4)}. Do not place faces, logos, decorative objects, banners, or lettering inside this area.`
    : "Reserve a clear rectangular caption-safe area away from faces, logos, and important visual subjects. Do not place lettering inside that area.";
  return [
    "You are editing only the non-text visual treatment of an existing Japanese YouTube thumbnail.",
    `Creative direction: ${brief.direction}`,
    "Do not render, replace, add, stylize, crop, or alter any Japanese or Latin text, numbers, caption plates, labels, logos, or watermarks. A browser compositor will place the exact Japanese caption after this edit.",
    safeAreaInstruction,
    "Keep the source image composition and every person recognizable. Do not add, remove, replace, or alter faces, eyes, mouths, hairstyles, hands, uniforms, partner logos, or important background.",
    `Protected visual assets: ${protectedNames}.`,
    "Improve only the editable non-text areas: restrained decorative accents, moderate metallic highlights, subtle gloss, and clean depth.",
    "Use a polished but restrained commercial treatment: one tone calmer than a flashy gaming thumbnail. Avoid excessive glitter, sparks, lens flares, neon glow, chrome effects, or overly thick multi-layer outlines.",
    "Keep all faces and eyes free from important visual treatment. Do not change existing official logos. No watermark."
  ].join("\n");
}

async function generateImages2Design({ originalImage, production, outputSize, quality = "high", captionSafeArea, fetchImpl = fetch, apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2" }) {
  if (!apiKey) throw Object.assign(new Error("Images2.0を使うにはCloud RunにOPENAI_API_KEYを設定してください。"), { status: 503 });
  const source = dataUrlToBlob(originalImage);
  const requestedSize = normalizedOutputSize(outputSize);
  const requestedQuality = normalizedQuality(quality);
  const normalizedSafeArea = normalizeCaptionSafeArea(captionSafeArea);
  const prompt = buildImageEditPrompt(production, normalizedSafeArea);
  const requestImageEdit = async (size) => {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
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
  return { imageDataUrl: `data:image/png;base64,${image}`, model, outputSize: size, quality: requestedQuality, prompt, captionSafeArea: normalizedSafeArea, usage: payload.usage || null };
}

module.exports = { IMAGE_DIMENSION_STEP, MAX_SOURCE_IMAGE_BYTES, MIN_IMAGE_PIXEL_BUDGET, alignImageDimension, normalizedOutputSize, normalizedQuality, dataUrlToBlob, normalizeCaptionSafeArea, buildImageEditPrompt, generateImages2Design };
