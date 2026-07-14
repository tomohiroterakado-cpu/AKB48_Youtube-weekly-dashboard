function normalize(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase();
}

function columnsFor(headers) {
  return new Map(headers.map((header, index) => [normalize(header), index]));
}

function findColumn(columns, aliases) {
  for (const alias of aliases) {
    const index = columns.get(normalize(alias));
    if (index !== undefined) return index;
  }
  return -1;
}

function copyRow(row, width) {
  return Array.from({ length: width }, (_, index) => row?.[index] ?? "");
}

function setAliases(row, columns, aliases, value) {
  const index = findColumn(columns, aliases);
  if (index < 0) return false;
  row[index] = value ?? "";
  return true;
}

function dateText(value) {
  return String(value || "").slice(0, 10);
}

function dateKey(value) {
  const match = String(value || "").match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (!match) return String(value || "");
  return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
}

function videoKey(value) {
  const text = String(value || "");
  const match = text.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : text;
}

function metricValue(values, key) {
  const value = values?.[key];
  return value === undefined || value === null ? "" : value;
}

function videoFormat(video, metric) {
  if (/short/i.test(String(video?.format || ""))) return "Shorts";
  return Number(metric?.values?.durationSeconds || video?.durationSeconds || 0) <= 180 ? "Shorts" : "長尺";
}

function tablePlan({ sheet, headerRow = 3, requiresWeekStart = true, keyForRecord, keyForRow, records, apply, derive }) {
  return { sheet, headerRow, requiresWeekStart, keyForRecord, keyForRow, records, apply, derive };
}

