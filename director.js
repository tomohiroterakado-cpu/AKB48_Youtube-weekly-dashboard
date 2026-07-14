const ADMIN_TOKEN_KEY = "akb-ai-director-admin-token";
const directorState = { previewPayload: null, reviewVideos: [], videos: [], selectedVideoId: "", masters: { members: [], categories: [] }, adminToken: sessionStorage.getItem(ADMIN_TOKEN_KEY) || "" };

function directorEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function adminHeaders() {
  return { "Content-Type": "application/json", "X-Admin-Token": directorState.adminToken };
}

function updateAdminControls() {
  const loggedIn = Boolean(directorState.adminToken);
  document.getElementById("adminModeStatus").textContent = loggedIn ? "管理モード" : "閲覧モード";
  document.getElementById("adminModeStatus").classList.toggle("active", loggedIn);
  document.getElementById("openAdminLogin").hidden = loggedIn;
  document.getElementById("adminLogout").hidden = !loggedIn;
}

function openAdminLogin(message = "") {
  const dialog = document.getElementById("adminLoginDialog");
  const error = document.getElementById("adminLoginError");
  error.hidden = !message;
  error.textContent = message;
  if (!dialog.open) dialog.showModal();
  document.getElementById("adminToken").focus();
}

function closeAdminLogin() {
  const dialog = document.getElementById("adminLoginDialog");
  if (dialog.open) dialog.close();
}

function requireAdmin() {
  if (directorState.adminToken) return true;
  openAdminLogin("この操作には管理モードへのログインが必要です。");
  return false;
}

async function api(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `通信に失敗しました (${response.status})`);
  return payload;
}

function showRoute(route) {
  const resolved = document.querySelector(`[data-director-view="${route}"]`) ? route : "home";
  document.querySelectorAll("[data-director-view]").forEach((view) => { view.hidden = view.dataset.directorView !== resolved; });
  document.querySelectorAll("[data-route]").forEach((button) => button.classList.toggle("active", button.dataset.route === resolved));
  if (location.hash !== `#${resolved}`) history.replaceState(null, "", `#${resolved}`);
  if (resolved === "home") loadHome();
  if (resolved === "review") loadReviews();
  if (resolved === "masters") loadMasters();
  if (resolved === "director") loadDirectorReport();
}

async function loadDirectorReport() {
  const container = document.getElementById("directorReport");
  container.replaceChildren(directorEl("p", "meta", "週次データを集計しています..."));
  try {
    const report = await api("/api/ai-director");
    container.replaceChildren();
    const summary = directorEl("div", "directorSummary");
    summary.append(directorEl("span", "ideaPriority", report.status), directorEl("h2", "", report.period || "対象期間なし"), directorEl("p", "meta", `信頼度 ${report.confidence.level} / ${report.confidence.reason}`));
    container.appendChild(summary);
    const facts = directorEl("section", "directorReportSection"); facts.appendChild(directorEl("h2", "", "事実・集計結果"));
    const factGrid = directorEl("div", "factGrid");
    (report.facts || []).forEach((fact) => { const card = directorEl("article", "factCard"); card.append(directorEl("span", "sectionLabel", "事実"), directorEl("strong", "", fact.label), directorEl("p", "", fact.video), directorEl("b", "", fact.value), directorEl("small", "", fact.source)); factGrid.appendChild(card); });
    facts.appendChild(factGrid); container.appendChild(facts);
    const interpretations = directorEl("section", "directorReportSection"); interpretations.appendChild(directorEl("h2", "", "AIによる解釈"));
    (report.interpretations || []).forEach((item) => interpretations.appendChild(directorEl("p", "warningItem", `${item.text} / 根拠: ${item.evidence}`)));
    if (!(report.interpretations || []).length) interpretations.appendChild(directorEl("p", "emptyState", "解釈はまだ生成されていません。"));
    container.appendChild(interpretations);
    const ideas = directorEl("section", "directorReportSection"); ideas.appendChild(directorEl("h2", "", "AIによる企画案"));
    (report.ideas || []).forEach((item) => ideas.appendChild(directorEl("p", "infoItem", `${item.text} / ${item.kind}`)));
    container.appendChild(ideas);
  } catch (error) { container.replaceChildren(directorEl("p", "errorItem", error.message)); }
}

