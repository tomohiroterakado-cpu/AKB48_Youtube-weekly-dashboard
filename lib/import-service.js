const crypto = require("node:crypto");
const { classifyVideo } = require("./classification");
const { mapDailyYouTubeCsv, mapYouTubeCsv, numberValue } = require("./csv");

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function validateInput(input) {
  const missing = ["fileName", "periodStart", "periodEnd", "channel", "csvText"]
    .filter((key) => !String(input[key] || "").trim());
  if (missing.length) {
    const error = new Error(`取込情報が不足しています: ${missing.join("、")}`);
    error.code = "INVALID_IMPORT_INPUT";
    throw error;
  }
  if (String(input.periodStart) > String(input.periodEnd)) {
    throw new Error("対象期間の開始日が終了日より後になっています。");
  }
}

function dateFromYmd(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? date : null;
}

function expectedWeekDates(periodStart) {
  const start = dateFromYmd(periodStart);
  if (!start) return [];
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start.getTime() + index * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  });
}

function validateWeeklyWindow(periodStart, periodEnd) {
  const start = dateFromYmd(periodStart);
  const end = dateFromYmd(periodEnd);
  if (!start || !end) throw new Error("対象期間は YYYY-MM-DD 形式で入力してください。");
  const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  if (start.getUTCDay() !== 6 || end.getUTCDay() !== 5 || days !== 6) {
    throw new Error("週次の対象期間は土曜日開始・金曜日終了の7日間にしてください（例: 2026-07-04〜2026-07-10）。");
  }
}

function weeklyContentInput(input) {
  return {
    fileName: input.contentFileName || input.fileName,
    csvText: input.contentCsvText || input.csvText,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    channel: input.channel
  };
}

function validateWeeklyInput(input) {
  const content = weeklyContentInput(input);
  validateInput(content);
  if (!String(input.dailyFileName || "").trim() || !String(input.dailyCsvText || "").trim()) {
    throw new Error("コンテンツ別CSVと日別CSVの2ファイルを選択してください。");
  }
  validateWeeklyWindow(content.periodStart, content.periodEnd);
  return content;
}

function summaryMetrics(summary) {
  if (!summary) return {};
  return {
    uniqueViewers: numberValue(summary.uniqueViewers),
    newViewers: numberValue(summary.newViewers),
    returningViewers: numberValue(summary.returningViewers),
    views: numberValue(summary.views),
    watchHours: numberValue(summary.watchHours),
    averageViewDuration: summary.averageViewDuration || "",
    averagePercentageViewed: numberValue(summary.averagePercentageViewed),
    subscribers: numberValue(summary.subscribers),
    subscriberGains: numberValue(summary.subscriberGains),
    estimatedRevenue: numberValue(summary.estimatedRevenue),
    impressions: numberValue(summary.impressions),
    ctr: numberValue(summary.ctr),
    likes: numberValue(summary.likes),
    comments: numberValue(summary.comments),
    shares: numberValue(summary.shares)
  };
}

function publishedDate(value) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function isPublishedInPeriod(video, periodStart, periodEnd) {
  const date = publishedDate(video.publishedAt);
  return Boolean(date && date >= periodStart && date <= periodEnd);
}

function normalizeVisibility(value) {
  const visibility = String(value || "").trim();
  if (/限定公開|unlisted/i.test(visibility)) return "限定公開";
  if (/非公開|private/i.test(visibility)) return "非公開";
  if (/公開|public/i.test(visibility)) return "公開";
  return "未確認";
}

