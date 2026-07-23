const thumbnailState = {
  imageDataUrl: "",
  review: null,
  production: null,
  selectedCandidateId: "",
  protectedRegions: [],
  generatedImageDataUrl: "",
  finalImageDataUrl: ""
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
    const overlay = thumbnailEl("div", "thumbnailRegion");
    overlay.style.left = `${region.x * 100}%`;
    overlay.style.top = `${region.y * 100}%`;
    overlay.style.width = `${region.w * 100}%`;
    overlay.style.height = `${region.h * 100}%`;
    overlay.title = region.name;
    surface.appendChild(overlay);
    const row = thumbnailEl("div", "thumbnailProtectedRow");
    row.append(thumbnailEl("span", "", region.name), thumbnailEl("small", "", region.type === "logo" ? "ロゴ" : "顔・重要部分"));
    const remove = thumbnailEl("button", "textButton", "削除");
    remove.type = "button";
    remove.addEventListener("click", () => {
      thumbnailState.protectedRegions.splice(index, 1);
      renderThumbnailRegions();
    });
    row.appendChild(remove);
    list.appendChild(row);
  });
  if (!thumbnailState.protectedRegions.length) list.appendChild(thumbnailEl("p", "meta", "人物の顔・ロゴをドラッグして保護領域に追加してください。"));
}

function bindThumbnailProtectionDrawing() {
  const surface = document.getElementById("thumbnailPreviewSurface");
  if (!surface || surface.dataset.bound) return;
  surface.dataset.bound = "true";
  let origin = null;
  let draft = null;

  surface.addEventListener("pointerdown", (event) => {
    if (!thumbnailState.imageDataUrl) return;
    origin = normalizedPointer(event, surface);
    draft = thumbnailEl("div", "thumbnailRegion thumbnailRegion--draft");
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
      if (label) thumbnailState.protectedRegions.push({ name: label, type: /ロゴ|logo/i.test(label) ? "logo" : "face", x, y, w, h });
    }
    origin = null;
    draft = null;
    renderThumbnailRegions();
  });
}

function resetThumbnailResult() {
  thumbnailState.review = null;
  thumbnailState.production = null;
  thumbnailState.selectedCandidateId = "";
  thumbnailState.generatedImageDataUrl = "";
  thumbnailState.finalImageDataUrl = "";
  document.getElementById("thumbnailCandidateRail").replaceChildren();
  document.getElementById("thumbnailQualityList").replaceChildren();
  document.getElementById("thumbnailFinalPreview").replaceChildren();
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
  document.getElementById("thumbnailOriginalPreview").src = thumbnailState.imageDataUrl;
  document.getElementById("thumbnailOriginalPreview").hidden = false;
  document.getElementById("thumbnailPreviewHint").hidden = false;
  thumbnailState.protectedRegions = [];
  resetThumbnailResult();
  renderThumbnailRegions();
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
    result.textContent = "元画像を診断し、テーマの異なる5案を作成しています...";
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
    thumbnailState.selectedCandidateId = "";
    result.textContent = "5案を用意しました。1案を選ぶと、選択案だけをImages2.0で生成します。";
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
      body: JSON.stringify({ review: thumbnailState.review, candidateId })
    });
    thumbnailState.production = production;
    thumbnailState.selectedCandidateId = candidateId;
    document.getElementById("thumbnailGenerate").disabled = false;
    result.className = "infoItem";
    result.textContent = `${production.selectedCandidate.name}を選択しました。人物・ロゴは元画像から前面復帰します。`;
    renderThumbnailCandidates();
  } catch (error) {
    result.className = "errorItem";
    result.textContent = error.message;
  }
}

async function compositeProtectedRegions(generatedImageDataUrl) {
  const [original, generated] = await Promise.all([thumbnailImage(thumbnailState.imageDataUrl), thumbnailImage(generatedImageDataUrl)]);
  const canvas = document.createElement("canvas");
  canvas.width = generated.naturalWidth;
  canvas.height = generated.naturalHeight;
  const context = canvas.getContext("2d");
  context.drawImage(generated, 0, 0, canvas.width, canvas.height);
  thumbnailState.protectedRegions.forEach((region) => {
    const x = Math.round(region.x * canvas.width);
    const y = Math.round(region.y * canvas.height);
    const w = Math.round(region.w * canvas.width);
    const h = Math.round(region.h * canvas.height);
    context.drawImage(original, region.x * original.naturalWidth, region.y * original.naturalHeight, region.w * original.naturalWidth, region.h * original.naturalHeight, x, y, w, h);
  });
  return canvas.toDataURL("image/png");
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
    result.textContent = "選択案をImages2.0で高品質化しています。顔・ロゴは直後に元画像へ戻します...";
    const generated = await api("/api/thumbnails/generate", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ originalImage: thumbnailState.imageDataUrl, production: thumbnailState.production })
    });
    thumbnailState.generatedImageDataUrl = generated.imageDataUrl;
    thumbnailState.finalImageDataUrl = await compositeProtectedRegions(generated.imageDataUrl);
    const finalPreview = document.getElementById("thumbnailFinalPreview");
    finalPreview.replaceChildren();
    const image = document.createElement("img"); image.src = thumbnailState.finalImageDataUrl; image.alt = "合成後のサムネイル";
    finalPreview.appendChild(image);
    renderThumbnailQuality();
    result.className = "infoItem";
    result.textContent = "合成が完了しました。最終品質を確認してください。";
  } catch (error) {
    result.className = "errorItem";
    result.textContent = error.message;
  } finally {
    generate.disabled = !thumbnailState.production;
  }
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
  document.getElementById("thumbnailOriginalFile").onchange = () => readThumbnailFile().catch((error) => { document.getElementById("thumbnailStatus").className = "errorItem"; document.getElementById("thumbnailStatus").textContent = error.message; });
  document.getElementById("thumbnailReview").onclick = createThumbnailReview;
  document.getElementById("thumbnailGenerate").onclick = generateThumbnail;
  document.getElementById("thumbnailDownload").onclick = downloadThumbnail;
  renderThumbnailRegions();
}

window.loadThumbnailWorkspace = loadThumbnailWorkspace;
