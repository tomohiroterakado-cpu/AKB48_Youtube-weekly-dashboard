const MAX_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_DIMENSION_STEP = 16;

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
  return `${normalizedWidth}x${normalizedHeight}`;
}

function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw Object.assign(new Error("PNG、JPEG、またはWebPの画像を選択してください。"), { status: 400 });
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_SOURCE_IMAGE_BYTES) throw Object.assign(new Error("画像は8MB以下にしてください。"), { status: 400 });
  return { type: match[1], bytes };
}

function buildImageEditPrompt(production) {
  const brief = production?.images2Brief;
  if (!brief?.requestedCopy || !brief?.direction) throw Object.assign(new Error("生成する候補を選択してください。"), { status: 400 });
  const protectedNames = (brief.protectedRegions || []).map((region) => region.name).join("、") || "人物・顔・公式ロゴ";
  const safeArea = brief.telopSafeArea;
  if (!safeArea) throw Object.assign(new Error("テロップの安全領域を計算できませんでした。保護範囲を確認してください。"), { status: 400 });
  const safeAreaText = `x=${Math.round(safeArea.x * 100)}%, y=${Math.round(safeArea.y * 100)}%, width=${Math.round(safeArea.w * 100)}%, height=${Math.round(safeArea.h * 100)}%`;
  return [
    "You are designing only the graphic treatment and an empty typography background plate for an existing Japanese YouTube thumbnail.",
    `Creative direction: ${brief.direction}`,
    `Requested Japanese copy for layout context only: ${brief.requestedCopy}`,
    "Keep the source image composition and every person recognizable. Do not add, remove, replace, or alter faces, eyes, mouths, hairstyles, hands, uniforms, partner logos, or important background.",
    `Protected visual assets: ${protectedNames}.`,
    `Reserve this clear text-safe area for the app to typeset the exact Japanese copy after generation: ${safeAreaText}.`,
    "Do not place faces, logos, important objects, letters, numbers, or any glyphs inside the text-safe area. Create only a clean, readable background plate there.",
    "Do not render Japanese text, Latin text, numbers, or symbols anywhere. The application will typeset the exact requested copy after generation.",
    "Improve only the editable areas: restrained decorative accents, moderate metallic highlights, subtle gloss, clean depth, and the empty background plate when needed.",
    "Use a polished but restrained commercial treatment: one tone calmer than a flashy gaming thumbnail. Avoid excessive glitter, sparks, lens flares, neon glow, chrome effects, or overly thick multi-layer outlines.",
    "Keep all faces and eyes free from important text. Do not change existing official logos. No watermark."
  ].join("\n");
}

function normalizedQuality(quality) {
  return ["low", "medium", "high"].includes(quality) ? quality : "high";
}

async function generateImages2Design({ originalImage, production, outputSize, quality = "high", fetchImpl = fetch, apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2" }) {
  if (!apiKey) throw Object.assign(new Error("Images2.0を使うにはCloud RunにOPENAI_API_KEYを設定してください。"), { status: 503 });
  const source = dataUrlToBlob(originalImage);
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", buildImageEditPrompt(production));
  form.append("image[]", new Blob([source.bytes], { type: source.type }), `original.${source.type.split("/")[1]}`);
  const requestedSize = normalizedOutputSize(outputSize);
  form.append("size", requestedSize);
  const requestedQuality = normalizedQuality(quality);
  form.append("quality", requestedQuality);
  form.append("output_format", "png");

  const response = await fetchImpl("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload?.error?.message || `Images2.0生成に失敗しました (${response.status})`), { status: response.status || 502 });
  const image = payload?.data?.[0]?.b64_json;
  if (!image) throw Object.assign(new Error("Images2.0から画像が返りませんでした。"), { status: 502 });
  return { imageDataUrl: `data:image/png;base64,${image}`, model, outputSize: requestedSize, quality: requestedQuality, prompt: buildImageEditPrompt(production), usage: payload.usage || null };
}

module.exports = { IMAGE_DIMENSION_STEP, MAX_SOURCE_IMAGE_BYTES, alignImageDimension, normalizedOutputSize, normalizedQuality, dataUrlToBlob, buildImageEditPrompt, generateImages2Design };
