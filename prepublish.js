const PREPUBLISH_DB_NAME = "akb-ai-director-prepublish";
const PREPUBLISH_STORE = "drafts";
const PREPUBLISH_DRAFT_KEY = "current";
const PREPUBLISH_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PREPUBLISH_TEXT_FIELDS = [
  "prepublishVideoContent",
  "prepublishCast",
  "prepublishHighlights",
  "prepublishChannel",
  "prepublishSeriesName",
  "prepublishEpisode",
  "prepublishTargetAudience",
  "prepublishCurrentTitle"
];

const prepublishState = {
  initialized: false,
  restored: false,
  thumbnailBlob: null,
  thumbnailName: "",
  thumbnailUrl: "",
  saveTimer: null,
  generating: false
};

function prepublishEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function openPrepublishDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("このブラウザでは一時保存を利用できません。"));
      return;
    }
    const request = indexedDB.open(PREPUBLISH_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PREPUBLISH_STORE)) database.createObjectStore(PREPUBLISH_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withPrepublishStore(mode, operation) {
  const database = await openPrepublishDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(PREPUBLISH_STORE, mode);
    const store = transaction.objectStore(PREPUBLISH_STORE);
    const request = operation(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

function prepublishValues() {
  return Object.fromEntries(PREPUBLISH_TEXT_FIELDS.map((id) => [id, document.getElementById(id).value]));
}

function draftStatus(text, kind = "") {
  const status = document.getElementById("prepublishDraftStatus");
  status.textContent = text;
  status.className = `draftStatus ${kind}`.trim();
}

async function savePrepublishDraft() {
  const draft = {
    values: prepublishValues(),
    thumbnailBlob: prepublishState.thumbnailBlob,
    thumbnailName: prepublishState.thumbnailName,
    savedAt: new Date().toISOString()
  };
  try {
    await withPrepublishStore("readwrite", (store) => store.put(draft, PREPUBLISH_DRAFT_KEY));
    const time = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date());
    draftStatus(`一時保存済み ${time}（このブラウザのみ）`, "saved");
  } catch {
    localStorage.setItem("akb-prepublish-text-draft", JSON.stringify({ values: draft.values, savedAt: draft.savedAt }));
    draftStatus("テキストのみ一時保存済み", "saved");
  }
}

function schedulePrepublishDraftSave() {
  draftStatus("一時保存中…", "saving");
  clearTimeout(prepublishState.saveTimer);
  prepublishState.saveTimer = setTimeout(savePrepublishDraft, 450);
}

function setThumbnailPreview(blob, name = "") {
  if (prepublishState.thumbnailUrl) URL.revokeObjectURL(prepublishState.thumbnailUrl);
  prepublishState.thumbnailBlob = blob || null;
  prepublishState.thumbnailName = name || "";
  prepublishState.thumbnailUrl = blob ? URL.createObjectURL(blob) : "";
  const preview = document.getElementById("prepublishThumbnailPreview");
  const empty = document.getElementById("prepublishThumbnailEmpty");
  const meta = document.getElementById("prepublishThumbnailMeta");
  if (!blob) {
    preview.hidden = true;
    preview.removeAttribute("src");
    empty.hidden = false;
    meta.textContent = "推奨 16:9 / 1280×720px以上";
    return;
  }
  preview.src = prepublishState.thumbnailUrl;
  preview.hidden = false;
  empty.hidden = true;
  meta.textContent = `${name || "画像"} / ${(blob.size / 1024 / 1024).toFixed(1)}MB`;
}

async function restorePrepublishDraft() {
  if (prepublishState.restored) return;
  prepublishState.restored = true;
  let draft = null;
  try {
    draft = await withPrepublishStore("readonly", (store) => store.get(PREPUBLISH_DRAFT_KEY));
  } catch {
    const fallback = localStorage.getItem("akb-prepublish-text-draft");
    if (fallback) draft = JSON.parse(fallback);
  }
  if (!draft) return;
  Object.entries(draft.values || {}).forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (input) input.value = value;
  });
  if (draft.thumbnailBlob instanceof Blob) setThumbnailPreview(draft.thumbnailBlob, draft.thumbnailName);
  draftStatus("一時保存した入力を復元しました", "saved");
}

function validatePrepublishFile(file) {
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("サムネイルはJPEG・PNG・WebPで選択してください。");
  if (file.size > PREPUBLISH_MAX_IMAGE_BYTES) throw new Error("サムネイルは8MB以下にしてください。");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("サムネイルを読み込めませんでした。"));
    reader.readAsDataURL(file);
  });
}

function scoreClass(score) {
  if (score >= 95) return "eligible";
  if (score >= 90) return "near";
  return "";
}

