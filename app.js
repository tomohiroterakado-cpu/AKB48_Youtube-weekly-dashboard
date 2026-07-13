const yen = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 });

function formatValue(item) {
  if (item.format === "hours") return `${oneDecimal.format(item.value)}h`;
  if (item.format === "signed_number" || item.label === "メンバーシップ増減数") return formatSignedValue(item.value, "number");
  if (item.format === "number") return yen.format(item.value);
  return item.value;
}

function formatMetric(value, format) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "-";
  if (format === "hours") return `${oneDecimal.format(value)}h`;
  if (format === "yen") return `¥${yen.format(value)}`;
  if (format === "percent") return `${percent.format(value)}%`;
  return yen.format(value);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderMeta() {
  document.getElementById("decisionTags").replaceChildren();
  document.getElementById("reportMeta").textContent =
    `${data.week.start}〜${data.week.end} / ${data.week.status} / レポート日 ${data.week.reportDate}`;
  document.getElementById("weeklyHeadline").textContent = data.headline;
  document.getElementById("updatedAt").textContent = `最終更新: ${data.source.updatedAt}`;

  const tags = document.getElementById("decisionTags");
  data.decisions.forEach((decision) => tags.appendChild(el("div", "tag", decision)));
}

function renderKpis() {
  const grid = document.getElementById("kpiGrid");
  grid.replaceChildren();
  data.kpis.forEach((item) => {
    const card = el("article", "kpiCard");
    card.appendChild(el("div", "kpiLabel", item.label));
    card.appendChild(el("div", "kpiValue", formatValue(item)));
    card.appendChild(el("div", "kpiNote", item.note));
    grid.appendChild(card);
  });
}

function renderGoals() {
  const grid = document.getElementById("goalGrid");
  grid.replaceChildren();
  document.getElementById("goalTargetDate").textContent =
    data.goals?.targetDate ? `目標日 ${data.goals.targetDate}` : "";

  const items = data.goals?.items || [];
  if (!items.length) {
    grid.appendChild(el("p", "kpiNote", "目標設定はスプレッドシートの「目標設定」タブから追加できます。"));
    return;
  }

  items.forEach((goal) => {
    const card = el("article", "goalCard");
    const top = el("div", "goalTop");
    top.appendChild(el("span", "", goal.label));
    top.appendChild(el("span", "", `目標 ${formatMetric(goal.target, goal.format)}`));
    card.appendChild(top);
    card.appendChild(el("div", "goalValue", `${formatMetric(goal.current, goal.format)} / ${percent.format(goal.progress || 0)}%`));
    const track = el("div", "progressTrack");
    const fill = el("div", "progressFill");
    fill.style.width = `${Math.min(goal.progress || 0, 100)}%`;
    track.appendChild(fill);
    card.appendChild(track);
    card.appendChild(el("div", "probability", `達成見込み: ${percent.format(goal.probability || 0)}% / 必要ペース: ${formatMetric(goal.requiredWeeklyPace, goal.format)}/週`));
    grid.appendChild(card);
  });
}

function formatSignedValue(value, format) {
  const number = Number(value || 0);
  const sign = number > 0 ? "+" : "";
  return `${sign}${formatMetric(number, format)}`;
}

function formatComparisonNote(item) {
  if (item.type === "average") return item.note || "";
  const percentText = item.deltaPercent === null || item.deltaPercent === undefined
    ? "差分率 -"
    : `差分率 ${formatSignedValue(item.deltaPercent, "percent")}`;
  return `${percentText} / 基準 ${formatMetric(item.baseline, item.format)}`;
}

function renderTrends() {
  const panel = document.getElementById("trendPanel");
  const grid = document.getElementById("trendGrid");
  const note = document.getElementById("trendNote");
  const sections = data.trend?.sections || [];

  if (!sections.length) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  grid.replaceChildren();
  note.textContent = data.trend.note || "";

  sections.forEach((section) => {
    const card = el("article", "goalCard");
    const top = el("div", "goalTop");
    top.appendChild(el("span", "", section.label));
    top.appendChild(el("span", "", section.note));
    card.appendChild(top);
    card.appendChild(el("h3", "", section.title));

    section.items.forEach((item) => {
      const row = el("div", "probability");
      const value = item.type === "average"
        ? formatMetric(item.value, item.format)
        : formatSignedValue(item.delta, item.format);
      row.textContent = `${item.label}: ${value} / ${formatComparisonNote(item)}`;
      card.appendChild(row);
    });

    grid.appendChild(card);
  });
}

function renderVideos() {
  const list = document.getElementById("topVideos");
  list.replaceChildren();
  data.topVideos.forEach((video) => {
    const card = el("a", "videoCard");
    card.href = video.url;
    card.target = "_blank";
    card.rel = "noreferrer";
    card.setAttribute("aria-label", `${video.title}をYouTubeで開く`);

    const img = el("img", "thumb");
    img.src = `https://img.youtube.com/vi/${video.id}/hqdefault.jpg`;
    img.alt = video.title;
    img.loading = "lazy";
    card.appendChild(img);

    const body = el("div", "videoBody");
    body.appendChild(el("div", "videoTitle", video.title));
    const meta = el("div", "videoMeta");
    [
      video.publishDate ? `公開日 ${video.publishDate}` : "",
      video.genre,
      `${yen.format(video.views)}回`,
      `${yen.format(video.likes)}高評価`,
      `${yen.format(video.comments)}コメント`,
      `CTR ${video.ctr}`,
      video.avg,
      video.memo
    ].filter(Boolean).forEach((text) => meta.appendChild(el("span", "metricPill", text)));
    body.appendChild(meta);
    card.appendChild(body);
    list.appendChild(card);
  });
}

