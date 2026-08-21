const thumbnailState = {
  imageDataUrl: "",
  review: null,
  reviewToken: "",
  production: null,
  selectedCandidateId: "",
  previewMode: "selected-two",
  previewCandidateIds: [],
  previewImages: {},
  editRegions: [],
  brushSize: 0.12,
  generatedImageDataUrl: "",
  finalImageDataUrl: "",
  sourceSize: null
};

function thumbnailEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function thumbnailImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    image.src = dataUrl;
  });
}

function normalizedPointer(event, surface) {
  const box = surface.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
    y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height))
  };
}

function brushCanvas() {
  return document.getElementById("thumbnailEditCanvas");
}

function resizeBrushCanvas() {
  const canvas = brushCanvas();
  const surface = document.getElementById("thumbnailPreviewSurface");
  if (!canvas || !surface) return;
  const { width, height } = surface.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  canvas.hidden = !thumbnailState.imageDataUrl;
  renderThumbnailEditRegions();
}

function drawBrushPath(context, region, width, height) {
  const points = region.points || [];
  if (!points.length) return;
  context.save();
  context.strokeStyle = "rgba(211, 22, 58, .68)";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = Math.max(2, region.brushSize * Math.min(width, height));
  context.beginPath();
  context.moveTo(points[0].x * width, points[0].y * height);
  points.slice(1).forEach((point) => context.lineTo(point.x * width, point.y * height));
  if (points.length === 1) context.lineTo(points[0].x * width + 0.1, points[0].y * height + 0.1);
  context.stroke();
  context.restore();
}

function renderThumbnailEditRegions() {
  const canvas = brushCanvas();
  const list = document.getElementById("thumbnailEditList");
  if (!canvas || !list) return;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  thumbnailState.editRegions.forEach((region) => drawBrushPath(context, region, canvas.width, canvas.height));
  list.replaceChildren();
  if (!thumbnailState.editRegions.length) {
    list.appendChild(thumbnailEl("p", "meta", "テロップを修正・追加する場所だけをなぞってください。なぞらない場所は元画像のままです。"));
  } else {
    list.appendChild(thumbnailEl("p", "meta", `編集ブラシ ${thumbnailState.editRegions.length}本。指定範囲の中に、入力したテロップを収めます。`));
  }
}

function bindThumbnailBrushDrawing() {
  const canvas = brushCanvas();
  if (!canvas || canvas.dataset.bound) return;
  canvas.dataset.bound = "true";
  let draft = null;
  canvas.addEventListener("pointerdown", (event) => {
    if (!thumbnailState.imageDataUrl) return;
    event.preventDefault();
    draft = { brushSize: thumbnailState.brushSize, points: [normalizedPointer(event, canvas)] };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!draft) return;
    draft.points.push(normalizedPointer(event, canvas));
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    thumbnailState.editRegions.forEach((region) => drawBrushPath(context, region, canvas.width, canvas.height));
    drawBrushPath(context, draft, canvas.width, canvas.height);
  });
  const finish = (event) => {
    if (!draft) return;
    draft.points.push(normalizedPointer(event, canvas));
    thumbnailState.editRegions.push(draft);
    draft = null;
    renderThumbnailEditRegions();
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", () => { draft = null; renderThumbnailEditRegions(); });
}

function resetThumbnailResult() {
  thumbnailState.review = null;
  thumbnailState.reviewToken = "";
  thumbnailState.production = null;
  thumbnailState.selectedCandidateId = "";
  thumbnailState.previewMode = "selected-two";
  thumbnailState.previewCandidateIds = [];
  thumbnailState.previewImages = {};
  thumbnailState.generatedImageDataUrl = "";
  thumbnailState.finalImageDataUrl = "";
  document.getElementById("thumbnailCandidateRail").replaceChildren();
  document.getElementById("thumbnailPreviewControls").hidden = true;
  document.getElementById("thumbnailQualityList").replaceChildren();
  document.getElementById("thumbnailFinalPreview").replaceChildren(
    thumbnailEl("p", "emptyState", "生成・合成後の最終サムネイルがここに表示されます。")
  );
  document.getElementById("thumbnailGenerate").disabled = true;
  document.getElementById("thumbnailDownload").disabled = true;
}

