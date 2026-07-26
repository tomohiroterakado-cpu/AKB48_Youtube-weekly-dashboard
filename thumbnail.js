const thumbnailState = {
  imageDataUrl: "",
  review: null,
  reviewToken: "",
  production: null,
  selectedCandidateId: "",
  protectedRegions: [],
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
      if (label) thumbnailState.protectedRegions.push({ name: label, type: /ロゴ|logo/i.test(label) ? "logo" : "face", shape: thumbnailState.drawingShape, x, y, w, h });
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
  thumbnailState.generatedImageDataUrl = "";
  thumbnailState.finalImageDataUrl = "";
  document.getElementById("thumbnailCandidateRail").replaceChildren();
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
    const card = thumbnailEl("article", `thumbnailCandidate ${thumbnailState.selectedCandidateId === candidate.id ? "selected" : ""}`.trim());
    card.append(thumbnailEl("strong", "thumbnailCandidateId", candidate.id), thumbnailEl("h3", "", candidate.name), thumbnailEl("p", "", candidate.purpose), thumbnailEl("p", "meta", candidate.recommendedCopy));
    const choose = thumbnailEl("button", thumbnailState.selectedCandidateId === candidate.id ? "primaryButton" : "secondaryButton", thumbnailState.selectedCandidateId === candidate.id ? "選択中" : "この案を選ぶ");
    choose.type = "button";
    choose.addEventListener("click", () => selectThumbnailCandidate(candidate.id));
    card.appendChild(choose);
    rail.appendChild(card);
  });
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
    thumbnailState.selectedCandidateId = "";
    result.textContent = "6案を用意しました。1案を選ぶと、選択案だけをImages2.0で生成します。";
    renderThumbnailCandidates();
  } catch (error) {
    result.className = "errorItem";
    result.textContent = error.message;
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
    result.textContent = `${production.selectedCandidate.name}を選択しました。指定した保護範囲は生成後に境界をなじませて元画像から前面復帰します。`;
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
  const feather = Math.max(2, Math.min(10, Math.round(Math.min(width, height) * 0.028)));
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

function expandedFaceProtection(region) {
  if (region.type !== "face") return region;
  const padX = Math.max(0.035, Math.min(0.18, region.w * 0.8));
  const padY = Math.max(0.05, Math.min(0.22, region.h * 0.8));
  const left = Math.max(0, region.x - padX);
  const top = Math.max(0, region.y - padY);
  const right = Math.min(1, region.x + region.w + padX);
  const bottom = Math.min(1, region.y + region.h + padY);
  return { ...region, name: `${region.name}（人物保護拡張）`, shape: "rect", x: left, y: top, w: right - left, h: bottom - top };
}

function compositeProtectedRegion(context, original, region, canvas) {
  const protectedRegion = expandedFaceProtection(region);
  const x = Math.round(protectedRegion.x * canvas.width);
  const y = Math.round(protectedRegion.y * canvas.height);
  const w = Math.round(protectedRegion.w * canvas.width);
  const h = Math.round(protectedRegion.h * canvas.height);
  if (w < 2 || h < 2) return;
  const patch = document.createElement("canvas");
  patch.width = w;
  patch.height = h;
  const patchContext = patch.getContext("2d");
  patchContext.drawImage(original, protectedRegion.x * original.naturalWidth, protectedRegion.y * original.naturalHeight, protectedRegion.w * original.naturalWidth, protectedRegion.h * original.naturalHeight, 0, 0, w, h);
  patchContext.globalCompositeOperation = "destination-in";
  patchContext.drawImage(createProtectionMask(w, h, protectedRegion.shape), 0, 0);
  context.drawImage(patch, x, y);
}

async function compositeProtectedRegions(generatedImageDataUrl) {
  const [original, generated] = await Promise.all([thumbnailImage(thumbnailState.imageDataUrl), thumbnailImage(generatedImageDataUrl)]);
  const canvas = document.createElement("canvas");
  canvas.width = thumbnailState.sourceSize?.width || generated.naturalWidth;
  canvas.height = thumbnailState.sourceSize?.height || generated.naturalHeight;
  const context = canvas.getContext("2d");
  context.drawImage(generated, 0, 0, generated.naturalWidth, generated.naturalHeight, 0, 0, canvas.width, canvas.height);
  thumbnailState.protectedRegions.forEach((region) => compositeProtectedRegion(context, original, region, canvas));
  return canvas.toDataURL("image/png");
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

function textOnlyTelopLayout(context, text, width, height) {
  const maxWidth = width * 0.88;
  const maxFont = Math.round(Math.min(width * 0.067, height * 0.105));
  const minFont = Math.max(28, Math.round(width * 0.028));
  for (let size = maxFont; size >= minFont; size -= 2) {
    context.font = `900 ${size}px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif`;
    const lines = wrapTextForThumbnail(context, text, maxWidth);
    if (lines.length <= 2) return { size, lines };
  }
  context.font = `900 ${minFont}px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif`;
  return { size: minFont, lines: wrapTextForThumbnail(context, text, maxWidth) };
}

async function createTextOnlyThumbnail() {
  const original = await thumbnailImage(thumbnailState.imageDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = thumbnailState.sourceSize?.width || original.naturalWidth;
  canvas.height = thumbnailState.sourceSize?.height || original.naturalHeight;
  const context = canvas.getContext("2d");
  context.drawImage(original, 0, 0, original.naturalWidth, original.naturalHeight, 0, 0, canvas.width, canvas.height);

  const text = document.getElementById("thumbnailCopy").value.trim();
  const layout = textOnlyTelopLayout(context, text, canvas.width, canvas.height);
  const lineHeight = Math.round(layout.size * 1.15);
  const panelHeight = Math.max(Math.round(canvas.height * 0.18), lineHeight * layout.lines.length + Math.round(canvas.height * 0.075));
  const panelY = canvas.height - panelHeight - Math.round(canvas.height * 0.035);
  const panelX = Math.round(canvas.width * 0.035);
  const panelWidth = canvas.width - panelX * 2;

  context.save();
  const panelGradient = context.createLinearGradient(0, panelY, 0, panelY + panelHeight);
  panelGradient.addColorStop(0, "rgba(35, 23, 29, 0.86)");
  panelGradient.addColorStop(1, "rgba(18, 14, 18, 0.92)");
  context.fillStyle = panelGradient;
  drawRoundedRect(context, panelX, panelY, panelWidth, panelHeight, Math.round(canvas.height * 0.025));
  context.fill();
  context.font = `900 ${layout.size}px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.lineWidth = Math.max(3, Math.round(layout.size * 0.075));
  context.strokeStyle = "rgba(25, 12, 17, 0.92)";
  context.fillStyle = "#fffaf2";
  context.shadowColor = "rgba(0, 0, 0, 0.5)";
  context.shadowBlur = Math.max(4, Math.round(layout.size * 0.12));
  const textCenterY = panelY + panelHeight / 2;
  layout.lines.forEach((line, index) => {
    const y = textCenterY + (index - (layout.lines.length - 1) / 2) * lineHeight;
    context.strokeText(line, canvas.width / 2, y);
    context.fillText(line, canvas.width / 2, y);
  });
  context.restore();

  thumbnailState.protectedRegions.forEach((region) => compositeProtectedRegion(context, original, region, canvas));
  return canvas.toDataURL("image/png");
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
    result.textContent = "選択案をImages2.0で高品質化しています。指定した保護範囲は直後に元画像へ戻します...";
    const generated = await api("/api/thumbnails/generate", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ originalImage: thumbnailState.imageDataUrl, reviewToken: thumbnailState.reviewToken, candidateId: thumbnailState.selectedCandidateId, outputSize: thumbnailState.sourceSize })
    });
    thumbnailState.generatedImageDataUrl = generated.imageDataUrl;
    showThumbnailFinal(await compositeProtectedRegions(generated.imageDataUrl), "AI生成と保護領域合成後のサムネイル");
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
    result.textContent = quality.status === "approved_for_export"
      ? "公開前品質をすべて通過しました。最終PNGをダウンロードできます。"
      : `修正が必要です：${quality.fallbacks.join("、")}`;
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
  document.getElementById("thumbnailGenerate").onclick = generateThumbnail;
  document.getElementById("thumbnailDownload").onclick = downloadThumbnail;
  renderThumbnailRegions();
}

window.loadThumbnailWorkspace = loadThumbnailWorkspace;

// director.js runs before this file. Initialize once more when a direct
// link such as /#thumbnail opens this view before the route handler exists.
if (location.hash === "#thumbnail") loadThumbnailWorkspace();