function buildPreview(input, state) {
  validateInput(input);
  const parsed = mapYouTubeCsv(input.csvText);
  const fileHash = input.fileHash || sha256(input.csvText);
  const duplicateImport = state.imports.find((item) => item.fileHash === fileHash && item.status === "completed");
  const processingImport = state.imports.find((item) => item.fileHash === fileHash && item.status === "processing");
  const knownVideoIds = new Set(state.videos.map((video) => video.videoId));
  const existingKeys = new Set(state.metrics
    .filter((metric) => metric.periodStart === input.periodStart && metric.periodEnd === input.periodEnd)
    .map((metric) => metric.videoId));
  const newVideos = parsed.videos.filter((video) => !knownVideoIds.has(video.videoId));
  const reviewVideos = newVideos.filter((video) => isPublishedInPeriod(video, input.periodStart, input.periodEnd));
  const conflicts = parsed.videos.filter((video) => existingKeys.has(video.videoId));
  const missingCounts = {};
  parsed.videos.forEach((video) => {
    ["publishedAt", "durationSeconds", "views", "impressions", "ctr"].forEach((field) => {
      if (video[field] === undefined || video[field] === null || video[field] === "") {
        missingCounts[field] = (missingCounts[field] || 0) + 1;
      }
    });
  });
  return {
    fileHash,
    fileName: input.fileName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    channel: input.channel,
    duplicate: Boolean(duplicateImport),
    duplicateImportId: duplicateImport?.id || null,
    recoveryImportId: processingImport?.id || null,
    parsedRows: parsed.rowCount,
    videoRows: parsed.videos.length,
    newVideoCount: reviewVideos.length,
    registeredVideoCount: newVideos.length,
    updatedVideoCount: parsed.videos.length - newVideos.length,
    conflictCount: conflicts.length,
    missingCounts,
    unknownHeaders: parsed.unknownHeaders,
    aiReportReady: parsed.videos.length > 0 && !duplicateImport,
    manualReviewCount: reviewVideos.length,
    ignoredRowCount: parsed.ignoredRowCount,
    parsed,
    summary: summaryMetrics(parsed.summary)
  };
}

async function previewImport(repository, input) {
  const state = await repository.read();
  try {
    const { parsed, ...preview } = buildPreview(input, state);
    return preview;
  } catch (error) {
    await recordImportFailure(repository, input, error).catch(() => undefined);
    throw error;
  }
}

async function recordImportFailure(repository, input, error) {
  const fileHash = input?.fileHash || sha256(input?.csvText || "");
  return repository.mutate((state) => {
    if (state.imports.some((item) => item.fileHash === fileHash && item.status === "error")) return { status: "already_recorded" };
    state.imports.push({
      id: id("import"),
      channel: String(input?.channel || ""),
      periodStart: String(input?.periodStart || ""),
      periodEnd: String(input?.periodEnd || ""),
      fileName: String(input?.fileName || "未指定"),
      fileHash,
      uploadedAt: new Date().toISOString(),
      sourceRows: 0,
      importedRows: 0,
      newVideoCount: 0,
      updatedVideoCount: 0,
      skippedRows: 0,
      duplicateCount: 0,
      missingCounts: {},
      unknownHeaders: [],
      summary: {},
      status: "error",
      error: String(error?.message || "CSVの検証に失敗しました。")
    });
    return { status: "recorded" };
  });
}