function renderDailyBars() {
  const chart = document.getElementById("dailyBars");
  chart.replaceChildren();
  if (!data.dailyUnique.length) {
    chart.appendChild(el("p", "kpiNote", "日別データは次回CSV反映後に表示します。"));
    return;
  }
  const max = Math.max(...data.dailyUnique.map((d) => d.value));
  data.dailyUnique.forEach((item) => {
    const row = el("div", "barRow");
    row.appendChild(el("span", "", item.date));
    const track = el("div", "barTrack");
    const fill = el("div", "barFill");
    fill.style.width = `${(item.value / max) * 100}%`;
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el("span", "", yen.format(item.value)));
    chart.appendChild(row);
  });
}

function renderInsights() {
  const list = document.getElementById("insightList");
  list.replaceChildren();
  data.insights.forEach((item) => {
    const node = el("div", "insight");
    node.appendChild(el("strong", "", item.label));
    node.appendChild(document.createElement("br"));
    node.appendChild(document.createTextNode(item.text));
    list.appendChild(node);
  });

  const actions = document.getElementById("actionList");
  actions.replaceChildren();
  data.actions.forEach((action) => actions.appendChild(el("li", "", action)));
}

function renderIdeas() {
  const grid = document.getElementById("ideas");
  grid.replaceChildren();
  data.ideas.forEach((idea) => {
    const card = el("article", "ideaCard");
    card.appendChild(el("span", "ideaPriority", `優先度 ${idea.priority}`));
    card.appendChild(el("h3", "", idea.name));
    card.appendChild(el("p", "", idea.aim));
    card.appendChild(el("p", "titleLine", idea.title));
    card.appendChild(el("p", "", `サムネ: ${idea.thumbnail}`));
    card.appendChild(el("p", "", `成功指標: ${idea.metric}`));
    grid.appendChild(card);
  });
}

let data = window.AKB_WEEKLY_DATA;
let allWeeks = [];

async function loadData() {
  if (!window.AKB_DATA_ENDPOINT) return data;

  try {
    const response = await fetch(window.AKB_DATA_ENDPOINT, { cache: "no-store" });
    if (!response.ok) throw new Error(`Data endpoint returned ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn("Fetch data endpoint failed. Trying script fallback.", error);
  }

  try {
    return await loadDataViaScript(window.AKB_DATA_ENDPOINT);
  } catch (error) {
    console.warn("Falling back to bundled dashboard data.", error);
    return data;
  }
}

function loadDataViaScript(endpoint) {
  return new Promise((resolve, reject) => {
    const callbackName = `akbDashboardData_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const script = document.createElement("script");
    const separator = endpoint.includes("?") ? "&" : "?";
    script.src = `${endpoint}${separator}callback=${encodeURIComponent(callbackName)}&cacheBust=${Date.now()}`;
    script.async = true;

    const cleanup = () => {
      delete window[callbackName];
      script.remove();
    };

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Script data endpoint failed"));
    };

    document.head.appendChild(script);
  });
}

function hydrateSelectedWeek(weekKey) {
  const selected = allWeeks.find((week) => week.key === weekKey) || allWeeks[0];
  if (!selected) return;
  data = {
    ...selected,
    source: data.source
  };
  renderAll();
}

function renderWeekSelect() {
  const select = document.getElementById("weekSelect");
  select.replaceChildren();
  allWeeks.forEach((week) => {
    const option = el("option", "", `${week.week.start}〜${week.week.end}`);
    option.value = week.key;
    select.appendChild(option);
  });
  select.value = data.key || allWeeks[0]?.key || "";
  select.onchange = () => hydrateSelectedWeek(select.value);
}

function renderAll() {
  renderMeta();
  renderKpis();
  renderTrends();
  renderGoals();
  renderVideos();
  renderDailyBars();
  renderInsights();
  renderIdeas();
}

function normalizeLoadedData(loadedData) {
  const source = loadedData.source || {};
  const rawWeeks = loadedData.weeks?.length ? loadedData.weeks : [loadedData];
  const weeks = rawWeeks
    .filter((week) => week && week.week)
    .map((week, index) => ({
      ...week,
      key: week.key || `${week.week.start}_${week.week.end}` || `week-${index + 1}`
    }))
    .sort((a, b) => String(b.week.start).localeCompare(String(a.week.start)));

  return {
    source,
    weeks
  };
}

loadData().then((loadedData) => {
  const normalized = normalizeLoadedData(loadedData);
  allWeeks = normalized.weeks;
  data = {
    ...allWeeks[0],
    source: normalized.source
  };
  renderWeekSelect();
  renderAll();
});
