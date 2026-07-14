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

function formatVideoDuration(value) {
  const totalSeconds = Number(value || 0);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "-";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatAverageViewDuration(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  if (/^\d+$/.test(text)) return formatVideoDuration(text);
  return text.replace(/^0:/, "");
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
  const headline = document.getElementById("weeklyHeadline");
  headline.replaceChildren();
  String(data.headline || "")
    .split(/(?<=。)/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const kind = line.includes("参考値") ? "note"
        : line.includes("一方") ? "risk"
          : index === 0 ? "lead" : "growth";
      headline.appendChild(el("span", `headlineLine headlineLine--${kind}`, line));
    });
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
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value || 0);
  const sign = number > 0 ? "+" : "";
  return `${sign}${formatMetric(number, format)}`;
}

function formatComparisonNote(item) {
  if (item.type === "average") return item.note || "";
  const percentText = item.deltaPercent === null || item.deltaPercent === undefined
    ? "増減率 -"
    : `増減率 ${formatSignedValue(item.deltaPercent, "percent")}`;
  return `前週 ${formatMetric(item.baseline, item.format)} / ${percentText}`;
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
    const card = el("article", `goalCard trendCard trendCard--${section.tone || "neutral"}`);
    const top = el("div", "goalTop");
    top.appendChild(el("span", "", section.label));
    top.appendChild(el("span", "", section.note));
    card.appendChild(top);
    card.appendChild(el("h3", "", section.title));
    if (section.description) card.appendChild(el("p", "trendDescription", section.description));

    (section.items || []).forEach((item) => {
      const direction = Number(item.delta) < 0 ? "negative" : "positive";
      const row = el("div", `trendRow trendRow--${direction}`);
      const value = item.type === "average"
        ? formatMetric(item.value, item.format)
        : formatSignedValue(item.delta, item.format);
      row.appendChild(el("span", "trendMetricLabel", item.label));
      row.appendChild(el("strong", "trendMetricValue", value));
      row.appendChild(el("span", "trendMetricNote", formatComparisonNote(item)));
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
      video.durationSeconds ? `動画尺 ${formatVideoDuration(video.durationSeconds)}` : "",
      video.averageViewDuration ? `平均視聴時間 ${formatAverageViewDuration(video.averageViewDuration)}` : "",
      `${yen.format(video.views)}回`,
      `${yen.format(video.likes)}高評価`,
      `${yen.format(video.comments)}コメント`,
      video.subscribers !== undefined && video.subscribers !== null ? `チャンネル登録者 ${yen.format(video.subscribers)}` : "",
      video.subscriberGains !== undefined && video.subscriberGains !== null ? `登録者増加 ${formatSignedValue(video.subscriberGains, "number")}` : "",
      video.estimatedRevenue !== undefined && video.estimatedRevenue !== null ? `推定 ¥${yen.format(video.estimatedRevenue)}` : "",
      video.ctr ? `CTR ${video.ctr}` : ""
    ].filter(Boolean).forEach((text) => meta.appendChild(el("span", "metricPill", text)));
    body.appendChild(meta);
    const advice = video.memo || video.advice;
    if (advice) body.appendChild(el("p", "videoAdvice", `次の一手: ${advice}`));
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
  let primary = data;
  if (window.AKB_DATA_ENDPOINT) {
    try {
      const response = await fetch(window.AKB_DATA_ENDPOINT, { cache: "no-store" });
      if (!response.ok) throw new Error(`Data endpoint returned ${response.status}`);
      primary = await response.json();
    } catch (error) {
      console.warn("Fetch data endpoint failed. Trying script fallback.", error);
      try {
        primary = await loadDataViaScript(window.AKB_DATA_ENDPOINT);
      } catch (fallbackError) {
        console.warn("Falling back to bundled dashboard data.", fallbackError);
      }
    }
  }

  if (!window.AKB_DIRECTOR_ENDPOINT) return primary;
  try {
    const response = await fetch(window.AKB_DIRECTOR_ENDPOINT, { cache: "no-store" });
    if (!response.ok) throw new Error(`Director endpoint returned ${response.status}`);
    return mergeDirectorWeeks(primary, await response.json());
  } catch (error) {
    console.warn("Director weekly data is unavailable. Using dashboard data only.", error);
    return primary;
  }
}

function mergeDirectorWeeks(primary, directorData) {
  const base = normalizeLoadedData(primary);
  const director = normalizeLoadedData(directorData);
  const merged = new Map(base.weeks.map((week) => [week.key, week]));
  director.weeks.forEach((week) => {
    const existing = merged.get(week.key);
    if (!existing) {
      merged.set(week.key, week);
      return;
    }

    // Apps Script側は手入力の会員数・目標進捗・長尺平均などを持つ正本。
    // Cloud Run側は日別CSVなど、正本に未反映の補完データだけを加える。
    merged.set(week.key, {
      ...week,
      ...existing,
      // AI Director側は蓄積シートの週次実績を根拠に結論・示唆・実行案を生成する。
      // 数値データは下の個別マージ規則で保持し、既存の汎用文言だけを置き換える。
      headline: week.headline || existing.headline,
      decisions: week.decisions?.length ? week.decisions : existing.decisions,
      trend: week.trend?.sections?.length ? week.trend : existing.trend,
      insights: week.insights?.length ? week.insights : existing.insights,
      actions: week.actions?.length ? week.actions : existing.actions,
      ideas: week.ideas?.length ? week.ideas : existing.ideas,
      kpis: mergeWeekKpis(existing.kpis, week.kpis),
      goals: week.goals?.items?.length ? week.goals : existing.goals,
      dailyUnique: existing.dailyUnique?.length ? existing.dailyUnique : week.dailyUnique,
      topVideos: mergeWeekVideos(existing.topVideos, week.topVideos)
    });
  });
  return {
    source: { ...base.source, ...director.source },
    weeks: [...merged.values()]
  };
}

function videoKey(video) {
  return String(video?.id || video?.url || video?.title || "");
}

function isUnlistedVideo(video) {
  return /限定公開|非公開|unlisted|private/i.test(String(video?.visibility || ""));
}

function uniqueTopVideos(videos) {
  const seen = new Set();
  return (videos || []).filter((video) => {
    const key = videoKey(video);
    if (!key || seen.has(key) || isUnlistedVideo(video)) return false;
    seen.add(key);
    return true;
  });
}

function mergeWeekVideos(primaryVideos, directorVideos) {
  const primary = uniqueTopVideos(primaryVideos);
  const director = uniqueTopVideos(directorVideos);
  if (!director.length) return primary.slice(0, 4);
  const primaryById = new Map(primary.map((video) => [videoKey(video), video]));
  const select = (value, fallback) => value === undefined || value === null || value === "" ? fallback : value;
  const merged = director.map((details) => {
    const video = primaryById.get(videoKey(details)) || {};
    return {
      ...video,
      ...details,
      subscribers: select(video.subscribers, details.subscribers),
      subscriberGains: select(video.subscriberGains, details.subscriberGains),
      estimatedRevenue: select(video.estimatedRevenue, details.estimatedRevenue),
      memo: select(video.memo, details.memo),
      advice: select(details.advice, video.advice)
    };
  });
  const selected = new Set(merged.map(videoKey));
  const supplements = primary.filter((video) => !selected.has(videoKey(video))).slice(0, Math.max(0, 4 - merged.length));
  return [...merged, ...supplements].slice(0, 4);
}

function mergeWeekKpis(primaryKpis, directorKpis) {
  const directorByLabel = new Map((directorKpis || []).map((item) => [item.label, item]));
  const merged = (primaryKpis || []).map((item) => {
    if (item.label === "長尺平均高評価" && directorByLabel.has(item.label)) return directorByLabel.get(item.label);
    if (item.label === "メンバーシップ増減数" && /未入力/.test(String(item.note || ""))) {
      return { ...item, value: null, format: "signed_number" };
    }
    return item;
  });
  const labels = new Set(merged.map((item) => item.label));
  (directorKpis || []).forEach((item) => {
    const duplicate = item.label === "総視聴回数" && labels.has("週間視聴回数");
    if (!labels.has(item.label) && !duplicate) merged.push(item);
  });
  return merged;
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
