function normal(value) { return String(value || "").normalize("NFKC").trim(); }
function number(value) { const parsed = Number(String(value || "").replace(/,/g, "")); return Number.isFinite(parsed) ? parsed : 0; }
function key(value) { const match = String(value || "").match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/); return match ? `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}` : ""; }
function column(headers, name) { return headers.findIndex((item) => normal(item) === normal(name)); }
function cell(row, headers, name) { const index = column(headers, name); return index < 0 ? "" : row[index]; }
function latestManual(rows, headers, weekStart, name) {
  return rows.filter((row) => key(cell(row, headers, "週開始日")) <= weekStart).reverse().map((row) => cell(row, headers, name)).find((value) => String(value || "") !== "") || "";
}
function pace(current, target, weekEnd) {
  const targetDate = new Date("2027-03-31T00:00:00Z");
  const currentDate = new Date(`${weekEnd}T00:00:00Z`);
  const startDate = new Date("2026-04-01T00:00:00Z");
  const remaining = Math.max(1, Math.ceil((targetDate - currentDate) / 604800000));
  const elapsed = Math.max(1, Math.ceil((currentDate - startDate) / 604800000));
  const required = Math.max(0, (target - current) / remaining);
  const actual = current / elapsed;
  return { progress: Math.round(current / target * 1000) / 10, probability: required ? Math.min(100, Math.round(actual / required * 1000) / 10) : 100, requiredWeeklyPace: Math.round(required * 10) / 10 };
}
function enrichGoals(report, values) {
  const weeks = report.weeks.map((week) => {
    const row = values.rows.find((candidate) => key(cell(candidate, values.headers, "週開始日")) === week.week.start);
    if (!row) return week;
    const channel = number(latestManual(values.rows, values.headers, week.week.start, "手入力_チャンネル登録者数_締日時点"));
    const membershipRaw = membershipCell(row, values.headers);
    const membershipMissing = String(membershipRaw === undefined || membershipRaw === null ? "" : membershipRaw).trim() === "";
    const membership = membershipMissing ? null : number(membershipRaw);
    const metrics = [
      ["チャンネル登録数", channel, 120000],
      ["視聴回数", number(cell(row, values.headers, "CSV_累計_視聴回数_20260401")), 15000000],
      ["新しい視聴者数", number(cell(row, values.headers, "CSV_累計_新しい視聴者数_20260401")), 1500000],
      ["リピーター", number(cell(row, values.headers, "CSV_累計_リピーター_20260401")), 1800000],
      ["メンバーシップ会員数", membership, 1500, membershipMissing]
    ];
    return {
      ...week,
      goals: {
        targetDate: "2027-03-31",
        items: metrics.map(([label, current, target, unavailable = false]) => (
          unavailable
            ? { label, current: null, target, format: "number", progress: null, probability: null, requiredWeeklyPace: null, unavailable: true }
            : { label, current, target, format: "number", ...pace(current, target, week.week.end) }
        ))
      }
    };
  });
  return { ...report, weeks };
}

