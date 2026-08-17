const thumbnailState = {
  imageDataUrl: "",
  review: null,
  reviewToken: "",
  production: null,
  selectedCandidateId: "",
  previewMode: "selected-two",
  previewCandidateIds: [],
  previewImages: {},
  protectedRegions: [],
  protectionReport: null,
  captionLayout: null,
  captionReport: null,
  drawingShape: "ellipse",
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

function renderThumbnailRegions() {
  const surface = document.getElementById("thumbnailPreviewSurface");
  const list = document.getElementById("thumbnailProtectedList");
  if (!surface || !list) return;
  surface.querySelectorAll(".thumbnailRegion").forEach((node) => node.remove());
  list.replaceChildren();
  thumbnailState.protectedRegions.forEach((region, index) => {
    const shape = region.shape === "ellipse" ? "ellipse" : "rect";
    const overlay = thumbnailEl("div", `thumbnailRegion thumbnailRegion--${shape}`);
    overlay.style.left = `${region.x * 100}%`;
    overlay.style.top = `${region.y * 100}%`;
    overlay.style.width = `${region.w * 100}%`;
    overlay.style.height = `${region.h * 100}%`;
    overlay.title = region.name;
    surface.appendChild(overlay);
    const row = thumbnailEl("div", "thumbnailProtectedRow");
    const typeLabel = region.type === "logo" ? "ロゴ" : "顔・重要部分";
    row.append(thumbnailEl("span", "", region.name), thumbnailEl("small", "", `${typeLabel}・${shape === "ellipse" ? "楕円" : "四角"}`));
    const remove = thumbnailEl("button", "textButton", "削除");
    remove.type = "button";
    remove.addEventListener("click", () => {
      thumbnailState.protectedRegions.splice(index, 1);
      thumbnailState.captionLayout = null;
      thumbnailState.captionReport = null;
      renderThumbnailRegions();
    });
    row.appendChild(remove);
    list.appendChild(row);
  });
  if (!thumbnailState.protectedRegions.length) list.appendChild(thumbnailEl("p", "meta", "顔は楕円、ロゴや文字は四角を選び、ドラッグして保護領域に追加してください。"));
}

function setThumbnailDrawingShape(shape) {
  thumbnailState.drawingShape = shape === "rect" ? "rect" : "ellipse";
  document.querySelectorAll("[data-thumbnail-shape]").forEach((button) => {
    const active = button.dataset.thumbnailShape === thumbnailState.drawingShape;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function bindThumbnailProtectionDrawing() {
  const surface = document.getElementById("thumbnailPreviewSurface");
  if (!surface || surface.dataset.bound) return;
  surface.dataset.bound = "true";
  let origin = null;
  let draft = null;

  surface.addEventListener("pointerdown", (event) => {
    if (!thumbnailState.imageDataUrl) return;
    event.preventDefault();
    origin = normalizedPointer(event, surface);
    draft = thumbnailEl("div", `thumbnailRegion thumbnailRegion--${thumbnailState.drawingShape} thumbnailRegion--draft`);
    surface.appendChild(draft);
    surface.setPointerCapture(event.pointerId);
  });
  surface.addEventListener("pointermove", (event) => {
    if (!origin || !draft) return;
    const point = normalizedPointer(event, surface);
    const x = Math.min(origin.x, point.x);
    const y = Math.min(origin.y, point.y);
    draft.style.left = `${x * 100}%`;
    draft.style.top = `${y * 100}%`;
    draft.style.width = `${Math.abs(point.x - origin.x) * 100}%`;
    draft.style.height = `${Math.abs(point.y - origin.y) * 100}%`;
  });
  surface.addEventListener("pointerup", (event) => {
    if (!origin || !draft) return;
    const point = normalizedPointer(event, surface);
    const x = Math.min(origin.x, point.x);
    const y = Math.min(origin.y, point.y);
    const w = Math.abs(point.x - origin.x);
    const h = Math.abs(point.y - origin.y);
    draft.remove();
    if (w > 0.03 && h > 0.03) {
      const label = prompt("保護する対象を入力してください（例：中央の顔、右上ロゴ）", "顔");
      if (label) {
        thumbnailState.protectedRegions.push({ name: label, type: /ロゴ|logo/i.test(label) ? "logo" : "face", shape: thumbnailState.drawingShape, x, y, w, h });
        thumbnailState.captionLayout = null;
        thumbnailState.captionReport = null;
      }
    }
    origin = null;
    draft = null;
    renderThumbnailRegions();
  });
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
  thumbnailState.protectionReport = null;
  thumbnailState.captionLayout = null;
  thumbnailState.captionReport = null;
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
  thumbnailState.sourceSize = { width: image.naturalWidth, height: image.naturalHeight };
  document.getElementById("thumbnailOriginalPreview").src = thumbnailState.imageDataUrl;
  document.getElementById("thumbnailOriginalPreview").hidden = false;
  document.getElementById("thumbnailPreviewHint").hidden = false;
  thumbnailState.protectedRegions = [];
  resetThumbnailResult();
  renderThumbnailRegions();
  const status = document.getElementById("thumbnailStatus");
  status.className = "infoItem";
  status.textContent = `「${file.name}」を読み込みました。顔は楕円、ロゴや重要な文字は四角を選んでドラッグで囲んでから、6案を設計してください。`;
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
    result.textContent = "入力したテロップと、指定した保護範囲をもとに6案を作成しています...";
    const review = await api("/api/thumbnails/review", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        jobId: document.getElementById("thumbnailJobId").value.trim(),
        requestedCopy: document.getElementById("thumbnailCopy").value.trim(),
        protectedRegions: thumbnailState.protectedRegions
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
    const captionLayout = getThumbnailCaptionLayoutOrThrow();
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
        outputSize: thumbnailState.sourceSize,
        captionSafeArea: captionLayout.safeArea
      })
    });
    for (const preview of payload.previews || []) {
      thumbnailState.previewImages[preview.candidateId] = await composeThumbnailWithExactCaption(preview.imageDataUrl, captionLayout);
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
    result.textContent = `${production.selectedCandidate.name}を選択しました。保護範囲を避け、指定したテロップ文言を切らずに正確に合成します。`;
    renderThumbnailCandidates();
  } catch (error) {
    result.className = "errorItem";
    result.textContent = error.message;
  }
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function createProtectionMask(width, height, shape) {
  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const context = mask.getContext("2d");
  const feather = Math.max(3, Math.min(18, Math.round(Math.min(width, height) * 0.055)));
  const inset = feather * 1.5;
  context.save();
  context.fillStyle = "white";
  context.filter = `blur(${feather}px)`;
  if (shape === "ellipse") {
    context.beginPath();
    context.ellipse(width / 2, height / 2, Math.max(1, width / 2 - inset), Math.max(1, height / 2 - inset), 0, 0, Math.PI * 2);
    context.fill();
  } else {
    drawRoundedRect(context, inset, inset, Math.max(1, width - inset * 2), Math.max(1, height - inset * 2), Math.min(18, Math.max(4, Math.min(width, height) * 0.12)));
    context.fill();
  }
  context.restore();
  return mask;
}

function expandedProtectionRegion(region, padding) {
  const left = Math.max(0, region.x - padding);
  const top = Math.max(0, region.y - padding);
  const right = Math.min(1, region.x + region.w + padding);
  const bottom = Math.min(1, region.y + region.h + padding);
  return { ...region, x: left, y: top, w: right - left, h: bottom - top };
}

function traceProtectionPath(context, x, y, width, height, shape) {
  context.beginPath();
  if (shape === "ellipse") {
    context.ellipse(x + width / 2, y + height / 2, Math.max(1, width / 2), Math.max(1, height / 2), 0, 0, Math.PI * 2);
  } else {
    drawRoundedRect(context, x, y, width, height, Math.min(18, Math.max(4, Math.min(width, height) * 0.12)));
  }
}

function drawOriginalInsideRegion(context, original, region, canvas) {
  const x = Math.round(region.x * canvas.width);
  const y = Math.round(region.y * canvas.height);
  const w = Math.round(region.w * canvas.width);
  const h = Math.round(region.h * canvas.height);
  if (w < 2 || h < 2) return false;
  context.save();
  traceProtectionPath(context, x, y, w, h, region.shape);
  context.clip();
  // This is intentionally a full, hard restore. The selected face/logo pixels
  // must never be blended with image-model output.
  context.drawImage(original, 0, 0, original.naturalWidth, original.naturalHeight, 0, 0, canvas.width, canvas.height);
  context.restore();
  return true;
}

function compositeProtectedRegion(context, original, region, canvas) {
  const padding = region.type === "face" ? 0.022 : 0.012;
  const outerRegion = expandedProtectionRegion(region, padding);
  const outerX = Math.round(outerRegion.x * canvas.width);
  const outerY = Math.round(outerRegion.y * canvas.height);
  const outerW = Math.round(outerRegion.w * canvas.width);
  const outerH = Math.round(outerRegion.h * canvas.height);
  if (outerW < 2 || outerH < 2) return false;
  const patch = document.createElement("canvas");
  patch.width = outerW;
  patch.height = outerH;
  const patchContext = patch.getContext("2d");
  patchContext.drawImage(original, outerRegion.x * original.naturalWidth, outerRegion.y * original.naturalHeight, outerRegion.w * original.naturalWidth, outerRegion.h * original.naturalHeight, 0, 0, outerW, outerH);
  patchContext.globalCompositeOperation = "destination-in";
  patchContext.drawImage(createProtectionMask(outerW, outerH, outerRegion.shape), 0, 0);
  context.drawImage(patch, outerX, outerY);
  return drawOriginalInsideRegion(context, original, region, canvas);
}

async function compositeProtectedRegions(generatedImageDataUrl) {
  const [original, generated] = await Promise.all([thumbnailImage(thumbnailState.imageDataUrl), thumbnailImage(generatedImageDataUrl)]);
  const canvas = document.createElement("canvas");
  canvas.width = thumbnailState.sourceSize?.width || generated.naturalWidth;
  canvas.height = thumbnailState.sourceSize?.height || generated.naturalHeight;
  const context = canvas.getContext("2d");
  context.drawImage(generated, 0, 0, generated.naturalWidth, generated.naturalHeight, 0, 0, canvas.width, canvas.height);
  const restored = thumbnailState.protectedRegions.filter((region) => compositeProtectedRegion(context, original, region, canvas));
  thumbnailState.protectionReport = {
    restoredCount: restored.length,
    restoredFaceCount: restored.filter((region) => region.type === "face").length,
    restoredLogoCount: restored.filter((region) => region.type === "logo").length
  };
  return canvas.toDataURL("image/png");
}

function thumbnailCaptionText() {
  const text = document.getElementById("thumbnailCopy").value.trim();
  if (!text) throw new Error("変更後のテロップ文言を入力してください。");
  return text;
}

function getThumbnailCaptionLayoutOrThrow() {
  if (!window.ThumbnailCaptionLayout?.createCaptionLayout) {
    throw new Error("テロップの安全領域を計算できませんでした。ページを再読み込みしてください。");
  }
  if (!thumbnailState.sourceSize?.width || !thumbnailState.sourceSize?.height) {
    throw new Error("元サムネイルを読み込んでください。");
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const layout = window.ThumbnailCaptionLayout.createCaptionLayout({
    text: thumbnailCaptionText(),
    width: thumbnailState.sourceSize.width,
    height: thumbnailState.sourceSize.height,
    protectedRegions: thumbnailState.protectedRegions,
    measureText: (line, fontSize) => {
      context.font = `900 ${fontSize}px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif`;
      return context.measureText(line).width;
    }
  });
  thumbnailState.captionLayout = layout;
  return layout;
}

function drawExactThumbnailCaption(context, layout) {
  const { textBounds, fontSize, lineHeight, lines } = layout;
  const centerX = textBounds.x + textBounds.w / 2;
  const firstY = textBounds.y + (textBounds.h - lines.length * lineHeight) / 2 + lineHeight / 2;
  context.save();
  context.font = `900 ${fontSize}px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.lineWidth = Math.max(3, Math.round(fontSize * 0.075));
  context.strokeStyle = "rgba(67, 18, 48, 0.92)";
  context.shadowColor = "rgba(34, 14, 25, 0.48)";
  context.shadowBlur = Math.max(3, Math.round(fontSize * 0.11));
  context.shadowOffsetY = Math.max(1, Math.round(fontSize * 0.045));
  lines.forEach((line, index) => context.strokeText(line, centerX, firstY + index * lineHeight));
  const fill = context.createLinearGradient(0, textBounds.y, 0, textBounds.y + textBounds.h);
  fill.addColorStop(0, "#ffffff");
  fill.addColorStop(0.52, "#fff6f7");
  fill.addColorStop(1, "#ffd6e2");
  context.fillStyle = fill;
  lines.forEach((line, index) => context.fillText(line, centerX, firstY + index * lineHeight));
  context.restore();
}

async function composeThumbnailWithExactCaption(generatedImageDataUrl, suppliedLayout) {
  const [original, generated] = await Promise.all([thumbnailImage(thumbnailState.imageDataUrl), thumbnailImage(generatedImageDataUrl)]);
  const canvas = document.createElement("canvas");
  canvas.width = thumbnailState.sourceSize?.width || generated.naturalWidth;
  canvas.height = thumbnailState.sourceSize?.height || generated.naturalHeight;
  const context = canvas.getContext("2d");
  context.drawImage(generated, 0, 0, generated.naturalWidth, generated.naturalHeight, 0, 0, canvas.width, canvas.height);
  const restored = thumbnailState.protectedRegions.filter((region) => compositeProtectedRegion(context, original, region, canvas));
  const layout = suppliedLayout || getThumbnailCaptionLayoutOrThrow();
  drawExactThumbnailCaption(context, layout);
  thumbnailState.protectionReport = {
    restoredCount: restored.length,
    restoredFaceCount: restored.filter((region) => region.type === "face").length,
    restoredLogoCount: restored.filter((region) => region.type === "logo").length
  };
  thumbnailState.captionReport = {
    requestedCopy: layout.text,
    renderedCopy: layout.lines.join(""),
    fullText: layout.lines.join("") === layout.text,
    hasCollision: layout.hasCollision,
    mobileReadable: layout.mobileReadable,
    youtubeUiSafe: layout.youtubeUiSafe,
    lineCount: layout.lines.length
  };
  return canvas.toDataURL("image/png");
}

async function createTextOnlyThumbnail() {
  return composeThumbnailWithExactCaption(thumbnailState.imageDataUrl);
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
    if (key === "faceLock" && thumbnailState.protectionReport?.restoredFaceCount > 0) input.checked = true;
    if (key === "logoLock" && thumbnailState.protectionReport?.restoredLogoCount > 0) input.checked = true;
    if (key === "textAccuracy" && thumbnailState.captionReport?.fullText) input.checked = true;
    if (key === "faceOverlap" && thumbnailState.captionReport && !thumbnailState.captionReport.hasCollision) input.checked = true;
    if (key === "mobileReadability" && thumbnailState.captionReport?.mobileReadable) input.checked = true;
    if (key === "youtubeUiSafety" && thumbnailState.captionReport?.youtubeUiSafe) input.checked = true;
    row.append(input, thumbnailEl("span", "", label));
    list.appendChild(row);
  });
  const evaluate = thumbnailEl("button", "secondaryButton", "品質を判定する");
  evaluate.type = "button";
  evaluate.addEventListener("click", evaluateThumbnailQuality);
  list.appendChild(evaluate);
}

async function restoreProtectedRegionsWithoutGeneration() {
  const result = document.getElementById("thumbnailStatus");
  if (!thumbnailState.finalImageDataUrl) return;
  try {
    result.className = "infoItem";
    result.textContent = "指定した保護範囲を元画像から完全に再復元しています。画像生成は行いません...";
    const source = thumbnailState.generatedImageDataUrl || thumbnailState.imageDataUrl;
    showThumbnailFinal(await composeThumbnailWithExactCaption(source), "保護範囲を元画像から再復元したサムネイル");
    result.className = "infoItem";
    result.textContent = "指定した保護範囲を元画像から完全に再復元しました。追加料金はかかりません。顔・表情の項目を確認して、もう一度品質を判定してください。";
  } catch (error) {
    result.className = "errorItem";
    result.textContent = error.message;
  }
}

async function generateThumbnail() {
  if (!requireAdmin() || !thumbnailState.production) return;
  const result = document.getElementById("thumbnailStatus");
  const generate = document.getElementById("thumbnailGenerate");
  try {
    const captionLayout = getThumbnailCaptionLayoutOrThrow();
    generate.disabled = true;
    result.className = "infoItem";
    result.textContent = "選択案をImages2.0で高品質化しています。指定した保護範囲は直後に元画像へ戻します...";
    const generated = await api("/api/thumbnails/generate", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        originalImage: thumbnailState.imageDataUrl,
        reviewToken: thumbnailState.reviewToken,
        candidateId: thumbnailState.selectedCandidateId,
        outputSize: thumbnailState.sourceSize,
        captionSafeArea: captionLayout.safeArea
      })
    });
    thumbnailState.generatedImageDataUrl = generated.imageDataUrl;
    showThumbnailFinal(await composeThumbnailWithExactCaption(generated.imageDataUrl, captionLayout), "AI生成と保護領域合成後のサムネイル");
    result.className = "infoItem";
    result.textContent = "合成が完了しました。指定テロップは保護範囲と右下表示を避け、切らずに合成しています。最終品質を確認してください。";
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
    } else if (quality.fallbacks.includes("restore_original_faces") && thumbnailState.finalImageDataUrl) {
      result.replaceChildren(document.createTextNode(`修正が必要です：${quality.fallbacks.join("、")}。`));
      const restore = thumbnailEl("button", "secondaryButton", "保護範囲を元画像から再復元する");
      restore.type = "button";
      restore.addEventListener("click", restoreProtectedRegionsWithoutGeneration);
      result.append(document.createTextNode(" "), restore);
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
  bindThumbnailProtectionDrawing();
  document.querySelectorAll("[data-thumbnail-shape]").forEach((button) => {
    button.onclick = () => setThumbnailDrawingShape(button.dataset.thumbnailShape);
  });
  setThumbnailDrawingShape(thumbnailState.drawingShape);
  document.getElementById("thumbnailOriginalFile").onchange = () => readThumbnailFile().catch((error) => { document.getElementById("thumbnailStatus").className = "errorItem"; document.getElementById("thumbnailStatus").textContent = error.message; });
  document.getElementById("thumbnailReview").onclick = createThumbnailReview;
  document.querySelectorAll("input[name=thumbnailPreviewMode]").forEach((input) => {
    input.onchange = () => setThumbnailPreviewMode(input.value);
  });
  document.getElementById("thumbnailGeneratePreviews").onclick = generateThumbnailPreviews;
  document.getElementById("thumbnailGenerate").onclick = generateThumbnail;
  document.getElementById("thumbnailDownload").onclick = downloadThumbnail;
  renderThumbnailRegions();
}

window.loadThumbnailWorkspace = loadThumbnailWorkspace;

// director.js runs before this file. Initialize once more when a direct
// link such as /#thumbnail opens this view before the route handler exists.
if (location.hash === "#thumbnail") loadThumbnailWorkspace();
