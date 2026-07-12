const crypto = require("node:crypto");
const { classifyVideo } = require("./classification");
const { mapYouTubeCsv, numberValue } = require("./csv");

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

function summaryMetrics(summary) {
  if (!summary) return {};
  return {
    uniqueViewers: numberValue(summary.uniqueViewers),
    newViewers: numberValue(summary.newViewers),
    returningViewers: numberValue(summary.returningViewers),
    views: numberValue(summary.views),
    watchHours: numberValue(summary.watchHours),
    subscribers: numberValue(summary.subscribers),
    subscriberGains: numberValue(summary.subscriberGains),
    estimatedRevenue: numberValue(summary.estimatedRevenue),
    impressions: numberValue(summary.impressions),
    ctr: numberValue(summary.ctr),
    likes: numberValue(summary.likes),
    comments: numberValue(summary.comments)
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
        values: Object.fromEntries(Object.entries(row).filter(([key]) => !["videoId", "title", "publishedAt", "sourceRow"].includes(key))),
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

module.exports = { buildPreview, commitImport, previewImport, recordImportFailure, sha256 };