function renderAbTests(items) {
  const list = document.getElementById("prepublishAbTests");
  list.replaceChildren();
  items.forEach((item) => {
    const row = prepublishEl("article", "abTestRow");
    row.append(
      prepublishEl("span", "abLabel", item.label),
      prepublishEl("div", "abTestCopy"),
      prepublishEl("strong", `abScore ${scoreClass(item.score)}`, `${item.score}点`)
    );
    const copy = row.querySelector(".abTestCopy");
    copy.append(
      prepublishEl("h3", "", item.title),
      prepublishEl("p", "meta", `CTR予想 ${item.ctrPrediction} / ${item.target}`),
      prepublishEl("p", "abHypothesis", item.hypothesis)
    );
    list.appendChild(row);
  });
}

function renderTopFive(items) {
  const list = document.getElementById("prepublishTopFive");
  list.replaceChildren();
  items.forEach((item) => {
    const row = prepublishEl("article", "topFiveRow");
    row.append(
      prepublishEl("span", "topFiveRank", String(item.rank)),
      prepublishEl("div", "topFiveCopy"),
      prepublishEl("strong", `topFiveScore ${scoreClass(item.score)}`, `${item.score}点`)
    );
    const copy = row.querySelector(".topFiveCopy");
    copy.append(
      prepublishEl("h3", "", item.title),
      prepublishEl("p", "meta", `元案 ${item.sourceRank}位から再設計`),
      prepublishEl("p", "", item.refinement)
    );
    list.appendChild(row);
  });
}

function breakdownRow(label, score, maximum) {
  const row = prepublishEl("div", "breakdownRow");
  row.append(prepublishEl("span", "", label), prepublishEl("strong", "", `${score}/${maximum}`));
  return row;
}

function renderCandidate(candidate) {
  const details = prepublishEl("details", `candidateRow ${scoreClass(candidate.score)}`);
  const summary = prepublishEl("summary", "");
  summary.append(
    prepublishEl("span", "candidateRank", String(candidate.rank)),
    prepublishEl("strong", "candidateTitle", candidate.title),
    prepublishEl("span", "candidateScore", `${candidate.score}点`),
    prepublishEl("span", "candidateCtr", candidate.ctrPrediction)
  );
  details.appendChild(summary);
  const body = prepublishEl("div", "candidateDetails");
  const breakdown = prepublishEl("div", "scoreBreakdown");
  [
    ["CTR", candidate.breakdown.ctr, 40],
    ["内容一致", candidate.breakdown.contentMatch, 20],
    ["スマホ視認性", candidate.breakdown.mobileVisibility, 10],
    ["感情ワード", candidate.breakdown.emotionWord, 10],
    ["新規性", candidate.breakdown.novelty, 10],
    ["シリーズ感", candidate.breakdown.seriesConsistency, 10]
  ].forEach((item) => breakdown.appendChild(breakdownRow(...item)));
  const reviews = prepublishEl("div", "perspectiveReviews");
  candidate.perspectives.forEach((item) => {
    const review = prepublishEl("article", "perspectiveReview");
    review.append(
      prepublishEl("div", "perspectiveHeading"),
      prepublishEl("p", "", item.conclusion)
    );
    const heading = review.querySelector(".perspectiveHeading");
    heading.append(prepublishEl("strong", "", item.label), prepublishEl("span", "", `${item.score}点`));
    reviews.appendChild(review);
  });
  const decision = prepublishEl("div", "candidateDecision");
  decision.append(
    prepublishEl("strong", "", candidate.adoptionEligible ? "採用候補" : "改善が必要"),
    prepublishEl("p", "", candidate.adoptionReason),
    prepublishEl("p", "meta", `想定ターゲット: ${candidate.target}`)
  );
  body.append(breakdown, reviews, decision);
  details.appendChild(body);
  return details;
}

function renderCandidates(items) {
  const list = document.getElementById("prepublishCandidates");
  list.replaceChildren(...items.map(renderCandidate));
  const eligible = items.filter((item) => item.adoptionEligible).length;
  document.getElementById("prepublishEligibleCount").textContent = `採用候補 ${eligible} / 30`;
}