async function readThumbnailFile() {
  const file = document.getElementById("thumbnailOriginalFile").files[0];
  if (!file) throw new Error("元サムネイルを選択してください。\n");
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("PNG、JPEG、またはWebPを選択してください。");
  if (file.size > 8 * 1024 * 1024) throw new Error("画像は8MB以下にしてください。");
  thumbnailState.imageDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    reader.readAsDataURL(file);
  });
  const image = await thumbnailImage(thumbnailState.imageDataUrl);
  if (Math.abs((image.naturalWidth / image.naturalHeight) - (16 / 9)) > 0.01) {
    thumbnailState.imageDataUrl = "";
    throw new Error("サムネイルは16:9の画像を選択してください。ブラシ位置と編集範囲を正確に一致させるためです。");
  }
  thumbnailState.sourceSize = { width: image.naturalWidth, height: image.naturalHeight };
  document.getElementById("thumbnailOriginalPreview").src = thumbnailState.imageDataUrl;
  document.getElementById("thumbnailOriginalPreview").hidden = false;
  document.getElementById("thumbnailPreviewHint").hidden = false;
  thumbnailState.editRegions = [];
  resetThumbnailResult();
  resizeBrushCanvas();
  const status = document.getElementById("thumbnailStatus");
  status.className = "infoItem";
  status.textContent = `「${file.name}」を読み込みました。変更したいテロップの範囲だけをブラシでなぞってから、6案を設計してください。`;
}

function renderThumbnailCandidates() {
  const rail = document.getElementById("thumbnailCandidateRail");
  rail.replaceChildren();
  (thumbnailState.review?.candidates || []).forEach((candidate) => {
    const previewImage = thumbnailState.previewImages[candidate.id];
    const isCompareSelected = thumbnailState.previewMode === "selected-two" && thumbnailState.previewCandidateIds.includes(candidate.id);
    const classes = [
      "thumbnailCandidate",
      thumbnailState.selectedCandidateId === candidate.id ? "selected" : "",
      isCompareSelected ? "compareSelected" : ""
    ].filter(Boolean).join(" ");
    const card = thumbnailEl("article", classes);
    card.append(thumbnailEl("strong", "thumbnailCandidateId", candidate.id), thumbnailEl("h3", "", candidate.name), thumbnailEl("p", "", candidate.purpose), thumbnailEl("p", "meta", candidate.recommendedCopy));
    if (thumbnailState.previewMode === "selected-two") {
      const compare = thumbnailEl("label", "thumbnailCandidateCompare");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = isCompareSelected;
      input.disabled = Boolean(previewImage);
      input.addEventListener("change", () => toggleThumbnailPreviewCandidate(candidate.id, input.checked));
      compare.append(input, document.createTextNode("この案を比較する"));
      card.appendChild(compare);
    }
    if (previewImage) {
      const image = document.createElement("img");
      image.className = "thumbnailCandidatePreview";
      image.src = previewImage;
      image.alt = `${candidate.name}の低画質プレビュー`;
      card.append(image, thumbnailEl("p", "thumbnailCandidatePreviewNote", "比較用の低画質プレビュー"));
      const choose = thumbnailEl("button", thumbnailState.selectedCandidateId === candidate.id ? "primaryButton" : "secondaryButton", thumbnailState.selectedCandidateId === candidate.id ? "選択中" : "この案を本生成に選ぶ");
      choose.type = "button";
      choose.addEventListener("click", () => selectThumbnailCandidate(candidate.id));
      card.appendChild(choose);
    }
    rail.appendChild(card);
  });
  renderThumbnailPreviewControls();
}