function statusCard(label, value, note, tone = "") {
  const card = directorEl("article", `statusCard ${tone}`.trim());
  card.append(directorEl("span", "statusLabel", label), directorEl("strong", "statusValue", value), directorEl("span", "statusNote", note));
  return card;
}

async function loadHome() {
  const container = document.getElementById("workflowStatus");
  const warnings = document.getElementById("homeWarnings");
  container.replaceChildren(statusCard("読込中", "...", "最新状態を確認しています"));
  warnings.replaceChildren();
  try {
    const state = await api("/api/home");
    container.replaceChildren(
      statusCard("最新CSV", state.latestImport ? `${state.latestImport.periodStart}〜${state.latestImport.periodEnd}` : "未取込", state.latestImport?.fileName || "CSVをアップロードしてください"),
      statusCard("未確認動画", String(state.unconfirmedVideoCount), state.unconfirmedVideoCount ? "確認が必要です" : "すべて確認済み", state.unconfirmedVideoCount ? "attention" : "good"),
      statusCard("登録動画", String(state.videoCount), `${state.importCount}回の取込履歴`),
      statusCard("AIレポート", state.aiReportStatus, state.importCount < 2 ? "参考値のみ表示" : "生成ボタンを利用できます")
    );
    const badge = document.getElementById("reviewBadge");
    badge.hidden = !state.unconfirmedVideoCount;
    badge.textContent = state.unconfirmedVideoCount;
    (state.warnings || []).forEach((text) => warnings.appendChild(directorEl("p", "warningItem", text)));
  } catch (error) {
    container.replaceChildren(statusCard("データ基盤", "設定が必要", error.message, "attention"));
  }
}

function valueLine(label, value) {
  const row = directorEl("div", "resultRow");
  row.append(directorEl("span", "", label), directorEl("strong", "", String(value)));
  return row;
}

async function readSelectedCsv() {
  const contentFile = document.getElementById("contentCsvFile").files[0];
  const dailyFile = document.getElementById("dailyCsvFile").files[0];
  if (!contentFile || !dailyFile) throw new Error("コンテンツ別CSVと日別CSVの2ファイルを選択してください。");
  const [contentCsvText, dailyCsvText] = await Promise.all([contentFile.text(), dailyFile.text()]);
  if (contentCsvText.includes("�") || dailyCsvText.includes("�")) throw new Error("文字コードをUTF-8で書き出してください。文字化けを検出しました。");
  const payload = {
    contentFileName: contentFile.name,
    contentCsvText,
    dailyFileName: dailyFile.name,
    dailyCsvText,
    periodStart: document.getElementById("periodStart").value,
    periodEnd: document.getElementById("periodEnd").value,
    channel: document.getElementById("channelName").value.trim()
  };
  if (!payload.periodStart || !payload.periodEnd) throw new Error("対象期間を入力してください。");
  return payload;
}