function renderPrepublishResults(result) {
  const winner = result.finalRecommendation;
  document.getElementById("prepublishWinnerTitle").textContent = winner.title;
  document.getElementById("prepublishWinnerScore").textContent = `${winner.score}点`;
  document.getElementById("prepublishWinnerCtr").textContent = winner.ctrPrediction;
  document.getElementById("prepublishWinnerTarget").textContent = winner.target;
  document.getElementById("prepublishWinnerReason").textContent = winner.adoptionReason;

  renderAbTests(result.abTests || []);
  document.getElementById("prepublishThumbnailFitScore").textContent = `${result.thumbnailFit.score}点`;
  document.getElementById("prepublishOverlapLevel").textContent = result.thumbnailFit.overlapLevel;
  document.getElementById("prepublishSynergy").textContent = result.thumbnailFit.synergy;
  document.getElementById("prepublishThumbnailImprovement").textContent = result.thumbnailFit.improvement;
  const duplicates = document.getElementById("prepublishDuplicateElements");
  duplicates.replaceChildren();
  (result.thumbnailFit.duplicateElements || []).forEach((text) => duplicates.appendChild(prepublishEl("span", "", `重複: ${text}`)));
  if (!result.thumbnailFit.duplicateElements?.length) duplicates.appendChild(prepublishEl("span", "noDuplicate", "目立つ情報重複なし"));

  document.getElementById("prepublishDescription").textContent = result.youtubeDescription;
  document.getElementById("prepublishXPost").textContent = result.xPost;
  renderTopFive(result.topFive || []);
  renderCandidates(result.candidates || []);
  const improvements = document.getElementById("prepublishImprovements");
  improvements.replaceChildren(...(result.improvements || []).map((text) => prepublishEl("li", "", text)));

  document.getElementById("prepublishResults").hidden = false;
  document.getElementById("prepublishResults").scrollIntoView({ behavior: "smooth", block: "start" });
}

function setPrepublishGenerating(active) {
  prepublishState.generating = active;
  document.getElementById("prepublishProgress").hidden = !active;
  document.querySelectorAll(".prepublishGenerateButton").forEach((button) => {
    button.disabled = active;
    button.textContent = active ? "レビュー生成中…" : button.id === "prepublishGenerateTop" ? "30案を生成してレビュー" : "30案を生成して公開前レビュー";
  });
}

async function generatePrepublishReviewFromForm(event) {
  event?.preventDefault();
  if (prepublishState.generating || !requireAdmin()) return;
  const errorBox = document.getElementById("prepublishError");
  errorBox.hidden = true;
  if (!prepublishState.thumbnailBlob) {
    errorBox.textContent = "サムネイル画像を選択してください。";
    errorBox.hidden = false;
    return;
  }
  setPrepublishGenerating(true);
  try {
    await savePrepublishDraft();
    const payload = {
      thumbnailDataUrl: await fileToDataUrl(prepublishState.thumbnailBlob),
      videoContent: document.getElementById("prepublishVideoContent").value,
      cast: document.getElementById("prepublishCast").value,
      highlights: document.getElementById("prepublishHighlights").value,
      channel: document.getElementById("prepublishChannel").value,
      seriesName: document.getElementById("prepublishSeriesName").value,
      episode: document.getElementById("prepublishEpisode").value,
      targetAudience: document.getElementById("prepublishTargetAudience").value,
      currentTitle: document.getElementById("prepublishCurrentTitle").value
    };
    const result = await api("/api/prepublish-reviews/generate", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(payload)
    });
    renderPrepublishResults(result);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
  } finally {
    setPrepublishGenerating(false);
  }
}

async function copyPrepublishText(button) {
  const target = document.getElementById(button.dataset.copyTarget);
  try {
    await navigator.clipboard.writeText(target.textContent);
    const original = button.textContent;
    button.textContent = "コピー済み";
    setTimeout(() => { button.textContent = original; }, 1_500);
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function initializePrepublishWorkspace() {
  if (prepublishState.initialized) return;
  prepublishState.initialized = true;
  const fileInput = document.getElementById("prepublishThumbnailFile");
  fileInput.addEventListener("change", () => {
    try {
      const file = fileInput.files[0];
      validatePrepublishFile(file);
      if (!file) return;
      setThumbnailPreview(file, file.name);
      schedulePrepublishDraftSave();
    } catch (error) {
      fileInput.value = "";
      document.getElementById("prepublishError").textContent = error.message;
      document.getElementById("prepublishError").hidden = false;
    }
  });
  document.getElementById("prepublishThumbnailChange").addEventListener("click", () => fileInput.click());
  PREPUBLISH_TEXT_FIELDS.forEach((id) => document.getElementById(id).addEventListener("input", schedulePrepublishDraftSave));
  document.getElementById("prepublishForm").addEventListener("submit", generatePrepublishReviewFromForm);
  document.getElementById("prepublishGenerateTop").addEventListener("click", () => document.getElementById("prepublishForm").requestSubmit());
  document.querySelectorAll("[data-copy-target]").forEach((button) => button.addEventListener("click", () => copyPrepublishText(button)));
}

window.loadPrepublishWorkspace = async function loadPrepublishWorkspace() {
  initializePrepublishWorkspace();
  await restorePrepublishDraft();
};

initializePrepublishWorkspace();