function renderThumbnailPreviewControls() {
  const controls = document.getElementById("thumbnailPreviewControls");
  const selection = document.getElementById("thumbnailPreviewSelection");
  const generate = document.getElementById("thumbnailGeneratePreviews");
  if (!thumbnailState.review) {
    controls.hidden = true;
    return;
  }
  controls.hidden = false;
  const candidates = thumbnailState.review.candidates || [];
  const hasPreviews = Object.keys(thumbnailState.previewImages).length > 0;
  document.querySelectorAll("input[name=thumbnailPreviewMode]").forEach((input) => {
    input.checked = input.value === thumbnailState.previewMode;
    input.disabled = hasPreviews;
  });
  if (thumbnailState.previewMode === "all-six") {
    selection.textContent = `6案すべてを低画質で比較します（${candidates.length}/${candidates.length}案）。本生成は、この後に選ぶ1案だけです。`;
    generate.textContent = "6案すべてを低画質で比較する";
    generate.disabled = hasPreviews;
  } else {
    const selectedCount = thumbnailState.previewCandidateIds.length;
    selection.textContent = `比較する候補を2案選んでください（${selectedCount}/2）。低画質の比較後、1案だけを高画質で本生成します。`;
    generate.textContent = "選んだ2案を低画質で比較する";
    generate.disabled = hasPreviews || selectedCount !== 2;
  }
}

function toggleThumbnailPreviewCandidate(candidateId, checked) {
  if (Object.keys(thumbnailState.previewImages).length) return;
  const selected = new Set(thumbnailState.previewCandidateIds);
  if (checked) {
    if (selected.size >= 2) {
      const status = document.getElementById("thumbnailStatus");
      status.className = "warningItem";
      status.textContent = "コスト優先の比較では2案まで選べます。別の候補を外してから選んでください。";
      renderThumbnailCandidates();
      return;
    }
    selected.add(candidateId);
  } else {
    selected.delete(candidateId);
  }
  thumbnailState.previewCandidateIds = [...selected];
  renderThumbnailCandidates();
}

function setThumbnailPreviewMode(mode) {
  if (Object.keys(thumbnailState.previewImages).length) {
    const status = document.getElementById("thumbnailStatus");
    status.className = "warningItem";
    status.textContent = "比較プレビュー作成後は比較方式を変更できません。方式を変える場合は、もう一度6案を設計してください。";
    renderThumbnailPreviewControls();
    return;
  }
  thumbnailState.previewMode = mode === "all-six" ? "all-six" : "selected-two";
  thumbnailState.previewCandidateIds = [];
  renderThumbnailCandidates();
}

async function createThumbnailReview() {
  if (!requireAdmin()) return;
  const result = document.getElementById("thumbnailStatus");
  try {
    if (!thumbnailState.imageDataUrl) await readThumbnailFile();
    result.className = "infoItem";
    result.textContent = "入力したテロップと、ブラシで指定した編集範囲をもとに6案を作成しています...";
    const review = await api("/api/thumbnails/review", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        jobId: document.getElementById("thumbnailJobId").value.trim(),
        requestedCopy: document.getElementById("thumbnailCopy").value.trim(),
        editRegions: thumbnailState.editRegions
      })
    });
    thumbnailState.review = review;
    thumbnailState.reviewToken = review.reviewToken;
    thumbnailState.production = null;
    thumbnailState.selectedCandidateId = "";
    thumbnailState.previewMode = "selected-two";
    thumbnailState.previewCandidateIds = [];
    thumbnailState.previewImages = {};
    document.getElementById("thumbnailGenerate").disabled = true;
    result.textContent = "6案を用意しました。低画質で比較してから、選んだ1案だけを高画質で本生成します。";
    renderThumbnailCandidates();
  } catch (error) {
    result.className = "errorItem";
    result.textContent = error.message;
  }
}

async function generateThumbnailPreviews() {
  if (!requireAdmin() || !thumbnailState.review) return;
  const result = document.getElementById("thumbnailStatus");
  const generate = document.getElementById("thumbnailGeneratePreviews");
  const candidateIds = thumbnailState.previewMode === "all-six"
    ? thumbnailState.review.candidates.map((candidate) => candidate.id)
    : thumbnailState.previewCandidateIds;
  if (thumbnailState.previewMode === "selected-two" && candidateIds.length !== 2) {
    result.className = "warningItem";
    result.textContent = "低画質で比較する候補を2案選んでください。";
    return;
  }
  try {
    generate.disabled = true;
    result.className = "infoItem";
    result.textContent = `${candidateIds.length}案を低画質で作成しています。最終の高画質生成はまだ実行しません...`;
    const payload = await api("/api/thumbnails/previews", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        originalImage: thumbnailState.imageDataUrl,
        reviewToken: thumbnailState.reviewToken,
        previewMode: thumbnailState.previewMode,
        candidateIds,
        outputSize: thumbnailState.sourceSize
      })
    });
    for (const preview of payload.previews || []) {
      thumbnailState.previewImages[preview.candidateId] = await compositeEditedRegions(preview.imageDataUrl);
    }
    thumbnailState.previewCandidateIds = candidateIds;
    renderThumbnailCandidates();
    const failures = payload.errors || [];
    result.className = failures.length ? "warningItem" : "infoItem";
    result.textContent = failures.length
      ? `${payload.previews.length}案の低画質プレビューを作成しました。${failures.length}案は作成できなかったため、再度6案を設計して比較してください。`
      : `${payload.previews.length}案の低画質プレビューを作成しました。比較後、1案を選んで高画質で本生成してください。`;
  } catch (error) {
    result.className = "errorItem";
    result.textContent = error.message;
    renderThumbnailPreviewControls();
  }
}