async function previewUpload() {
  if (!requireAdmin()) return;
  const result = document.getElementById("importResult");
  result.hidden = false;
  result.replaceChildren(directorEl("p", "meta", "CSVを検査しています..."));
  try {
    directorState.previewPayload = await readSelectedCsv();
    const preview = await api("/api/weekly-imports/preview", { method: "POST", headers: adminHeaders(), body: JSON.stringify(directorState.previewPayload) });
    result.replaceChildren();
    result.appendChild(directorEl("h2", "", preview.duplicate ? "同じ2ファイルは取込済みです" : "取込前の確認"));
    const grid = directorEl("div", "resultGrid");
    grid.append(
      valueLine("コンテンツCSV行数", preview.content.parsedRows),
      valueLine("動画行数", preview.content.videoRows),
      valueLine("日別CSV行数", preview.daily.dailyRows),
      valueLine("新規動画", preview.content.newVideoCount),
      valueLine("既存動画", preview.content.updatedVideoCount),
      valueLine("同期間の重複", preview.content.conflictCount + preview.daily.conflictCount),
      valueLine("手動確認が必要", preview.manualReviewCount)
    );
    result.appendChild(grid);
    if (Object.keys(preview.content.missingCounts || {}).length) result.appendChild(directorEl("p", "warningItem", `コンテンツCSVの欠損項目: ${Object.entries(preview.content.missingCounts).map(([key, count]) => `${key} ${count}件`).join("、")}`));
    if (preview.daily.missingDates?.length) result.appendChild(directorEl("p", "warningItem", `日別CSVにない日付: ${preview.daily.missingDates.join("、")}。日別グラフは参考値として表示します。`));
    if (preview.daily.missingMetricColumns?.length) result.appendChild(directorEl("p", "warningItem", `日別CSVにない指標: ${preview.daily.missingMetricColumns.join("、")}。該当指標は表示しません。`));
    if (preview.content.unknownHeaders?.length || preview.daily.unknownHeaders?.length) result.appendChild(directorEl("p", "infoItem", `未使用列: ${[...preview.content.unknownHeaders, ...preview.daily.unknownHeaders].join("、")}`));
    if (preview.content.recoveryImportId) result.appendChild(directorEl("p", "warningItem", "前回のコンテンツCSV保存が途中で中断されています。同じ取込IDで安全に再実行します。"));
    if (!preview.duplicate) {
      const policy = directorEl("label", "policyControl");
      policy.appendChild(directorEl("span", "", "同じ期間・動画がある場合"));
      const select = directorEl("select", "");
      select.id = "conflictPolicy";
      [["version", "別バージョンとして保存（推奨）"], ["skip", "既存行を残してスキップ"], ["update", "履歴を残して最新版へ更新"]].forEach(([value, label]) => {
        const option = directorEl("option", "", label); option.value = value; select.appendChild(option);
      });
      policy.appendChild(select);
      result.appendChild(policy);
      const commit = directorEl("button", "primaryButton", "この内容で取り込む");
      commit.type = "button";
      commit.addEventListener("click", commitUpload);
      result.appendChild(commit);
    }
  } catch (error) {
    result.replaceChildren(directorEl("p", "errorItem", error.message));
  }
}

async function commitUpload() {
  if (!requireAdmin()) return;
  const result = document.getElementById("importResult");
  try {
    const payload = { ...directorState.previewPayload, conflictPolicy: document.getElementById("conflictPolicy")?.value || "version" };
    const committed = await api("/api/weekly-imports/commit", { method: "POST", headers: adminHeaders(), body: JSON.stringify(payload) });
    result.replaceChildren(directorEl("h2", "", "取込が完了しました"));
    result.append(
      valueLine("正常取込", committed.importedRows),
      valueLine("コンテンツCSV", committed.content?.status === "skipped_duplicate" ? "既存を利用" : `${committed.content?.importedRows || 0}動画`),
      valueLine("日別CSV", committed.daily?.status === "skipped_duplicate" ? "既存を利用" : `${committed.daily?.importedRows || 0}日分`),
      valueLine("新規動画", committed.newVideoCount),
      valueLine("更新動画", committed.updatedVideoCount),
      valueLine("スキップ", committed.skippedRows),
      valueLine("未確認動画", committed.manualReviewCount)
    );
    if (committed.legacySync?.error) {
      result.appendChild(directorEl("p", "warningItem", `週次レポート蓄積シートへの同期に失敗しました: ${committed.legacySync.error}`));
    } else if (committed.legacySync) {
      const totals = (committed.legacySync.results || []).map((item) => `${item.sheet}: ${item.inserted}件追加・${item.updated}件更新`).join(" / ");
      result.appendChild(directorEl("p", "infoItem", `週次レポート蓄積シートへ同期済みです。${totals}`));
    }
    const next = directorEl("button", "primaryButton", "未確認動画を確認する"); next.type = "button"; next.dataset.route = "review"; next.addEventListener("click", () => showRoute("review")); result.appendChild(next);
  } catch (error) {
    result.prepend(directorEl("p", "errorItem", error.message));
  }
}