function formatNumber(value) {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function shortTitle(value) {
  const text = String(value || "動画").replace(/\s+/g, " ").trim();
  return text.length > 26 ? `${text.slice(0, 26)}…` : text;
}

function comparison(label, current, previous) {
  const value = number(current);
  const baseline = number(previous);
  const delta = value - baseline;
  return {
    label,
    value,
    baseline,
    delta,
    deltaPercent: baseline ? Math.round((delta / baseline) * 1000) / 10 : null,
    format: "number",
    type: "comparison"
  };
}

function comparisonText(item) {
  const sign = item.delta > 0 ? "+" : "";
  const rate = item.deltaPercent === null ? "比較不可" : `${item.deltaPercent > 0 ? "+" : ""}${item.deltaPercent}%`;
  return `${sign}${formatNumber(item.delta)}（${rate}）`;
}

function rowForWeek(rows, headers, weekStart) {
  return rows.find((row) => key(cell(row, headers, "週開始日")) === weekStart);
}

function previousRow(rows, headers, weekStart) {
  return rows
    .filter((row) => key(cell(row, headers, "週開始日")) && key(cell(row, headers, "週開始日")) < weekStart)
    .sort((left, right) => key(cell(right, headers, "週開始日")).localeCompare(key(cell(left, headers, "週開始日"))))[0] || null;
}

function membershipCell(row, headers) {
  return [
    "手入力_メンバーシップ会員数_締日時点",
    "メンバーシップ会員数",
    "メンバーシップ会員数_締日時点"
  ].map((name) => cell(row, headers, name))
    .find((value) => value !== undefined && value !== null && String(value).trim() !== "") ?? "";
}

function membershipKpi(row, previous, headers) {
  const currentRaw = membershipCell(row, headers);
  if (String(currentRaw === undefined || currentRaw === null ? "" : currentRaw).trim() === "") {
    return { label: "メンバーシップ会員数", value: null, format: "number", note: "締日時点未入力" };
  }

  const current = number(currentRaw);
  const previousRaw = previous ? membershipCell(previous, headers) : "";
  if (String(previousRaw === undefined || previousRaw === null ? "" : previousRaw).trim() === "") {
    return { label: "メンバーシップ会員数", value: current, format: "number", note: "前週比 比較週なし / 締日時点手入力" };
  }

  const delta = current - number(previousRaw);
  const sign = delta > 0 ? "+" : "";
  return {
    label: "メンバーシップ会員数",
    value: current,
    format: "number",
    note: `前週比 ${sign}${formatNumber(delta)}人 / 締日時点手入力`
  };
}

function enrichMembershipKpis(report, values) {
  const weeks = report.weeks.map((week) => {
    const row = rowForWeek(values.rows, values.headers, week.week.start);
    if (!row) return week;
    const kpis = (week.kpis || []).filter((item) => (
      item.label !== "メンバーシップ増減数" && item.label !== "メンバーシップ会員数"
    ));
    const insertAfter = kpis.findIndex((item) => item.label === "チャンネル登録者増加数");
    kpis.splice(insertAfter < 0 ? 0 : insertAfter + 1, 0, membershipKpi(row, previousRow(values.rows, values.headers, week.week.start), values.headers));
    return { ...week, kpis };
  });
  return { ...report, weeks };
}

function enrichNarrative(report, values) {
  const weeks = report.weeks.map((week) => {
    const row = rowForWeek(values.rows, values.headers, week.week.start);
    const previous = previousRow(values.rows, values.headers, week.week.start);
    if (!row) return week;

    const current = (name) => cell(row, values.headers, name);
    const prior = (name) => cell(previous || [], values.headers, name);
    const currentAny = (...names) => names.map((name) => current(name)).find((value) => String(value || "") !== "") || "";
    const priorAny = (...names) => names.map((name) => prior(name)).find((value) => String(value || "") !== "") || "";
    const metrics = {
      views: comparison("視聴回数", current("総視聴回数"), prior("総視聴回数")),
      subscribers: comparison("チャンネル登録者増加数", current("チャンネル登録者増加数") || current("登録者増加数"), prior("チャンネル登録者増加数") || prior("登録者増加数")),
      unique: comparison("ユニーク視聴者", current("ユニーク視聴者数"), prior("ユニーク視聴者数")),
      newViewers: comparison("新しい視聴者数", current("新しい視聴者数"), prior("新しい視聴者数")),
      returners: comparison("リピーター", current("リピーター"), prior("リピーター")),
      impressions: comparison("インプレッション", current("インプレッション数"), prior("インプレッション数")),
      revenue: comparison("推定収益", currentAny("推定収益 (JPY)", "推定収益（JPY）", "推定収益"), priorAny("推定収益 (JPY)", "推定収益（JPY）", "推定収益")),
      comments: comparison("コメント追加数", currentAny("コメントの追加回数", "コメント追加回数", "コメント数"), priorAny("コメントの追加回数", "コメント追加回数", "コメント数"))
    };
    const hasPrevious = Boolean(previous);
    const topVideo = week.topVideos?.[0];
    const topVideoText = topVideo
      ? `「${shortTitle(topVideo.title)}」が${formatNumber(topVideo.views)}回で週間1位。`
      : "今週の牽引動画はCSV集計後に表示されます。";
    const growthText = hasPrevious
      ? `新しい視聴者は前週比${comparisonText(metrics.newViewers)}、リピーターは${comparisonText(metrics.returners)}で増加。`
      : "前週比は比較対象の週が蓄積され次第表示します。";
    const subscriberText = hasPrevious
      ? `一方、登録者増加は${formatNumber(metrics.subscribers.value)}人（前週比${comparisonText(metrics.subscribers)}）のため、視聴から登録への導線を今週の優先改善点にします。`
      : "登録者増加は、次週以降の比較データを待って判断します。";

    const positives = [metrics.newViewers, metrics.returners, metrics.unique, metrics.views]
      .filter((item) => item.delta > 0)
      .sort((left, right) => right.deltaPercent - left.deltaPercent)
      .slice(0, 3);
    const caution = [metrics.subscribers, metrics.impressions, metrics.views]
      .filter((item) => item.delta <= 0)
      .sort((left, right) => left.deltaPercent - right.deltaPercent)
      .slice(0, 2);
    const longLikes = week.kpis?.find((item) => item.label === "長尺平均高評価");
    const longLikesText = longLikes?.value
      ? `今週公開の長尺は${longLikes.note.replace("平均", "") || ""}、平均高評価は${formatNumber(longLikes.value)}。`
      : "長尺の反応は、公開本数が増えた後に比較します。";
    const subscriberIssue = hasPrevious && metrics.subscribers.delta < 0
      ? `チャンネル登録者増加は${formatNumber(metrics.subscribers.value)}人で、前週より${formatNumber(Math.abs(metrics.subscribers.delta))}人減少しました。視聴者到達は伸びているため、動画末尾・固定コメント・終了画面の登録導線を同じ週に検証します。`
      : "登録者増加は、次週以降の推移を見て改善判断します。";
    const revenueAndResponse = metrics.revenue.value || metrics.comments.value
      ? hasPrevious
        ? `推定収益は¥${formatNumber(metrics.revenue.value)}（前週比${comparisonText(metrics.revenue)}）、コメント追加数は${formatNumber(metrics.comments.value)}件（前週比${comparisonText(metrics.comments)}）です。推定収益はYouTube Studioの参考値として扱います。`
        : `推定収益は¥${formatNumber(metrics.revenue.value)}、コメント追加数は${formatNumber(metrics.comments.value)}件です。比較対象の週が揃うまでは参考値として記録します。`
      : "推定収益・コメント追加数は、CSV反映後に表示します。";

    const trendSections = hasPrevious ? [
      { label: "前週比（参考値）", note: "比較対象: 1週", title: "伸びた指標", tone: "positive", items: positives },
      { label: "前週比（要確認）", note: "優先改善", title: caution.length ? "来週までに確認する指標" : "大きな悪化は見られません", tone: "attention", items: caution.length ? caution : [metrics.subscribers] },
      { label: "月間平均・月間比較", note: "準備中", title: "4週分の蓄積後に自動表示", tone: "pending", description: "現在は2週分のため、月間平均・前月比較を断定せず保留します。あと2週分の取込完了後、同じ場所に自動で追加されます。", items: [] }
    ] : [{ label: "比較データ", note: "準備中", title: "前週比は次週から表示", tone: "pending", description: "前週比は2週目、月間平均・月間比較は4週目から自動表示します。", items: [] }];

    return {
      ...week,
      headline: `${topVideoText}${growthText}${subscriberText} 前週比は2週分の参考値です。`,
      decisions: ["対抗・イベント系長尺の次回企画を1本決める", "長尺公開後24〜48時間の切り抜き展開を設計する", "長尺から登録への導線を同一フォーマットで検証する"],
      trend: { note: "前週比は比較対象1週の参考値です。月間平均・月間比較は4週分のデータが揃うまで数値を表示しません。", sections: trendSections },
      insights: [
        { label: "伸びた理由の仮説", text: `${topVideoText}${longLikesText} 対抗・イベント性のある長尺が週間上位を牽引した可能性があります。ただし、現時点では2週分のため再現性は判定不可です。` },
        { label: "今週の課題", text: subscriberIssue },
        { label: "収益・反応", text: revenueAndResponse },
        { label: "次週に検証すること", text: hasPrevious ? `新しい視聴者${comparisonText(metrics.newViewers)}、リピーター${comparisonText(metrics.returners)}の伸びを維持できるかを確認します。公開後24〜48時間の切り抜き本数と、登録者増加の関係はデータ不足のため参考値として記録します。` : "次週のCSV取込後に、前週比較を開始します。" }
      ],
      actions: [
        `最優先: ${topVideo ? `「${shortTitle(topVideo.title)}」の勝ち要素を残した対抗・イベント系の長尺を1本企画する。` : "週間トップ動画を確認して次回長尺を決める。"}`,
        "公開後24〜48時間に、長尺の見どころを切り出したShortsを3本展開する。各動画の固定コメントと終了画面から本編・チャンネル登録へ誘導する。",
        "登録者増加を改善するため、長尺の終盤に次回企画の予告と登録CTAを必ず入れる。翌週は視聴回数だけでなく登録者増加数で判定する。"
      ],
      ideas: [
        { priority: "高", name: "対抗戦・イベント企画の続編", aim: `データ分析による参考提案。${topVideoText} 勝敗や役割が一目で伝わる企画軸を維持します。`, title: "【新対抗戦】AKB48メンバーが本気で挑戦、勝敗の行方は？", thumbnail: "出演メンバー2組の顔アップと対決構図。勝敗が即座に読める大きな要素を1つに絞る。", metric: "公開後7日視聴回数・CTR・チャンネル登録者増加数" },
        { priority: "中", name: "ご褒美・買い物を入口にしたメンバー企画", aim: "AIによる企画案。日常性とリアクションを入口にし、新規視聴者の獲得を狙う案です。実績データに基づく再現性はまだ判定不可です。", title: "【ご褒美企画】予算を使い切るまで帰れないAKB48", thumbnail: "金額またはご褒美を大きく見せ、出演者は驚きか笑顔の顔アップにする。", metric: "新しい視聴者数・CTR・公開後7日視聴回数" },
        { priority: "中", name: "発表・舞台裏をShortsで連続展開", aim: "AIによる運用案。長尺公開後の関心を保つため、発表の瞬間・反応・舞台裏を分けて連続投稿します。送客効果は現時点では判定不可です。", title: "【発表の瞬間】メンバーの本音が出た30秒", thumbnail: "一人の表情を大きく、文字は短い感情語だけにする。", metric: "Shorts視聴回数・長尺への遷移指標・チャンネル登録者増加数" }
      ]
    };
  });
  return { ...report, weeks };
}
async function buildReportWithLegacyGoals(repository, report) {
  if (typeof repository.readRange !== "function") return report;
  const result = await repository.readRange("CSV_週次集計!A:ZZ");
  const allRows = result.values || [];
  const headers = allRows[2] || [];
  if (!headers.length) return report;
  const values = { headers, rows: allRows.slice(3) };
  return enrichNarrative(enrichMembershipKpis(enrichGoals(report, values), values), values);
}
module.exports = { buildReportWithLegacyGoals, enrichGoals, enrichNarrative, enrichMembershipKpis };