async function selectThumbnailCandidate(candidateId) {
  const result = document.getElementById("thumbnailStatus");
  try {
    const production = await api("/api/thumbnails/select", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ reviewToken: thumbnailState.reviewToken, candidateId })
    });
    thumbnailState.production = production;
    thumbnailState.selectedCandidateId = candidateId;
    document.getElementById("thumbnailGenerate").disabled = false;
    result.className = "infoItem";
    result.textContent = `${production.selectedCandidate.name}を選択しました。ブラシでなぞった範囲だけを編集し、指定テロップはその範囲内に正確に合成します。`;
    renderThumbnailCandidates();
  } catch (error) {
    result.className = "errorItem";
    result.textContent = error.message;
  }
}

function createEditMask(width, height) {
  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const context = mask.getContext("2d");
  context.strokeStyle = "white";
  context.lineCap = "round";
  context.lineJoin = "round";
  thumbnailState.editRegions.forEach((region) => {
    const points = region.points || [];
    if (!points.length) return;
    context.lineWidth = Math.max(2, region.brushSize * Math.min(width, height));
    context.beginPath();
    context.moveTo(points[0].x * width, points[0].y * height);
    points.slice(1).forEach((point) => context.lineTo(point.x * width, point.y * height));
    if (points.length === 1) context.lineTo(points[0].x * width + 0.1, points[0].y * height + 0.1);
    context.stroke();
  });
  return mask;
}