function reviewField(label, field, value, options) {
  const wrapper = directorEl("label", "reviewField");
  wrapper.appendChild(directorEl("span", "", label));
  let input;
  if (options) {
    input = directorEl("select", "");
    options.forEach((optionValue) => { const option = directorEl("option", "", optionValue); option.value = optionValue; input.appendChild(option); });
    if (value && !options.includes(value)) { const option = directorEl("option", "", value); option.value = value; input.appendChild(option); }
    input.value = value || options[0];
  } else {
    input = directorEl("input", ""); input.value = Array.isArray(value) ? value.join("、") : (value || "");
  }
  input.dataset.field = field;
  wrapper.appendChild(input);
  return wrapper;
}

function renderReviewCard(video) {
  const classification = video.classification || {};
  const card = directorEl("article", "reviewCard");
  const heading = directorEl("div", "reviewHeading");
  const checkbox = directorEl("input", "reviewSelect"); checkbox.type = "checkbox"; checkbox.value = video.videoId;
  const image = directorEl("img", "reviewThumb"); image.src = classification.thumbnailUrl || `https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`; image.alt = "";
  const publication = classification.publication || {};
  const title = directorEl("div", ""); title.append(directorEl("h2", "", video.title), directorEl("p", "meta", `${video.publishedAt || "公開日未取得"}${publication.weekday && publication.weekday !== "未取得" ? `（${publication.weekday}）` : ""} / ${publication.time || "公開時刻未取得"} / ${video.videoId}`));
  heading.append(checkbox, image, title); card.appendChild(heading);
  const fields = directorEl("div", "reviewFieldGrid");
  fields.append(
    reviewField("動画形式", "format", classification.format?.value, ["long", "shorts", "shorts_candidate", "live", "未判定"]),
    reviewField("企画ジャンル", "genre", classification.genre?.value),
    reviewField("出演メンバー（、区切り）", "members", classification.members?.value),
    reviewField("企画タグ（、区切り）", "tags", classification.tags?.value)
  );
  card.appendChild(fields);
  const evidence = directorEl("div", "evidenceList");
  [["形式", classification.format], ["ジャンル", classification.genre], ["メンバー", classification.members], ["タグ", classification.tags]].forEach(([label, item]) => {
    if (!item) return;
    evidence.appendChild(directorEl("p", item.confidence < 70 ? "confidence low" : "confidence", `${label}: 信頼度 ${item.confidence}% / ${item.reason}${item.needsReview ? " / 要確認" : ""}`));
  });
  card.appendChild(evidence);
  return card;
}

async function loadReviews() {
  const list = document.getElementById("reviewList");
  list.replaceChildren(directorEl("p", "meta", "未確認動画を読み込んでいます..."));
  try {
    const payload = await api("/api/videos?status=unconfirmed");
    directorState.reviewVideos = payload.videos;
    directorState.masters = { members: payload.members, categories: payload.categories };
    renderReviews();
  } catch (error) { list.replaceChildren(directorEl("p", "errorItem", error.message)); }
}

function renderReviews() {
  const list = document.getElementById("reviewList");
  const lowOnly = document.getElementById("lowConfidenceOnly").checked;
  const videos = directorState.reviewVideos.filter((video) => !lowOnly || Object.values(video.classification || {}).some((item) => item?.confidence !== undefined && item.confidence < 70));
  list.replaceChildren();
  if (!videos.length) { list.appendChild(directorEl("p", "emptyState", directorState.reviewVideos.length ? "低信頼度の候補はありません。" : "未確認動画はありません。今週の確認は完了です。")); return; }
  videos.forEach((video) => list.appendChild(renderReviewCard(video)));
}