async function commitImport(repository, input, options = {}) {
  const conflictPolicy = options.conflictPolicy || "version";
  if (!["skip", "version", "update"].includes(conflictPolicy)) throw new Error("重複時の処理が不正です。");
  return repository.mutate((state) => {
    const preview = buildPreview(input, state);
    if (preview.duplicate) {
      const { parsed, ...publicPreview } = preview;
      return { status: "skipped_duplicate", importId: preview.duplicateImportId, ...publicPreview };
    }

    const now = new Date().toISOString();
    const resumableImport = state.imports.find((item) => item.fileHash === preview.fileHash && item.status === "processing") || null;
    const priorNewVideoCount = Number(resumableImport?.newVideoCount || 0);
    const importId = resumableImport?.id || id("import");
    const memberNames = state.members.filter((member) => member.active !== false).map((member) => member.name);
    let newVideoCount = 0;
    let updatedVideoCount = 0;
    let skippedRows = 0;
    let metricRows = 0;

    preview.parsed.videos.forEach((row) => {
      let video = state.videos.find((item) => item.videoId === row.videoId);
      if (!video) {
        const needsReview = isPublishedInPeriod(row, input.periodStart, input.periodEnd);
        video = {
          videoId: row.videoId,
          title: row.title,
          publishedAt: row.publishedAt || null,
          durationSeconds: row.durationSeconds,
          visibility: normalizeVisibility(row.visibility),
          status: needsReview ? "unconfirmed" : "historical",
          createdAt: now,
          updatedAt: now,
          reviewedAt: null,
          reviewedBy: null
        };
        state.videos.push(video);
        if (needsReview) {
          state.classifications.push({
            id: id("classification"),
            videoId: row.videoId,
            values: classifyVideo(row, memberNames),
            createdAt: now,
            model: "rules-v1",
            superseded: false
          });
        }
        if (needsReview) newVideoCount += 1;
      } else {
        video.title = row.title || video.title;
        video.publishedAt = row.publishedAt || video.publishedAt;
        video.durationSeconds = row.durationSeconds ?? video.durationSeconds;
        if ((!video.visibility || video.visibility === "未確認") && row.visibility) {
          video.visibility = normalizeVisibility(row.visibility);
        }
        video.updatedAt = now;
        updatedVideoCount += 1;
      }

      const allSamePeriod = state.metrics.filter((metric) =>
        metric.videoId === row.videoId && metric.periodStart === input.periodStart && metric.periodEnd === input.periodEnd
      );
      const samePeriod = allSamePeriod.filter((metric) => metric.importId !== importId);
      state.metrics.filter((metric) => metric.importId === importId && metric.videoId === row.videoId).forEach((metric) => { metric.current = false; });
      if (samePeriod.length && conflictPolicy === "skip") {
        const previousCurrent = [...samePeriod].sort((left, right) => Number(right.version || 0) - Number(left.version || 0))[0];
        previousCurrent.current = true;
        skippedRows += 1;
        return;
      }
      samePeriod.forEach((metric) => { metric.current = false; });
      state.metrics.push({
        id: id("metric"),
        importId,
        videoId: row.videoId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        version: Math.max(0, ...allSamePeriod.map((metric) => Number(metric.version || 0))) + 1,
        current: true,
        conflictPolicy,
        values: Object.fromEntries(Object.entries(row).filter(([key]) => !["videoId", "title", "publishedAt", "visibility", "sourceRow"].includes(key))),
        importedAt: now
      });
      metricRows += 1;
    });

    const importRecord = {
      id: importId,
      channel: input.channel,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      fileName: input.fileName,
      fileHash: preview.fileHash,
      uploadedAt: now,
      sourceRows: preview.parsedRows,
      importedRows: metricRows,
      newVideoCount: resumableImport ? Math.max(priorNewVideoCount, newVideoCount) : newVideoCount,
      updatedVideoCount,
      skippedRows,
      duplicateCount: preview.conflictCount,
      missingCounts: preview.missingCounts,
      unknownHeaders: preview.unknownHeaders,
      summary: preview.summary,
      status: "completed",
      error: ""
    };
    if (resumableImport) Object.assign(resumableImport, importRecord);
    else state.imports.push(importRecord);

    return {
      status: "completed",
      importId,
      importedRows: metricRows,
      newVideoCount,
      updatedVideoCount,
      skippedRows,
      duplicateCount: preview.conflictCount,
      manualReviewCount: resumableImport ? Math.max(priorNewVideoCount, newVideoCount) : newVideoCount,
      aiReportReady: metricRows > 0
    };
  });
}

function buildDailyPreview(input, state, contentPreview) {
  const parsed = mapDailyYouTubeCsv(input.dailyCsvText);
  const fileHash = input.dailyFileHash || sha256(input.dailyCsvText);
  const dailyImports = state.dailyImports || [];
  const duplicateImport = dailyImports.find((item) => item.fileHash === fileHash && item.status === "completed");
  const expectedDates = expectedWeekDates(input.periodStart);
  const actualDates = new Set(parsed.records.map((record) => record.date));
  const datesOutsidePeriod = parsed.records.filter((record) => record.date < input.periodStart || record.date > input.periodEnd).map((record) => record.date);
  if (datesOutsidePeriod.length) throw new Error(`日別CSVに対象期間外の日付があります: ${datesOutsidePeriod.join("、")}`);
  const missingDates = expectedDates.filter((date) => !actualDates.has(date));
  const existingDates = new Set((state.dailyMetrics || [])
    .filter((metric) => metric.periodStart === input.periodStart && metric.periodEnd === input.periodEnd && metric.current)
    .map((metric) => metric.date));
  return {
    fileName: input.dailyFileName,
    fileHash,
    parsedRows: parsed.rowCount,
    dailyRows: parsed.records.length,
    duplicate: Boolean(duplicateImport),
    duplicateImportId: duplicateImport?.id || null,
    conflictCount: parsed.records.filter((record) => existingDates.has(record.date)).length,
    missingDates,
    datesOutsidePeriod,
    invalidRows: parsed.invalidRows,
    missingMetricColumns: parsed.missingMetricColumns,
    unknownHeaders: parsed.unknownHeaders,
    parsed,
    contentImportId: contentPreview.duplicateImportId || null
  };
}

function buildWeeklyPreview(input, state) {
  const contentInput = validateWeeklyInput(input);
  const content = buildPreview(contentInput, state);
  const daily = buildDailyPreview(input, state, content);
  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    channel: input.channel,
    duplicate: content.duplicate && daily.duplicate,
    content,
    daily,
    aiReportReady: content.parsed.videos.length > 0 && daily.parsed.records.length > 0 && !content.duplicate,
    manualReviewCount: content.manualReviewCount
  };
}