function editBounds(width, height) {
  const points = thumbnailState.editRegions.flatMap((region) => (region.points || []).map((point) => ({ ...point, brushSize: region.brushSize })));
  if (!points.length) throw new Error("テロップを編集する範囲をブラシでなぞってください。");
  const minX = Math.max(0, Math.min(...points.map((point) => point.x - point.brushSize / 2)) * width);
  const maxX = Math.min(width, Math.max(...points.map((point) => point.x + point.brushSize / 2)) * width);
  const minY = Math.max(0, Math.min(...points.map((point) => point.y - point.brushSize / 2)) * height);
  const maxY = Math.min(height, Math.max(...points.map((point) => point.y + point.brushSize / 2)) * height);
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function wrapTextForThumbnail(context, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const character of Array.from(String(text || ""))) {
    const candidate = line + character;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = character;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const MIN_TELOP_FONT_SIZE = 4;

function textOnlyTelopLayouts(context, text, width, height) {
  const maxWidth = width * 0.76;
  const maxFont = Math.max(14, Math.round(Math.min(width * 0.13, height * 0.42)));
  const layouts = [];
  for (let size = maxFont; size >= MIN_TELOP_FONT_SIZE; size -= 1) {
    context.font = `900 ${size}px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif`;
    const lines = wrapTextForThumbnail(context, text, maxWidth);
    const lineHeight = Math.round(size * 1.15);
    const maxLines = Math.max(1, Math.floor(height * 0.72 / lineHeight));
    if (lines.length <= maxLines) layouts.push({ size, lines, lineHeight });
  }
  return layouts;
}

function opaquePixelCount(canvas) {
  const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 32) count += 1;
  return count;
}

function drawTelopTextLayer(canvas, bounds, layout) {
  const textLayer = document.createElement("canvas");
  textLayer.width = canvas.width;
  textLayer.height = canvas.height;
  const context = textLayer.getContext("2d");
  context.font = `900 ${layout.size}px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.lineWidth = Math.max(1, Math.round(layout.size * 0.075));
  context.strokeStyle = "rgba(25, 12, 17, 0.94)";
  context.fillStyle = "#fffaf2";
  context.shadowColor = "rgba(0, 0, 0, 0.55)";
  context.shadowBlur = Math.max(1, Math.round(layout.size * 0.12));
  const textCenterY = bounds.y + bounds.height / 2;
  layout.lines.forEach((line, index) => {
    const y = textCenterY + (index - (layout.lines.length - 1) / 2) * layout.lineHeight;
    context.strokeText(line, bounds.x + bounds.width / 2, y);
    context.fillText(line, bounds.x + bounds.width / 2, y);
  });
  context.restore();
  return textLayer;
}

function maskTextLayer(textLayer, mask) {
  const maskedLayer = document.createElement("canvas");
  maskedLayer.width = textLayer.width;
  maskedLayer.height = textLayer.height;
  const context = maskedLayer.getContext("2d");
  context.drawImage(textLayer, 0, 0);
  context.globalCompositeOperation = "destination-in";
  context.drawImage(mask, 0, 0);
  return maskedLayer;
}

function findFittingTelopLayer(canvas, mask, text, bounds) {
  const measurementContext = canvas.getContext("2d");
  for (const layout of textOnlyTelopLayouts(measurementContext, text, bounds.width, bounds.height)) {
    const textLayer = drawTelopTextLayer(canvas, bounds, layout);
    const textPixels = opaquePixelCount(textLayer);
    const maskedLayer = maskTextLayer(textLayer, mask);
    const maskedPixels = opaquePixelCount(maskedLayer);
    if (textPixels && maskedPixels === textPixels) return { layout, textLayer: maskedLayer };
  }
  return null;
}

function drawExactTelop(canvas, mask) {
  const text = thumbnailState.production?.images2Brief?.requestedCopy || thumbnailState.review?.source?.requestedCopy || "";
  const bounds = editBounds(canvas.width, canvas.height);
  const fitted = findFittingTelopLayer(canvas, mask, text, bounds);
  if (!fitted) throw new Error("指定テロップをブラシ内へ配置できませんでした。極端に小さい範囲だけは、文字が読める大きさを保つため範囲を広げてください。");
  const panelLayer = document.createElement("canvas");
  panelLayer.width = canvas.width;
  panelLayer.height = canvas.height;
  const panelContext = panelLayer.getContext("2d");
  panelContext.save();
  const panelGradient = panelContext.createLinearGradient(bounds.x, bounds.y, bounds.x, bounds.y + bounds.height);
  panelGradient.addColorStop(0, "rgba(46, 20, 31, 0.36)");
  panelGradient.addColorStop(1, "rgba(14, 10, 15, 0.62)");
  panelContext.fillStyle = panelGradient;
  panelContext.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  panelContext.restore();
  panelContext.globalCompositeOperation = "destination-in";
  panelContext.drawImage(mask, 0, 0);
  canvas.getContext("2d").drawImage(panelLayer, 0, 0);
  canvas.getContext("2d").drawImage(fitted.textLayer, 0, 0);
}

async function compositeEditedRegions(generatedImageDataUrl) {
  const [original, generated] = await Promise.all([thumbnailImage(thumbnailState.imageDataUrl), thumbnailImage(generatedImageDataUrl)]);
  const canvas = document.createElement("canvas");
  canvas.width = thumbnailState.sourceSize?.width || original.naturalWidth;
  canvas.height = thumbnailState.sourceSize?.height || original.naturalHeight;
  const context = canvas.getContext("2d");
  context.drawImage(original, 0, 0, original.naturalWidth, original.naturalHeight, 0, 0, canvas.width, canvas.height);
  const mask = createEditMask(canvas.width, canvas.height);
  const editLayer = document.createElement("canvas");
  editLayer.width = canvas.width;
  editLayer.height = canvas.height;
  const editContext = editLayer.getContext("2d");
  editContext.drawImage(generated, 0, 0, generated.naturalWidth, generated.naturalHeight, 0, 0, canvas.width, canvas.height);
  editContext.globalCompositeOperation = "destination-in";
  editContext.drawImage(mask, 0, 0);
  context.drawImage(editLayer, 0, 0);
  drawExactTelop(canvas, mask);
  return canvas.toDataURL("image/png");
}

async function createTextOnlyThumbnail() {
  return compositeEditedRegions(thumbnailState.imageDataUrl);
}

function showThumbnailFinal(imageDataUrl, alt) {
  thumbnailState.finalImageDataUrl = imageDataUrl;
  const finalPreview = document.getElementById("thumbnailFinalPreview");
  finalPreview.replaceChildren();
  const image = document.createElement("img");
  image.src = imageDataUrl;
  image.alt = alt;
  finalPreview.appendChild(image);
  renderThumbnailQuality();
}

function renderThumbnailQuality() {
  const list = document.getElementById("thumbnailQualityList");
  list.replaceChildren();
  [
    ["faceLock", "顔・表情が元画像のまま"],
    ["logoLock", "AKB48・協業ロゴが正確"],
    ["textAccuracy", "日本語テロップが正確"],
    ["telopQuality", "テロップの質感が商業品質"],
    ["faceOverlap", "顔・目にテロップが被っていない"],
    ["mobileReadability", "スマホ一覧でも主コピーが読める"],
    ["youtubeUiSafety", "右下の再生時間表示に被らない"]
  ].forEach(([key, label]) => {
    const row = thumbnailEl("label", "thumbnailQualityItem");
    const input = document.createElement("input"); input.type = "checkbox"; input.name = key;
    if (key === "textAccuracy" && thumbnailState.finalImageDataUrl) input.checked = true;
    row.append(input, thumbnailEl("span", "", label));
    list.appendChild(row);
  });
  const evaluate = thumbnailEl("button", "secondaryButton", "品質を判定する");
  evaluate.type = "button";
  evaluate.addEventListener("click", evaluateThumbnailQuality);
  list.appendChild(evaluate);
}

async function generateThumbnail() {
  if (!requireAdmin() || !thumbnailState.production) return;
  const result = document.getElementById("thumbnailStatus");
  const generate = document.getElementById("thumbnailGenerate");
  try {
    generate.disabled = true;
    result.className = "infoItem";
    result.textContent = "選択案をImages2.0で高品質化しています。ブラシでなぞった範囲だけを合成し、指定テロップは正確に載せます...";
    const generated = await api("/api/thumbnails/generate", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ originalImage: thumbnailState.imageDataUrl, reviewToken: thumbnailState.reviewToken, candidateId: thumbnailState.selectedCandidateId, outputSize: thumbnailState.sourceSize })
    });
    thumbnailState.generatedImageDataUrl = generated.imageDataUrl;
    showThumbnailFinal(await compositeEditedRegions(generated.imageDataUrl), "AI生成とブラシ指定範囲の合成後のサムネイル");
    result.className = "infoItem";
    result.textContent = "合成が完了しました。最終品質を確認してください。";
  } catch (error) {
    if (error.status === 409) {
      renderThumbnailRegenerationOption(error.message);
    } else if (/safety system|safety_violation|safety violations/i.test(error.message)) {
      renderThumbnailSafetyFallbackOption(error.message);
    } else {
      result.className = "errorItem";
      result.textContent = error.message;
    }
  } finally {
    generate.disabled = Boolean(thumbnailState.finalImageDataUrl) || !thumbnailState.production;
  }
}

function renderThumbnailSafetyFallbackOption(message) {
  const result = document.getElementById("thumbnailStatus");
  result.className = "warningItem thumbnailSafetyFallback";
  result.replaceChildren(document.createTextNode("画像AIの安全判定で編集が停止しました。元画像を変えず、指定テロップだけを合成する代替モードを使えます。"));
  const fallback = thumbnailEl("button", "secondaryButton", "AIなしでテロップを合成する");
  fallback.type = "button";
  fallback.addEventListener("click", async () => {
    fallback.disabled = true;
    try {
      showThumbnailFinal(await createTextOnlyThumbnail(), "元画像にテロップのみを合成したサムネイル");
      result.className = "infoItem";
      result.textContent = "AIを使わず、元画像そのままで指定テロップを合成しました。追加料金はかかりません。最終品質を確認してください。";
    } catch (error) {
      result.className = "errorItem";
      result.textContent = error.message || message;
      fallback.disabled = false;
    }
  });
  result.appendChild(document.createTextNode(" "));
  result.appendChild(fallback);
}

function renderThumbnailRegenerationOption(message) {
  const result = document.getElementById("thumbnailStatus");
  result.className = "warningItem";
  result.replaceChildren(document.createTextNode(`${message} 完成画像がこの画面に残っていないため、今回だけ再生成することもできます。`));
  const retry = thumbnailEl("button", "secondaryButton", "今回だけ再生成する");
  retry.type = "button";
  retry.addEventListener("click", async () => {
    if (!window.confirm("同じ条件で画像をもう一度生成します。OpenAIの画像生成料金が追加で発生する場合があります。続けますか？")) return;
    retry.disabled = true;
    try {
      await api("/api/thumbnails/regenerate", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          originalImage: thumbnailState.imageDataUrl,
          reviewToken: thumbnailState.reviewToken,
          candidateId: thumbnailState.selectedCandidateId
        })
      });
      await generateThumbnail();
    } catch (error) {
      result.className = "errorItem";
      result.textContent = error.message;
      retry.disabled = false;
    }
  });
  result.appendChild(document.createTextNode(" "));
  result.appendChild(retry);
}

async function evaluateThumbnailQuality() {
  const result = document.getElementById("thumbnailStatus");
  try {
    const checks = Object.fromEntries([...document.querySelectorAll("#thumbnailQualityList input")].map((input) => [input.name, input.checked]));
    const quality = await api("/api/thumbnails/quality", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ checks }) });
    const download = document.getElementById("thumbnailDownload");
    download.disabled = quality.status !== "approved_for_export";
    result.className = quality.status === "approved_for_export" ? "infoItem" : "warningItem";
    if (quality.status === "approved_for_export") {
      result.textContent = "公開前品質をすべて通過しました。最終PNGをダウンロードできます。";
    } else {
      result.textContent = `修正が必要です：${quality.fallbacks.join("、")}`;
    }
  } catch (error) {
    result.className = "errorItem";
    result.textContent = error.message;
  }
}

function downloadThumbnail() {
  const link = document.createElement("a");
  link.href = thumbnailState.finalImageDataUrl;
  link.download = `${document.getElementById("thumbnailJobId").value.trim() || "akb-thumbnail"}_FINAL.png`;
  link.click();
}

function loadThumbnailWorkspace() {
  bindThumbnailBrushDrawing();
  const brushSize = document.getElementById("thumbnailBrushSize");
  const brushSizeValue = document.getElementById("thumbnailBrushSizeValue");
  brushSize.oninput = () => {
    thumbnailState.brushSize = Number(brushSize.value) / 100;
    brushSizeValue.value = `${brushSize.value}%`;
    brushSizeValue.textContent = `${brushSize.value}%`;
  };
  document.getElementById("thumbnailClearBrush").onclick = () => {
    thumbnailState.editRegions = [];
    renderThumbnailEditRegions();
  };
  document.getElementById("thumbnailOriginalFile").onchange = () => readThumbnailFile().catch((error) => { document.getElementById("thumbnailStatus").className = "errorItem"; document.getElementById("thumbnailStatus").textContent = error.message; });
  document.getElementById("thumbnailReview").onclick = createThumbnailReview;
  document.querySelectorAll("input[name=thumbnailPreviewMode]").forEach((input) => {
    input.onchange = () => setThumbnailPreviewMode(input.value);
  });
  document.getElementById("thumbnailGeneratePreviews").onclick = generateThumbnailPreviews;
  document.getElementById("thumbnailGenerate").onclick = generateThumbnail;
  document.getElementById("thumbnailDownload").onclick = downloadThumbnail;
  window.addEventListener("resize", resizeBrushCanvas);
  resizeBrushCanvas();
}

window.loadThumbnailWorkspace = loadThumbnailWorkspace;

// director.js runs before this file. Initialize once more when a direct
// link such as /#thumbnail opens this view before the route handler exists.
if (location.hash === "#thumbnail") loadThumbnailWorkspace();