async function confirmSelected() {
  if (!requireAdmin()) return;
  const cards = [...document.querySelectorAll(".reviewCard")];
  const selected = cards.filter((card) => card.querySelector(".reviewSelect")?.checked);
  if (!selected.length) { alert("確認済みにする動画を選択してください。"); return; }
  const edits = {};
  selected.forEach((card) => {
    const videoId = card.querySelector(".reviewSelect").value;
    edits[videoId] = {};
    card.querySelectorAll("[data-field]").forEach((input) => {
      const value = input.value.trim();
      edits[videoId][input.dataset.field] = ["members", "tags"].includes(input.dataset.field) ? value.split(/[、,]/).map((item) => item.trim()).filter(Boolean) : value;
    });
  });
  try {
    await api("/api/videos/confirm", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ videoIds: selected.map((card) => card.querySelector(".reviewSelect").value), edits }) });
    await loadReviews();
  } catch (error) { alert(error.message); }
}

async function reclassifyReviews() {
  if (!requireAdmin()) return;
  const selectedIds = [...document.querySelectorAll(".reviewSelect:checked")].map((input) => input.value);
  try {
    const result = await api("/api/videos/reclassify", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ videoIds: selectedIds }) });
    alert(`${result.reclassified}本の未確認動画を再判定しました。確認済みの属性は変更していません。`);
    await loadReviews();
  } catch (error) { alert(error.message); }
}

async function loadMasters() {
  try {
    const payload = await api("/api/videos");
    directorState.videos = payload.videos;
    directorState.masters = { members: payload.members, categories: payload.categories };
    const memberList = document.getElementById("memberList"); memberList.replaceChildren(); payload.members.forEach((item) => memberList.appendChild(directorEl("span", "masterChip", item.name)));
    const categoryList = document.getElementById("categoryList"); categoryList.replaceChildren(); payload.categories.forEach((item) => categoryList.appendChild(directorEl("span", "masterChip", item.name)));
    renderVideoAttributeEditor();
  } catch (error) { document.getElementById("memberList").textContent = error.message; }
}

function editorField(label, field, value, arrayValue = false) {
  const labelNode = directorEl("label", "reviewField");
  labelNode.appendChild(directorEl("span", "", label));
  const input = field === "notes" ? directorEl("textarea", "") : directorEl("input", "");
  input.value = arrayValue ? (value || []).join("、") : (value || "");
  input.dataset.attributeField = field;
  labelNode.appendChild(input);
  return labelNode;
}

function renderVideoAttributeEditor() {
  const container = document.getElementById("videoAttributeEditor");
  container.replaceChildren();
  if (!directorState.videos.length) { container.appendChild(directorEl("p", "emptyState", "CSV取込後に動画属性を編集できます。")); return; }
  if (!directorState.selectedVideoId || !directorState.videos.some((video) => video.videoId === directorState.selectedVideoId)) directorState.selectedVideoId = directorState.videos[0].videoId;
  const selectLabel = directorEl("label", "reviewField"); selectLabel.appendChild(directorEl("span", "", "対象動画"));
  const select = directorEl("select", ""); select.id = "videoAttributeSelect";
  directorState.videos.forEach((video) => { const option = directorEl("option", "", `${video.title} (${video.videoId})`); option.value = video.videoId; select.appendChild(option); });
  select.value = directorState.selectedVideoId;
  select.addEventListener("change", () => { directorState.selectedVideoId = select.value; renderVideoAttributeEditor(); });
  selectLabel.appendChild(select); container.appendChild(selectLabel);
  const video = directorState.videos.find((item) => item.videoId === directorState.selectedVideoId);
  const fields = directorEl("div", "reviewFieldGrid");
  fields.append(
    editorField("動画形式", "format", video.format),
    editorField("企画ジャンル", "genre", video.genre),
    editorField("サブジャンル", "subgenre", video.subgenre),
    editorField("出演メンバー（、区切り）", "members", video.members, true),
    editorField("ゲスト（、区切り）", "guests", video.guests, true),
    editorField("企画タグ（、区切り）", "tags", video.tags, true),
    editorField("コラボ", "collaboration", video.collaboration),
    editorField("タイトル訴求", "titleAppeal", video.titleAppeal),
    editorField("想定ターゲット", "targetAudience", video.targetAudience),
    editorField("季節イベント", "seasonalEvent", video.seasonalEvent),
    editorField("制作コスト", "productionCost", video.productionCost),
    editorField("撮影難易度", "shootingDifficulty", video.shootingDifficulty),
    editorField("備考", "notes", video.notes)
  );
  container.appendChild(fields);
  const save = directorEl("button", "primaryButton", "動画属性を保存"); save.type = "button"; save.addEventListener("click", saveVideoAttributes); container.appendChild(save);
}

