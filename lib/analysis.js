const { ANALYSIS_CONFIDENCE } = require("./analysis-config");

function confidenceForState(state) {
  const weeks = new Set(state.imports.map((item) => `${item.periodStart}_${item.periodEnd}`)).size;
  const currentMetrics = state.metrics.filter((item) => item.current);
  if (!weeks || !currentMetrics.length) return { level: "判定不可", reason: "取込データがありません", weeks, videos: 0 };
  if (weeks >= ANALYSIS_CONFIDENCE.high.minimumWeeks && currentMetrics.length >= ANALYSIS_CONFIDENCE.high.minimumVideos) {
    return { level: ANALYSIS_CONFIDENCE.high.label, reason: ANALYSIS_CONFIDENCE.high.reason, weeks, videos: currentMetrics.length };
  }
  if (weeks >= ANALYSIS_CONFIDENCE.medium.minimumWeeks && currentMetrics.length >= ANALYSIS_CONFIDENCE.medium.minimumVideos) {
    return { level: ANALYSIS_CONFIDENCE.medium.label, reason: ANALYSIS_CONFIDENCE.medium.reason, weeks, videos: currentMetrics.length };
  }
  return { level: ANALYSIS_CONFIDENCE.low.label, reason: ANALYSIS_CONFIDENCE.low.reason, weeks, videos: currentMetrics.length };
}

function videoWithMetric(state, metric) {
  const video = state.videos.find((item) => item.videoId === metric?.videoId);
  return metric && video ? { videoId: video.videoId, title: video.title, value: metric.values } : null;
}

function buildDirectorReport(state) {
  const latestImport = [...state.imports]
    .filter((item) => item.status !== "error" && item.status !== "processing")
    .sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))[0] || null;
  const confidence = confidenceForState(state);
  if (!latestImport) return { status: "データ不足のため判定不可", confidence, facts: [], aggregations: [], interpretations: [], ideas: [] };
  const metrics = state.metrics.filter((item) => item.importId === latestImport.id && item.current);
  const latestDailyImport = [...(state.dailyImports || [])]
    .filter((item) => item.periodStart === latestImport.periodStart && item.periodEnd === latestImport.periodEnd && item.status === "completed")
    .sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))[0] || null;
  const dailyMetrics = latestDailyImport
    ? (state.dailyMetrics || []).filter((item) => item.importId === latestDailyImport.id && item.current)
    : [];
  const peakDailyUnique = [...dailyMetrics]
    .filter((item) => Number.isFinite(Number(item.values?.uniqueViewers)))
    .sort((a, b) => Number(b.values.uniqueViewers) - Number(a.values.uniqueViewers))[0] || null;
  const withViews = metrics.filter((item) => Number.isFinite(Number(item.values?.views)));
  const withCtr = metrics.filter((item) => Number(item.values?.impressions) > 1000 && Number.isFinite(Number(item.values?.ctr)));
  const topViews = videoWithMetric(state, [...withViews].sort((a, b) => Number(b.values.views) - Number(a.values.views))[0]);
  const topCtr = videoWithMetric(state, [...withCtr].sort((a, b) => Number(b.values.ctr) - Number(a.values.ctr))[0]);
  const facts = [
    topViews && { label: "期間内視聴回数1位", video: topViews.title, value: `${Number(topViews.value.views).toLocaleString("ja-JP")}回`, source: "CSV動画行" },
    topCtr && { label: "CTR1位（1,000imp以上）", video: topCtr.title, value: `${Number(topCtr.value.ctr).toLocaleString("ja-JP")}%`, source: `${Number(topCtr.value.impressions).toLocaleString("ja-JP")}imp` },
    peakDailyUnique && { label: "日別ユニーク視聴者の最多日", video: peakDailyUnique.date, value: `${Number(peakDailyUnique.values.uniqueViewers).toLocaleString("ja-JP")}人`, source: "日別CSV" },
    latestImport.summary?.newViewers !== null && { label: "新しい視聴者", video: "チャンネル全体", value: Number(latestImport.summary.newViewers || 0).toLocaleString("ja-JP"), source: "CSV合計行" },
    latestImport.summary?.returningViewers !== null && { label: "リピーター", video: "チャンネル全体", value: Number(latestImport.summary.returningViewers || 0).toLocaleString("ja-JP"), source: "CSV合計行" }
  ].filter(Boolean);
  return {
    status: confidence.weeks < 2 ? "参考値" : "集計済み",
    period: `${latestImport.periodStart}〜${latestImport.periodEnd}`,
    confidence,
    facts,
    aggregations: [{ label: "対象動画数", value: metrics.length }, { label: "日別データ", value: dailyMetrics.length ? `${dailyMetrics.length}日分` : "未取込" }, { label: "取込週数", value: confidence.weeks }],
    interpretations: confidence.weeks < 2
      ? [{ text: "データ不足のため、成功要因・再現性・因果関係は判定不可です。", evidence: `履歴${confidence.weeks}週 / 日別CSV ${dailyMetrics.length}日分` }]
      : [],
    ideas: [{ text: "AIによる企画案は、十分な履歴が蓄積された後に利用可能です。", kind: "AIによるアイデアであり、実績データに基づく提案ではない" }]
  };
}

module.exports = { buildDirectorReport, confidenceForState };
