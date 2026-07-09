const yen = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 });

function formatValue(item) {
  if (item.format === "hours") return `${oneDecimal.format(item.value)}h`;
  if (item.format === "number") return yen.format(item.value);
  return item.value;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderMeta() {
  document.getElementById("reportMeta").textContent =
    `${data.week.start}〜${data.week.end} / ${data.week.status} / レポート日 ${data.week.reportDate}`;
  document.getElementById("weeklyHeadline").textContent = data.headline;
  document.getElementById("updatedAt").textContent = `最終更新: ${data.source.updatedAt}`;

  const tags = document.getElementById("decisionTags");
  data.decisions.forEach((decision) => tags.appendChild(el("div", "tag", decision)));
}

function renderKpis() {
  const grid = document.getElementById("kpiGrid");
  data.kpis.forEach((item) => {
    const card = el("article", "kpiCard");
    card.appendChild(el("div", "kpiLabel", item.label));
    card.appendChild(el("div", "kpiValue", formatValue(item)));
    card.appendChild(el("div", "kpiNote", item.note));
    grid.appendChild(card);
  });
}

function renderVideos() {
  const list = document.getElementById("topVideos");
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
      video.genre,
      `${yen.format(video.views)}回`,
      `${yen.format(video.likes)}高評価`,
      `${yen.format(video.comments)}コメント`,
      `CTR ${video.ctr}`,
      video.avg,
      video.memo
    ].forEach((text) => meta.appendChild(el("span", "metricPill", text)));
    body.appendChild(meta);
    card.appendChild(body);
    list.appendChild(card);
  });
}

function renderDailyBars() {
  const max = Math.max(...data.dailyUnique.map((d) => d.value));
  const chart = document.getElementById("dailyBars");
  if (!data.dailyUnique.length) {
    chart.appendChild(el("p", "kpiNote", "日別データは次回CSV反映後に表示します。"));
    return;
  }
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
  data.insights.forEach((item) => {
    const node = el("div", "insight");
    node.innerHTML = `<strong>${item.label}</strong><br>${item.text}`;
    list.appendChild(node);
  });

  const actions = document.getElementById("actionList");
  data.actions.forEach((action) => actions.appendChild(el("li", "", action)));
}

function renderIdeas() {
  const grid = document.getElementById("ideas");
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

async function loadData() {
  if (!window.AKB_DATA_ENDPOINT) return data;

  try {
    const response = await fetch(window.AKB_DATA_ENDPOINT, { cache: "no-store" });
    if (!response.ok) throw new Error(`Data endpoint returned ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn("Falling back to bundled dashboard data.", error);
    return data;
  }
}

loadData().then((loadedData) => {
  data = loadedData;
  renderMeta();
  renderKpis();
  renderVideos();
  renderDailyBars();
  renderInsights();
  renderIdeas();
});