function buildPlans(state, importRecord, dailyImport) {
  const metrics = state.metrics.filter((item) => item.importId === importRecord.id && item.current);
  const dailyMetrics = dailyImport ? (state.dailyMetrics || []).filter((item) => item.importId === dailyImport.id && item.current) : [];
  const videosById = new Map(state.videos.map((video) => [video.videoId, video]));
  const summary = importRecord.summary || {};
  const weekly = {
    periodStart: importRecord.periodStart,
    periodEnd: importRecord.periodEnd,
    reportDate: dateText(importRecord.uploadedAt),
    summary
  };

  const applyWeekly = (row, columns, record) => {
    setAliases(row, columns, ["週開始日"], record.periodStart);
    setAliases(row, columns, ["週終了日"], record.periodEnd);
    setAliases(row, columns, ["集計日", "取込日"], record.reportDate);
    setAliases(row, columns, ["入力ステータス", "ステータス"], "CSV反映済み");
    setAliases(row, columns, ["総視聴回数", "週間視聴回数"], metricValue(record.summary, "views"));
    setAliases(row, columns, ["総再生時間（時間）", "総再生時間"], metricValue(record.summary, "watchHours"));
    setAliases(row, columns, ["平均視聴時間"], metricValue(record.summary, "averageViewDuration"));
    setAliases(row, columns, ["登録者増加数", "チャンネル登録者増加数"], metricValue(record.summary, "subscriberGains"));
    setAliases(row, columns, ["ユニーク視聴者数", "ユニーク視聴者"], metricValue(record.summary, "uniqueViewers"));
    setAliases(row, columns, ["新しい視聴者数", "新規視聴者数"], metricValue(record.summary, "newViewers"));
    setAliases(row, columns, ["リピーター", "リピーター数"], metricValue(record.summary, "returningViewers"));
    setAliases(row, columns, ["インプレッション数", "インプレッション"], metricValue(record.summary, "impressions"));
    setAliases(row, columns, ["インプレッションCTR", "インプレッションのクリック率", "CTR"], metricValue(record.summary, "ctr"));
    setAliases(row, columns, ["高評価数"], metricValue(record.summary, "likes"));
    setAliases(row, columns, ["コメント追加回数", "コメント数"], metricValue(record.summary, "comments"));
  };

  const deriveWeeklyCumulative = (row, columns, record, context) => {
    const weekStartColumn = findColumn(columns, ["週開始日"]);
    const previous = context.rows
      .slice(context.headerRow)
      .filter((candidate) => dateKey(candidate[weekStartColumn]) && dateKey(candidate[weekStartColumn]) < dateKey(record.periodStart))
      .sort((left, right) => dateKey(right[weekStartColumn]).localeCompare(dateKey(left[weekStartColumn])))[0];
    if (!previous) return;

    [
      { aliases: ["CSV_累計_視聴回数_20260401"], summaryKey: "views" },
      { aliases: ["CSV_累計_新しい視聴者数_20260401"], summaryKey: "newViewers" },
      { aliases: ["CSV_累計_リピーター_20260401"], summaryKey: "returningViewers" }
    ].forEach(({ aliases, summaryKey }) => {
      const column = findColumn(columns, aliases);
      if (column < 0) return;
      const previousTotal = Number(String(previous[column] || 0).replace(/,/g, ""));
      const currentWeek = Number(metricValue(record.summary, summaryKey) || 0);
      row[column] = (Number.isFinite(previousTotal) ? previousTotal : 0) + currentWeek;
    });
  };

  const contentRecords = metrics.map((metric) => ({ metric, video: videosById.get(metric.videoId) || {} }));
  const applyContent = (row, columns, record) => {
    const { metric, video } = record;
    const values = metric.values || {};
    setAliases(row, columns, ["週開始日"], importRecord.periodStart);
    setAliases(row, columns, ["週終了日"], importRecord.periodEnd);
    setAliases(row, columns, ["動画ID", "コンテンツ"], metric.videoId);
    setAliases(row, columns, ["動画タイトル", "動画のタイトル"], video.title || "");
    setAliases(row, columns, ["URL"], `https://www.youtube.com/watch?v=${metric.videoId}`);
    setAliases(row, columns, ["公開日時", "動画公開時刻", "公開日"], video.publishedAt || "");
    setAliases(row, columns, ["企画ジャンル", "企画ジャンル（任意）"], video.genre || videoFormat(video, metric));
    setAliases(row, columns, ["再生数", "視聴回数"], metricValue(values, "views"));
    setAliases(row, columns, ["高評価数"], metricValue(values, "likes"));
    setAliases(row, columns, ["コメント数", "コメント追加回数"], metricValue(values, "comments"));
    setAliases(row, columns, ["想定CTR", "インプレッションCTR", "インプレッションのクリック率"], metricValue(values, "ctr"));
    setAliases(row, columns, ["維持率", "平均視聴率"], metricValue(values, "averagePercentageViewed"));
    setAliases(row, columns, ["平均視聴時間"], metricValue(values, "averageViewDuration"));
    setAliases(row, columns, ["ユニーク視聴者数", "ユニーク視聴者"], metricValue(values, "uniqueViewers"));
    setAliases(row, columns, ["新しい視聴者数", "新規視聴者数"], metricValue(values, "newViewers"));
    setAliases(row, columns, ["リピーター", "リピーター数"], metricValue(values, "returningViewers"));
    setAliases(row, columns, ["インプレッション数", "インプレッション"], metricValue(values, "impressions"));
    setAliases(row, columns, ["総再生時間（単位: 時間）", "総再生時間（時間）", "総再生時間"], metricValue(values, "watchHours"));
    setAliases(row, columns, ["登録者増加数", "チャンネル登録者増加数"], metricValue(values, "subscriberGains"));
  };

  const applyDaily = (row, columns, record) => {
    const values = record.values || {};
    setAliases(row, columns, ["週開始日"], importRecord.periodStart);
    setAliases(row, columns, ["週終了日"], importRecord.periodEnd);
    setAliases(row, columns, ["日付", "日"], record.date);
    setAliases(row, columns, ["ユニーク視聴者数", "ユニーク視聴者", "視聴者数"], metricValue(values, "uniqueViewers"));
    setAliases(row, columns, ["視聴回数", "再生数"], metricValue(values, "views"));
    setAliases(row, columns, ["新しい視聴者数", "新規視聴者数"], metricValue(values, "newViewers"));
    setAliases(row, columns, ["リピーター", "リピーター数"], metricValue(values, "returningViewers"));
    setAliases(row, columns, ["インプレッション数", "インプレッション"], metricValue(values, "impressions"));
  };

  return [
    tablePlan({ sheet: "CSV_週次集計", keyForRecord: (record) => dateKey(record.periodStart), keyForRow: (row, columns) => dateKey(row[findColumn(columns, ["週開始日"])]), records: [weekly], apply: applyWeekly, derive: deriveWeeklyCumulative }),
    tablePlan({ sheet: "CSV_貼付用", keyForRecord: (record) => `${dateKey(importRecord.periodStart)}_${record.metric.videoId}`, keyForRow: (row, columns) => `${dateKey(row[findColumn(columns, ["週開始日"])] || "")}_${videoKey(row[findColumn(columns, ["動画ID", "コンテンツ", "URL"])] || "")}`, records: contentRecords, apply: applyContent }),
    tablePlan({ sheet: "自チャンネル動画", keyForRecord: (record) => `${dateKey(importRecord.periodStart)}_${record.metric.videoId}`, keyForRow: (row, columns) => `${dateKey(row[findColumn(columns, ["週開始日"])] || "")}_${videoKey(row[findColumn(columns, ["動画ID", "コンテンツ", "URL"])] || "")}`, records: contentRecords, apply: applyContent }),
    // 既存のCSV_日別は週開始日を持たない形式のため、日付を一意キーとして扱う。
    tablePlan({ sheet: "CSV_日別", requiresWeekStart: false, keyForRecord: (record) => dateKey(record.date), keyForRow: (row, columns) => dateKey(row[findColumn(columns, ["日付", "日"])] || ""), records: dailyMetrics, apply: applyDaily })
  ];
}

