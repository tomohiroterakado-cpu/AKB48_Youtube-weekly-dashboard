const CATEGORY_RULES = [
  ["対決・勝負・イベント", /対決|ワールドカップ|勝負|運動会|チャレンジ|ゲーム|バトル|選手権/i],
  ["密着・成長・舞台裏", /密着|舞台裏|裏側|練習|初披露|ドキュメント|成長|vlog/i],
  ["発表・告知", /発表|お知らせ|新曲|初公開|解禁|重大/i],
  ["美容・ファッション", /メイク|美容|ヘア|コスメ|ファッション|私服/i],
  ["食・買い物・体験", /大食い|食べ|コストコ|買い|ご褒美|旅行|体験|ロケ|グルメ/i],
  ["関係性・トーク", /本音|質問|恋愛|結婚|相性|暴露|トーク|同期|先輩|後輩/i],
  ["Shorts・切り抜き", /shorts|切り抜き/i]
];

function optionalNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(String(value ?? "").replace(/[,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function numeric(value) {
  return optionalNumber(value) ?? 0;
}

function formatNumber(value) {
  if (optionalNumber(value) === null) return "未取得";
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(numeric(value));
}

function median(values) {
  const sorted = values.map(optionalNumber).filter((value) => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, ratio) {
  const sorted = values.map(optionalNumber).filter((value) => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function signedPercent(current, baseline) {
  if (optionalNumber(current) === null || optionalNumber(baseline) === null) return "必要な指標が未取得のため判定不可";
  if (!baseline) return "基準値が0のため増減率は判定不可";
  const percent = ((current - baseline) / baseline) * 100;
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`;
}

function kpiValue(week, pattern) {
  const item = (week.kpis || []).find((candidate) => pattern.test(String(candidate.label || "")));
  return optionalNumber(item?.value);
}

function isReviewedGenre(value) {
  const genre = String(value || "").trim();
  return Boolean(genre) && !/未設定|未判定|その他/.test(genre);
}

function classifyVideo(video) {
  const reviewedGenre = String(video?.genre || "").trim();
  if (isReviewedGenre(reviewedGenre)) return reviewedGenre;
  const format = String(video?.format || "").toLowerCase();
  if (/short/.test(format)) return "Shorts・切り抜き";
  const title = `${video?.title || ""} ${(video?.tags || []).join?.(" ") || ""}`;
  return CATEGORY_RULES.find(([, pattern]) => pattern.test(title))?.[0] || "その他";
}

function rowsForWeeks(weeks) {
  return weeks.flatMap((week) => {
    const rows = Array.isArray(week.videoMetrics) ? week.videoMetrics : [];
    return rows.map((row) => ({ ...row, weekStart: week.week?.start || "", weekEnd: week.week?.end || "" }));
  });
}

function uniqueVideos(weeks) {
  const videos = new Map();
  rowsForWeeks(weeks).forEach((video) => {
    const key = String(video.id || video.url || video.title || "");
    if (!key) return;
    const previous = videos.get(key) || { ...video, viewObservations: [] };
    const views = optionalNumber(video.views);
    if (views !== null) previous.viewObservations.push(views);
    videos.set(key, {
      ...previous,
      ...video,
      members: Array.isArray(video.members) && video.members.length ? video.members : previous.members,
      viewObservations: previous.viewObservations
    });
  });
  return [...videos.values()].map(({ viewObservations, ...video }) => ({
    ...video,
    views: median(viewObservations)
  }));
}

function safeHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function categoryStats(weeks) {
  const rows = rowsForWeeks(weeks);
  const weeklyThresholds = new Map();
  weeks.forEach((week) => {
    const weekRows = rows.filter((row) => row.weekStart === week.week?.start);
    weeklyThresholds.set(week.week?.start || "", percentile(weekRows.map((row) => row.views), 0.75));
  });
  const categories = new Map();
  rows.forEach((row) => {
    const name = classifyVideo(row);
    const current = categories.get(name) || { name, videos: new Map(), observations: 0, totalViews: 0 };
    const videoKey = String(row.id || row.title || "");
    if (!videoKey) return;
    const video = current.videos.get(videoKey) || { id: row.id || "", title: row.title || "タイトル未取得", views: [], ctrs: [], observations: 0, hits: 0 };
    const views = optionalNumber(row.views);
    const impressions = optionalNumber(row.impressions);
    const ctr = optionalNumber(row.ctr);
    if (views !== null) video.views.push(views);
    if (impressions !== null && impressions >= 1000 && ctr !== null) video.ctrs.push(ctr);
    video.observations += 1;
    const threshold = weeklyThresholds.get(row.weekStart);
    if (views !== null && threshold !== null && views >= threshold) video.hits += 1;
    current.videos.set(videoKey, video);
    current.observations += 1;
    if (views !== null) current.totalViews += views;
    categories.set(name, current);
  });
  return [...categories.values()].map((item) => {
    const videos = [...item.videos.values()].map((video) => ({
      ...video,
      medianViews: median(video.views),
      medianCtr: median(video.ctrs),
      hitRate: video.observations ? (video.hits / video.observations) * 100 : 0
    }));
    const hitRates = videos.map((video) => video.hitRate);
    return {
      name: item.name,
      videoCount: videos.length,
      observations: item.observations,
      medianViews: median(videos.map((video) => video.medianViews)),
      medianCtr: median(videos.map((video) => video.medianCtr)),
      hitRate: hitRates.length ? hitRates.reduce((sum, value) => sum + value, 0) / hitRates.length : 0,
      totalViews: item.totalViews,
      examples: videos.filter((video) => video.medianViews !== null).sort((a, b) => b.medianViews - a.medianViews).slice(0, 3).map((video) => ({ id: video.id, title: video.title, views: video.medianViews }))
    };
  }).sort((a, b) => numeric(b.medianViews) - numeric(a.medianViews) || b.hitRate - a.hitRate || b.videoCount - a.videoCount);
}

function topCategory(weeks) {
  const stats = categoryStats(weeks);
  const leader = stats[0];
  if (!leader) return { name: "判定不可", videoCount: 0, observations: 0, medianViews: null, medianCtr: null, hitRate: 0, examples: [], sampleSize: 0 };
  return { ...leader, sampleSize: uniqueVideos(weeks).length };
}

function marketEntries(week) {
  return (week.marketReport?.data?.sections || []).flatMap((section) => (section.entries || []).map((entry) => ({
    key: section.key,
    title: section.title,
    status: section.status || "参考情報",
    label: entry.label,
    text: entry.text,
    url: safeHttpsUrl(entry.url || entry.sourceUrl || entry.link || ""),
    observedAt: entry.observedAt || entry.publishedAt || week.week?.end || ""
  })));
}

function usableMarketEntries(week) {
  return marketEntries(week).filter((item) => !/判定不可|データ不足|未取得/.test(`${item.status} ${item.label} ${item.text}`));
}

function confidenceAssessment(weeks, market = []) {
  const rows = rowsForWeeks(weeks);
  const videos = uniqueVideos(weeks);
  const genreCoverage = videos.length ? videos.filter((video) => isReviewedGenre(video.genre)).length / videos.length : 0;
  const metricCoverage = videos.length ? videos.filter((video) => optionalNumber(video.views) !== null).length / videos.length : 0;
  const score = Math.min(3, weeks.length / 4) + Math.min(3, videos.length / 30) + genreCoverage * 2 + metricCoverage + (market.length ? 1 : 0);
  return {
    label: weeks.length >= 13 && score >= 8 ? "高" : weeks.length >= 4 && score >= 5 ? "中" : "低",
    weeks: weeks.length,
    observations: rows.length,
    videoCount: videos.length,
    genreCoverage: Math.round(genreCoverage * 100),
    metricCoverage: Math.round(metricCoverage * 100)
  };
}

function periodMedian(weeks, pattern) {
  return median(weeks.map((week) => kpiValue(week, pattern)));
}

function metricFinding(label, value, suffix = "") {
  return optionalNumber(value) === null ? `${label}は未取得です。` : `${label}${formatNumber(value)}${suffix}です。`;
}

function horizon(label, weeks, required, description) {
  const confidence = confidenceAssessment(weeks);
  const latest = weeks.at(-1);
  const previous = weeks.at(-2);
  const category = topCategory(weeks);
  if (weeks.length < required) {
    return {
      label,
      period: `${description}（利用${weeks.length}回分）`,
      confidence: "低",
      status: "データ不足のため判定不可",
      findings: [`${required}回分以上で傾向判定を開始します。現在は${weeks.length}回分です。`, category.videoCount ? `全動画の仮集計では「${category.name}」が${category.videoCount}本、対象週7日間の視聴回数中央値${formatNumber(category.medianViews)}回です。` : "分類できる動画がありません。"],
      decision: "結論を固定せず、企画ジャンルと出演メンバーを確認しながら履歴を増やします。"
    };
  }
  const latestViews = kpiValue(latest, /総?視聴回数/);
  const priorViews = kpiValue(previous, /総?視聴回数/);
  const medianViews = periodMedian(weeks, /総?視聴回数/);
  const latestNew = kpiValue(latest, /新しい視聴者/);
  const latestReturn = kpiValue(latest, /リピーター/);
  const findings = [];
  if (latestViews !== null) {
    findings.push(`最新週の視聴回数は${formatNumber(latestViews)}回。前週比${signedPercent(latestViews, priorViews)}、期間中央値比${signedPercent(latestViews, medianViews)}です。`);
  } else {
    findings.push("最新週の視聴回数が未取得のため、前週比と期間比は判定不可です。");
  }
  findings.push(`${metricFinding("最新週の新しい視聴者は", latestNew, "人")} ${metricFinding("リピーターは", latestReturn, "人")}`);
  findings.push(category.videoCount ? `全動画集計では「${category.name}」が対象週7日間の視聴回数中央値${formatNumber(category.medianViews)}回、上位25%到達率${category.hitRate.toFixed(0)}%（${category.videoCount}本）です。` : "分類できる動画がないため、企画傾向は判定不可です。");
  if (label === "中期" && weeks.length >= 8) {
    const latestFour = weeks.slice(-4);
    const priorFour = weeks.slice(-8, -4);
    const latestFourMedian = periodMedian(latestFour, /総?視聴回数/);
    const priorFourMedian = periodMedian(priorFour, /総?視聴回数/);
    findings.push(latestFourMedian === null ? "直近4回分の週間視聴回数が未取得のため、前4回分との比較は判定不可です。" : `直近4回分の週間視聴中央値は${formatNumber(latestFourMedian)}回で、その前4回分比${signedPercent(latestFourMedian, priorFourMedian)}です。`);
  }
  if (label === "長期") {
    const values = weeks.map((week) => kpiValue(week, /総?視聴回数/));
    const low = percentile(values, 0.25);
    const high = percentile(values, 0.75);
    findings.push(low === null || high === null ? "週間視聴回数の分布は指標未取得のため判定不可です。" : `週間視聴回数の中央50%は${formatNumber(low)}〜${formatNumber(high)}回です。単発ヒットと通常週を分けて判断します。`);
  }
  return {
    label,
    period: `${description}（利用${weeks.length}回分）`,
    confidence: confidence.label,
    status: "参考傾向",
    findings,
    decision: confidence.label === "低"
      ? `「${category.name}」は勝ち筋と確定せず、検証候補として同条件の動画を追加します。`
      : `「${category.name}」を再現枠に置き、同じ出演者・同じ訴求だけに依存しない派生企画を1本ずつ検証します。`
  };
}

function memberDimension(weeks) {
  const appearances = new Map();
  uniqueVideos(weeks).forEach((video) => {
    const members = Array.isArray(video.members) ? video.members : String(video.members || "").split(/[、,]/);
    members.map((name) => String(name).trim()).filter(Boolean).forEach((name) => {
      const current = appearances.get(name) || { count: 0, views: [] };
      current.count += 1;
      if (optionalNumber(video.views) !== null) current.views.push(optionalNumber(video.views));
      appearances.set(name, current);
    });
  });
  const top = [...appearances.entries()]
    .filter(([, value]) => value.count >= 2)
    .sort((a, b) => b[1].count - a[1].count || numeric(median(b[1].views)) - numeric(median(a[1].views)))
    .slice(0, 3);
  if (!top.length) {
    const text = appearances.size
      ? "2本以上比較できる出演メンバーがいないため判定不可です。出演回数が蓄積されるまで個人の強みとは扱いません。"
      : "出演メンバー情報が未確認のため判定不可です。未確認動画で属性を確定すると利用できます。";
    return { key: "members", label: "出演メンバー", status: "判定不可", text };
  }
  return { key: "members", label: "出演メンバー", status: "参考傾向", text: `${top.map(([name, value]) => `${name} ${value.count}本・対象週7日間の視聴中央値${formatNumber(median(value.views))}回`).join("、")}。2本以上の出演がある候補だけを表示し、複数出演の成果を個人だけの成果とは扱いません。` };
}

function seasonDimension(weeks) {
  const byMonth = new Map();
  weeks.forEach((week) => {
    const month = String(week.week?.start || "").slice(0, 7);
    if (!month) return;
    const values = byMonth.get(month) || [];
    const value = kpiValue(week, /総?視聴回数/);
    if (value !== null) values.push(value);
    byMonth.set(month, values);
  });
  if (byMonth.size < 3) return { key: "season", label: "時期・月別差", status: "判定不可", text: `比較できる月が${byMonth.size}か月のため、月別差はデータ不足のため判定不可です。季節性は複数年の同月比較後に判定します。` };
  const ranked = [...byMonth.entries()]
    .map(([month, values]) => ({ month, value: median(values), weeks: values.length }))
    .filter((item) => item.value !== null && item.weeks >= 3)
    .sort((a, b) => b.value - a.value);
  if (ranked.length < 3) return { key: "season", label: "時期・月別差", status: "判定不可", text: "3回分以上そろった月が3か月未満のため、月別差はデータ不足のため判定不可です。季節性は複数年の同月比較後に判定します。" };
  return { key: "season", label: "時期・月別差", status: "月別差の参考", text: `同一年内の月別週間視聴中央値は${ranked.slice(0, 3).map((item) => `${item.month} ${formatNumber(item.value)}回（${item.weeks}回分）`).join("、")}。これは月別差の参考値であり、季節性とは判定しません。季節性は複数年の同月比較後に利用可能です。` };
}

function marketDimension(week) {
  const entries = usableMarketEntries(week);
  if (!entries.length) return { key: "external", label: "外部環境", status: "判定不可", text: "外部環境について、同期間の競合・YouTube・SNS/検索トレンドが未取得です。" };
  return { key: "external", label: "外部環境", status: "公開情報の参考", text: entries.slice(0, 3).map((item) => `${item.title}: ${item.label}（${item.observedAt}）`).join(" / ") + "。自チャンネルでの有効性は別途検証します。" };
}

function action({ horizon: period, title, rationale, execution, target, kpi, passCondition, deadline, confidence, evidenceDimensions = [] }) {
  return { horizon: period, title, rationale, execution, target, kpi, passCondition, deadline, confidence, evidenceDimensions };
}

function idea(input) {
  return { ...input, metric: input.kpi, evidenceVideos: input.evidenceVideos || [], externalReferences: input.externalReferences || [] };
}

function groupIdeas({ key, title, basis, period, category, confidence, external = [], mode = "long-term", memberEvidence, seasonEvidence }) {
  const commonEvidence = [`${category.name}: ${category.videoCount}本`, `対象週7日間の視聴回数中央値 ${formatNumber(category.medianViews)}回`, `上位25%到達率 ${category.hitRate.toFixed(0)}%`];
  const evidenceVideos = (category.examples || []).map((video) => ({ title: video.title, views: video.views }));
  const exploratory = confidence === "低";
  const priority = (normal) => exploratory ? "検証" : normal;
  const evidenceType = (normal) => exploratory ? "AIによるアイデア（履歴不足）" : normal;
  const prefix = exploratory ? "仮説: " : "";
  if (!category.videoCount) {
    const fallbackPlans = [
      ["定番フォーマット候補を3本蓄積", "対決、密着、関係性トークを同じ公開後7日条件で試し、企画分類別の比較土台を作ります。", "比較土台"],
      ["出演関係性の確認履歴を作る", "同期、先輩後輩、初共演の属性を確認し、同じメンバーを毎週再入力せず比較できる状態にします。", "出演履歴"],
      ["月別の定点企画を始める", "同じ企画を月1回の共通条件で実施し、企画差と月別差を分けて確認できる履歴を作ります。", "月別定点"]
    ];
    return {
      key,
      title: title.replace(/勝ち筋を育てる|変化を伸ばす/, "比較できる履歴を作る"),
      basis: `${basis} 現在は分類できる全動画データがないため、以下は実績傾向ではなく履歴形成案です。`,
      period,
      ideas: fallbackPlans.map(([name, aim, proposalType]) => idea({
        priority: "検証",
        name: `仮説: ${name}`,
        aim,
        title: "【検証企画】次回比較できる共通条件で1本撮影",
        thumbnail: "企画名と主役を明示し、次回も比較できる共通レイアウトにする。",
        kpi: "対象週7日間視聴回数・CTR・新しい視聴者",
        proposalType,
        group: title,
        confidence: "低",
        evidenceType: "AIによるアイデア（全動画履歴不足）",
        evidencePeriod: period,
        evidenceMetrics: ["分類可能な全動画データなし"],
        evidenceVideos: [],
        externalReferences: []
      }))
    };
  }
  const templates = mode === "recent-year" ? [
    {
      priority: "高",
      name: `${prefix}直近の${category.name}を翌月に再検証`,
      aim: `${exploratory ? "実績傾向とは断定せず、" : ""}最近反応が見られた企画要素を一つだけ残し、次の4週で勢いの再現性を確かめます。`,
      title: `【次の一手】最近のAKB48で反応が強い${category.name}をもう一度`,
      thumbnail: "直近上位動画と共通する視認記号を残し、今回の違いを一語だけ大きく見せる。",
      kpi: "対象週7日間視聴回数・CTR・新しい視聴者",
      proposalType: "直近再検証"
    },
    {
      priority: "中",
      name: `${prefix}初見向け入口を加えた${category.name}`,
      aim: `${exploratory ? "実績傾向とは断定せず、" : ""}冒頭30秒で人物とルールを説明し、新規視聴者から登録までの入口を検証します。`,
      title: `【初見歓迎】3分で分かるAKB48の${category.name}`,
      thumbnail: "主役3人以内、企画ルール一言、結果を隠す表情を組み合わせる。",
      kpi: "新しい視聴者・平均視聴時間・登録者増加",
      proposalType: "新規入口"
    },
    {
      priority: "中",
      name: `${prefix}${category.name}の長尺・Shorts連動パッケージ`,
      aim: `${exploratory ? "実績傾向とは断定せず、" : ""}長尺の本音・表情変化・結果直前を別々のShortsにし、同一週の接触回数を増やします。`,
      title: "【結果直前】メンバーの表情が変わった瞬間",
      thumbnail: "顔アップ一人と短い感情語だけに絞り、長尺と共通色を使う。",
      kpi: "Shorts視聴回数・対象週7日間の長尺視聴回数・登録者増加",
      proposalType: "連動展開"
    }
  ] : [
    {
      priority: "高",
      name: `${prefix}${category.name}を定番番組資産にする`,
      aim: `${exploratory ? "実績傾向とは断定せず、" : ""}企画の核とタイトル記号を固定し、出演者と舞台だけを変えて四半期単位で再現性を検証します。`,
      title: `【定番企画】AKB48の${category.name}、今回は誰が主役？`,
      thumbnail: "シリーズ共通ロゴを残し、毎回変わる対立軸または感情を一つだけ大きく見せる。",
      kpi: "対象週7日間視聴回数中央値・CTR・リピーター",
      proposalType: "番組資産",
      evidenceMetrics: commonEvidence
    },
    {
      priority: "中",
      name: `${prefix}${category.name}で出演関係性を比較する`,
      aim: `${exploratory ? "実績傾向とは断定せず、" : ""}同期、先輩後輩、初共演を同じルールで試し、誰が優れているかではなく関係性ごとの強みを蓄積します。`,
      title: `【初組み】この2人で${category.name}をやったら？`,
      thumbnail: "二人の表情差と関係性を示す一語だけを使い、比較可能な共通レイアウトにする。",
      kpi: "対象週7日間視聴回数・リピーター・コメント率",
      proposalType: "関係性検証",
      evidenceMetrics: [memberEvidence?.text || "出演メンバー情報が未確認のため判定不可"]
    },
    {
      priority: "中",
      name: `${prefix}${category.name}を季節ごとに定点観測する`,
      aim: `${exploratory ? "実績傾向とは断定せず、" : ""}同じフォーマットを春夏秋冬で実施し、季節差と企画差を切り分けられる長期比較資産を作ります。`,
      title: `【季節限定】今のAKB48が本気で挑む${category.name}`,
      thumbnail: "シリーズ記号を固定し、季節色と今回の出来事だけを差し替える。",
      kpi: "月別の週間視聴中央値・新しい視聴者・リピーター",
      proposalType: "月別定点",
      evidenceMetrics: [seasonEvidence?.text || "月別データが不足しているため判定不可"]
    }
  ];
  return {
    key,
    title,
    basis,
    period,
    ideas: templates.map((template) => idea({
      ...template,
      priority: priority(template.priority),
      group: title,
      confidence,
      evidenceType: evidenceType("データ分析による参考提案"),
      evidencePeriod: period,
      evidenceMetrics: template.evidenceMetrics || commonEvidence,
      evidenceVideos,
      externalReferences: external
    }))
  };
}

function marketIdeaGroup(week) {
  const entries = usableMarketEntries(week);
  const slots = ["competitors", "youtube", "social-search"].map((key) => entries.find((item) => item.key === key));
  const labels = ["競合・参考チャンネル", "YouTubeトレンド", "SNS・検索トレンド"];
  const availableCount = slots.filter(Boolean).length;
  return {
    key: "market-trend",
    title: availableCount === 3 ? "競合・トレンドを小さく試す 3案" : availableCount ? "外部調査の不足を補う探索候補 3案" : "外部調査待ちの探索候補 3案",
    period: `${week.week?.start || ""}〜${week.week?.end || ""}`,
    basis: `外部調査は3領域中${availableCount}領域を取得済みです。不足領域を実績由来とは扱わず、外部の成功例もそのまま模倣せずにAKBらしいメンバー関係性へ翻訳して検証します。`,
    ideas: slots.map((entry, index) => idea({
      priority: entry ? (index === 2 ? "低" : "中") : "検証",
      name: entry ? `${entry.label}をAKB向けに検証` : `仮説: ${labels[index]}調査後に確定する探索枠`,
      aim: entry ? `${entry.label}: ${entry.text}` : `${labels[index]}の同期間データが未取得のため、AIによる企画案です。`,
      title: ["【1週間連動】本編・舞台裏・Shortsを一つの物語に", "【冒頭1秒】結論の瞬間から始まるAKB48チャレンジ", "【今週の話題】メンバーが同じテーマを本気で試したら"][index],
      thumbnail: ["同じ色とシリーズ名で内容の違いを一語で示す。", "結論直前の表情と7文字以内の問いを大きく見せる。", "話題語を一つだけ入れ、AKBらしい表情・関係性を主役にする。"][index],
      kpi: ["本編視聴回数・Shorts視聴回数・リピーター", "CTR・平均視聴時間・対象週7日間視聴回数", "検索流入・新しい視聴者・SNS反応"][index],
      group: "競合・トレンド",
      confidence: entry ? "中" : "低",
      evidenceType: entry ? "公開情報を使った参考提案" : "AIによる企画案",
      proposalType: "探索",
      evidencePeriod: `${week.week?.start || ""}〜${week.week?.end || ""}`,
      evidenceMetrics: entry ? [`${entry.title}: ${entry.label}`, entry.text] : ["同期間の外部調査なし"],
      externalReferences: entry ? [{ label: entry.label, url: entry.url, observedAt: entry.observedAt }] : []
    }))
  };
}

function recentYearWindow(history) {
  const dated = history.filter((week) => /^\d{4}-\d{2}-\d{2}$/.test(String(week.week?.end || "")));
  if (!dated.length) return { weeks: [], complete: false, period: "直近1年（日付未取得）" };
  const latestEnd = dated.map((week) => String(week.week.end)).sort().at(-1);
  const latestDate = new Date(`${latestEnd}T00:00:00Z`);
  const cutoffDate = new Date(latestDate);
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 364);
  const cutoff = cutoffDate.toISOString().slice(0, 10);
  const weeks = dated.filter((week) => String(week.week?.end || "") >= cutoff);
  const uniqueWeekEnds = new Set(weeks.map((week) => String(week.week?.end || "")));
  const earliestWindowStart = weeks.map((week) => String(week.week?.start || week.week?.end || "")).sort()[0] || "";
  const coverageWeeks = uniqueWeekEnds.size;
  const complete = coverageWeeks >= 48 && earliestWindowStart <= cutoff;
  return { weeks, complete, coverageWeeks, period: `${cutoff}〜${latestEnd}` };
}

function insufficientYearIdeaGroup(window) {
  const plans = [
    ["四半期で繰り返す関係性ドキュメント", "同じ出演者軸を四半期ごとに撮影し、成長と関係性の変化を年間比較できる履歴にします。", "【3か月後】あの2人はどう変わった？"],
    ["季節イベントの定点観測企画", "春夏秋冬で同じ企画フォーマットを試し、季節と企画差を切り分けられる比較データを作ります。", "【季節限定】AKB48メンバーが本気で挑戦"],
    ["出演組み合わせのローテーション企画", "ベテラン×若手、同期、初共演を同じルールで比べ、個人の優劣ではなく関係性ごとの強みを蓄積します。", "【初組み】この2人に同じ挑戦を任せたら？"]
  ];
  return {
    key: "recent-year",
    title: "直近1年を比較できる履歴を作る 3案",
    basis: `実日付の${window.period}は${window.coverageWeeks || 0}週分で、年間比較に必要な48週を満たしていません。年間傾向とは断定せず、来年比較できる企画資産を作ります。`,
    period: window.period,
    ideas: plans.map(([name, aim, title]) => idea({ priority: "検証", name: `仮説: ${name}`, aim, title, thumbnail: "同じシリーズ記号を残し、出演者と季節の違いを一目で分かるようにする。", kpi: "対象週7日間視聴回数・新しい視聴者・リピーター", group: "直近1年の履歴形成", confidence: "低", evidenceType: "AIによるアイデア（履歴不足）", proposalType: "履歴形成", evidencePeriod: window.period, evidenceMetrics: ["直近1年を満たす履歴なし"], evidenceVideos: [], externalReferences: [] }))
  };
}

function strategicWeek(week, history) {
  const shortWeeks = history.slice(-4);
  const mediumWeeks = history.slice(-13);
  const yearWindow = recentYearWindow(history);
  const recentYear = yearWindow.weeks;
  const allCategory = topCategory(history);
  const shortCategory = topCategory(shortWeeks);
  const recentCategory = topCategory(recentYear);
  const allConfidence = confidenceAssessment(history, usableMarketEntries(week));
  const recentConfidence = confidenceAssessment(recentYear, usableMarketEntries(week));
  const allPeriodLabel = history.length >= 52 ? "長期蓄積" : `全蓄積${history.length}回分`;
  const recentPeriodLabel = `直近1年 ${yearWindow.period}`;
  const externalRefs = usableMarketEntries(week).slice(0, 3).map((entry) => ({ label: entry.label, url: entry.url, observedAt: entry.observedAt }));
  const season = seasonDimension(history);
  const members = memberDimension(history);
  const external = marketDimension(week);
  const allCategoryLabel = allCategory.videoCount ? allCategory.name : "企画分類";
  const shortCategoryLabel = shortCategory.videoCount ? shortCategory.name : "比較可能な企画";
  const groups = [
    groupIdeas({ key: "long-term", title: "長期の勝ち筋を育てる 3案", basis: `${allPeriodLabel}の全動画から、単発最大値ではなく対象週7日間の中央値と上位到達率を使い、番組資産・出演関係性・月別定点の3方向を設計します。`, period: allPeriodLabel, category: allCategory, confidence: allConfidence.label, mode: "long-term", memberEvidence: members, seasonEvidence: season }),
    yearWindow.complete ? groupIdeas({ key: "recent-year", title: "直近1年の変化を伸ばす 3案", basis: `${recentPeriodLabel}の全動画を使い、最近の勢い・新規入口・長尺Shorts連動の3方向を次回撮影へ反映します。外部情報は補助根拠として扱います。`, period: recentPeriodLabel, category: recentCategory, confidence: recentConfidence.label, external: externalRefs, mode: "recent-year", memberEvidence: members, seasonEvidence: season }) : insufficientYearIdeaGroup(yearWindow),
    marketIdeaGroup(week)
  ];
  const horizons = [
    horizon("短期", shortWeeks, 2, "直近4回分"),
    horizon("中期", mediumWeeks, 4, "直近13回分"),
    horizon("長期", history, 8, "全蓄積期間")
  ];
  const rows = rowsForWeeks(history);
  const sourceLabel = history.some((item) => item.videoMetrics?.length) ? "全動画CSV" : "全動画CSV未取得";
  const lowHistory = history.length < 4;
  const shortConfidence = confidenceAssessment(shortWeeks).label;
  const mediumConfidence = confidenceAssessment(mediumWeeks).label;
  const actions = [
    action({ horizon: "短期", title: shortConfidence === "低" ? `検証候補「${shortCategoryLabel}」から1本選ぶ` : `「${shortCategoryLabel}」の派生企画を1本決定`, rationale: `${shortConfidence === "低" ? "履歴が少ないため勝ち筋とは断定しません。仮集計は" : "直近全動画は"}対象週7日間の視聴中央値${formatNumber(shortCategory.medianViews)}回、上位25%到達率${shortCategory.hitRate.toFixed(0)}%です。${members.status === "参考傾向" ? ` 出演傾向は「${members.text}」` : ` ${members.text}`}`, execution: "企画の核を一つ残し、出演関係性または舞台だけを変えて検証します。", target: "次回撮影する長尺1本", kpi: "対象週7日間視聴回数・CTR・登録者増加", passCondition: shortConfidence === "低" ? "次回の同一7日間指標と比較できる状態にする" : "各指標が直近4回分の中央値以上", deadline: "次回企画会議", confidence: shortConfidence, evidenceDimensions: ["企画内容", "出演メンバー"] }),
    action({ horizon: "中期", title: season.status === "月別差の参考" ? "月別差を含む再現枠・改善枠・探索枠を記録" : "再現枠・改善枠・探索枠を回ごとに記録", rationale: `${mediumWeeks.length >= 4 ? `直近${mediumWeeks.length}回分を比較できる状態です。` : `中期判断に必要な4回分まであと${Math.max(0, 4 - mediumWeeks.length)}回分です。`} 企画分類の仮集計は「${allCategoryLabel}」で、対象週7日間の視聴中央値${formatNumber(allCategory.medianViews)}回です。${season.text}`, execution: "各動画に企画ジャンル、出演メンバー、狙い、検証KPIを登録し、月ごとの企画構成も残します。", target: "今後公開する全動画", kpi: "属性確認率・対象週7日間指標・月別の仮説採否", passCondition: "属性確認率90%以上かつ3回分以上そろった月を3か月蓄積", deadline: "毎週火曜のレポート確認時", confidence: mediumConfidence, evidenceDimensions: ["時期・月別差", "企画内容"] }),
    action({ horizon: "長期", title: allConfidence.label === "低" ? `「${allCategoryLabel}」を番組資産候補として観察` : `「${allCategoryLabel}」を番組資産にする`, rationale: `${allPeriodLabel}の仮集計では「${allCategoryLabel}」の対象週7日間の視聴中央値が${formatNumber(allCategory.medianViews)}回です。${allConfidence.label === "低" ? "十分な履歴が蓄積されるまで確定しません。" : ""} ${season.text} ${external.text}`, execution: "四半期ごとに同じ7日間の中央値と上位到達率を見直し、外部事例は模倣せずAKBらしい関係性へ翻訳して継続・改善・終了を判断します。", target: "定番候補シリーズ", kpi: "対象週7日間視聴回数・リピーター・新しい視聴者", passCondition: "異なる時期に2回以上、チャンネル中央値を上回る", deadline: "四半期レビュー", confidence: allConfidence.label, evidenceDimensions: ["企画内容", "外部環境", "時期・月別差"] })
  ];
  return {
    ...week,
    channelTrends: {
      confidence: allConfidence,
      summary: lowHistory
        ? `現在${history.length}回分のため、中長期の結論は固定しません。${allCategory.videoCount ? `${sourceLabel}では「${allCategory.name}」の対象週7日間の視聴回数中央値が最も高く、` : "分類可能な全動画データが不足しているため、"}企画・出演メンバー・月別差を分けて検証します。`
        : `${sourceLabel}${rows.length}件を短期・中期・長期で比較すると、「${allCategoryLabel}」が対象週7日間の視聴回数中央値${formatNumber(allCategory.medianViews)}回、上位25%到達率${allCategory.hitRate.toFixed(0)}%です。再現・改善・探索の3枠で次回企画を決めます。`,
      note: `対象${history.length}回分 / ${sourceLabel}${rows.length}件 / ユニーク動画${uniqueVideos(history).length}本 / 企画ジャンル確認率${allConfidence.genreCoverage}%。${lowHistory ? "現時点では統計的な信頼性が低い参考値です。" : ""}相関関係を成功原因とは断定しません。`,
      horizons,
      dimensions: [
        { key: "format", label: "企画内容", status: allCategory.videoCount ? "参考傾向" : "判定不可", text: allCategory.videoCount ? `「${allCategory.name}」は${allCategory.videoCount}本、対象週7日間の視聴回数中央値${formatNumber(allCategory.medianViews)}回、CTR中央値${allCategory.medianCtr === null ? "未取得" : `${allCategory.medianCtr.toFixed(2)}%`}です。` : "分類できる動画がありません。" },
        season,
        members,
        external
      ]
    },
    actions,
    ideaGroups: groups,
    ideas: groups.flatMap((group) => group.ideas)
  };
}

function buildStrategicWeeklyReport(report) {
  const sorted = [...(report.weeks || [])].sort((left, right) => String(left.week?.start || "").localeCompare(String(right.week?.start || "")));
  return { ...report, weeks: sorted.map((week, index) => strategicWeek(week, sorted.slice(0, index + 1))) };
}

module.exports = { buildStrategicWeeklyReport, categoryStats, classifyVideo, topCategory };