async function saveVideoAttributes() {
  if (!requireAdmin()) return;
  const edits = {};
  document.querySelectorAll("[data-attribute-field]").forEach((input) => {
    const field = input.dataset.attributeField;
    edits[field] = ["members", "guests", "tags"].includes(field) ? input.value.split(/[、,]/).map((item) => item.trim()).filter(Boolean) : input.value.trim();
  });
  try {
    await api("/api/videos/attributes", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ videoId: directorState.selectedVideoId, edits }) });
    await loadMasters();
    alert("動画属性を保存しました。");
  } catch (error) { alert(error.message); }
}

async function addMaster(event, path) {
  event.preventDefault();
  if (!requireAdmin()) return;
  const form = event.currentTarget;
  const name = new FormData(form).get("name");
  try { await api(path, { method: "POST", headers: adminHeaders(), body: JSON.stringify({ name }) }); form.reset(); await loadMasters(); }
  catch (error) { alert(error.message); }
}

document.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => showRoute(button.dataset.route)));
document.getElementById("refreshHome").addEventListener("click", loadHome);
document.getElementById("refreshDirector").addEventListener("click", loadDirectorReport);
document.getElementById("previewImport").addEventListener("click", previewUpload);
document.getElementById("confirmSelected").addEventListener("click", confirmSelected);
document.getElementById("reclassifyReviews").addEventListener("click", reclassifyReviews);
document.getElementById("selectAllReviews").addEventListener("click", () => document.querySelectorAll(".reviewSelect").forEach((input) => { input.checked = true; }));
document.getElementById("lowConfidenceOnly").addEventListener("change", renderReviews);
document.getElementById("memberForm").addEventListener("submit", (event) => addMaster(event, "/api/members"));
document.getElementById("categoryForm").addEventListener("submit", (event) => addMaster(event, "/api/categories"));
document.getElementById("openAdminLogin").addEventListener("click", () => openAdminLogin());
document.getElementById("cancelAdminLogin").addEventListener("click", closeAdminLogin);
document.getElementById("adminLogout").addEventListener("click", () => {
  directorState.adminToken = "";
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  updateAdminControls();
});
document.getElementById("adminLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = document.getElementById("adminToken").value.trim();
  const error = document.getElementById("adminLoginError");
  error.hidden = true;
  try {
    await api("/api/admin/session", { method: "POST", headers: { "X-Admin-Token": token } });
    directorState.adminToken = token;
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    document.getElementById("adminToken").value = "";
    updateAdminControls();
    closeAdminLogin();
  } catch (loginError) {
    error.textContent = loginError.message === "管理用トークンが正しくありません。" ? "管理コードが正しくありません。" : loginError.message;
    error.hidden = false;
  }
});
window.addEventListener("hashchange", () => showRoute(location.hash.slice(1)));
updateAdminControls();
showRoute(location.hash.slice(1) || "home");