async function previewWeeklyImport(repository, input) {
  const state = await repository.read();
  try {
    const preview = buildWeeklyPreview(input, state);
    const { parsed: contentParsed, ...content } = preview.content;
    const { parsed: dailyParsed, ...daily } = preview.daily;
    return { ...preview, content, daily };
  } catch (error) {
    throw error;
  }
}

function commitDailyImport(repository, input, { contentImportId, conflictPolicy = "version" } = {}) {
  return repository.mutate((state) => {
    const contentPreview = buildPreview(weeklyContentInput(input), state);
    const preview = buildDailyPreview(input, state, contentPreview);
    if (preview.duplicate) return { status: "skipped_duplicate", importId: preview.duplicateImportId, ...preview };
    const now = new Date().toISOString();
    const importId = id("daily_import");
    let importedRows = 0;
    let skippedRows = 0;
    preview.parsed.records.forEach((record) => {
      const samePeriod = (state.dailyMetrics || []).filter((metric) => metric.periodStart === input.periodStart && metric.periodEnd === input.periodEnd && metric.date === record.date);
      if (samePeriod.length && conflictPolicy === "skip") {
        skippedRows += 1;
        return;
      }
      samePeriod.forEach((metric) => { metric.current = false; });
      state.dailyMetrics = state.dailyMetrics || [];
      state.dailyMetrics.push({
        id: id("daily_metric"),
        importId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        date: record.date,
        version: Math.max(0, ...samePeriod.map((metric) => Number(metric.version || 0))) + 1,
        current: true,
        conflictPolicy,
        values: Object.fromEntries(Object.entries(record).filter(([key]) => !["date", "sourceRow"].includes(key))),
        importedAt: now
      });
      importedRows += 1;
    });
    state.dailyImports = state.dailyImports || [];
    state.dailyImports.push({
      id: importId,
      contentImportId: contentImportId || preview.contentImportId || "",
      channel: input.channel,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      fileName: input.dailyFileName,
      fileHash: preview.fileHash,
      uploadedAt: now,
      sourceRows: preview.parsedRows,
      importedRows,
      skippedRows,
      duplicateCount: preview.conflictCount,
      missingDates: preview.missingDates,
      missingMetricColumns: preview.missingMetricColumns,
      unknownHeaders: preview.unknownHeaders,
      status: "completed",
      error: ""
    });
    return { status: "completed", importId, importedRows, skippedRows, duplicateCount: preview.conflictCount, missingDates: preview.missingDates };
  });
}

async function commitWeeklyImport(repository, input, options = {}) {
  const conflictPolicy = options.conflictPolicy || "version";
  if (!["skip", "version", "update"].includes(conflictPolicy)) throw new Error("重複時の処理が不正です。");
  const preview = await previewWeeklyImport(repository, input);
  if (preview.duplicate) return { status: "skipped_duplicate", content: preview.content, daily: preview.daily, manualReviewCount: preview.manualReviewCount };
  const contentInput = weeklyContentInput(input);
  const contentResult = preview.content.duplicate
    ? { status: "skipped_duplicate", importId: preview.content.duplicateImportId, importedRows: 0, newVideoCount: 0, updatedVideoCount: 0, skippedRows: 0, duplicateCount: 0, manualReviewCount: 0 }
    : await commitImport(repository, contentInput, { conflictPolicy });
  const dailyResult = await commitDailyImport(repository, input, { contentImportId: contentResult.importId, conflictPolicy });
  return {
    status: dailyResult.status === "skipped_duplicate" && contentResult.status === "skipped_duplicate" ? "skipped_duplicate" : "completed",
    content: contentResult,
    daily: dailyResult,
    importedRows: Number(contentResult.importedRows || 0) + Number(dailyResult.importedRows || 0),
    newVideoCount: Number(contentResult.newVideoCount || 0),
    updatedVideoCount: Number(contentResult.updatedVideoCount || 0),
    skippedRows: Number(contentResult.skippedRows || 0) + Number(dailyResult.skippedRows || 0),
    manualReviewCount: Number(contentResult.manualReviewCount || 0),
    aiReportReady: contentResult.status === "completed" && dailyResult.status === "completed"
  };
}

module.exports = { buildDailyPreview, buildPreview, buildWeeklyPreview, commitDailyImport, commitImport, commitWeeklyImport, expectedWeekDates, previewImport, previewWeeklyImport, recordImportFailure, sha256, validateWeeklyWindow };