async function syncPlan(repository, plan) {
  const result = await repository.readRange(`${plan.sheet}!A:ZZ`);
  const rows = result.values || [];
  const headers = rows[plan.headerRow - 1] || [];
  if (!headers.length) throw new Error(`${plan.sheet} の見出し行が見つかりません。`);
  const columns = columnsFor(headers);
  if (plan.requiresWeekStart && findColumn(columns, ["週開始日"]) < 0) throw new Error(`${plan.sheet} に「週開始日」列が見つかりません。`);
  const indexByKey = new Map();
  rows.slice(plan.headerRow).forEach((row, index) => {
    const key = plan.keyForRow(row, columns);
    if (key && !key.endsWith("_")) indexByKey.set(String(key), plan.headerRow + index + 1);
  });
  const writes = [];
  let inserted = 0;
  let updated = 0;
  plan.records.forEach((record) => {
    const key = String(plan.keyForRecord(record));
    const rowNumber = indexByKey.get(key) || rows.length + inserted + 1;
    const existing = indexByKey.get(key) ? rows[rowNumber - 1] : [];
    const row = copyRow(existing, headers.length);
    plan.apply(row, columns, record);
    plan.derive?.(row, columns, record, { rows, headerRow: plan.headerRow });
    writes.push({ range: `${plan.sheet}!A${rowNumber}`, values: [row] });
    if (indexByKey.get(key)) updated += 1;
    else inserted += 1;
  });
  if (writes.length) await repository.batchWriteRanges(writes);
  return { sheet: plan.sheet, inserted, updated, records: plan.records.length };
}

async function syncLegacyWeeklyReport(repository, { periodStart, periodEnd } = {}) {
  if (typeof repository.readRange !== "function" || typeof repository.batchWriteRanges !== "function") {
    throw new Error("Google Sheets保存先でのみ既存週次レポートへ同期できます。");
  }
  const state = await repository.read();
  const importRecord = [...state.imports]
    .filter((item) => item.status !== "error" && item.status !== "processing")
    .filter((item) => (!periodStart || item.periodStart === periodStart) && (!periodEnd || item.periodEnd === periodEnd))
    .sort((left, right) => String(right.uploadedAt).localeCompare(String(left.uploadedAt)))[0];
  if (!importRecord) throw new Error("指定期間の正常取込済みコンテンツCSVが見つかりません。");
  const dailyImport = [...(state.dailyImports || [])]
    .filter((item) => item.status === "completed" && item.periodStart === importRecord.periodStart && item.periodEnd === importRecord.periodEnd)
    .sort((left, right) => String(right.uploadedAt).localeCompare(String(left.uploadedAt)))[0] || null;
  const results = [];
  for (const plan of buildPlans(state, importRecord, dailyImport)) results.push(await syncPlan(repository, plan));
  return { periodStart: importRecord.periodStart, periodEnd: importRecord.periodEnd, importId: importRecord.id, dailyImportId: dailyImport?.id || null, results };
}

module.exports = { buildPlans, columnsFor, dateKey, findColumn, syncLegacyWeeklyReport, videoKey };
