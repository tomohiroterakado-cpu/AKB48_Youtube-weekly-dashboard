function latestImportsByPeriod(state) {
  const periods = new Map();
  [...state.imports]
    .filter((item) => item.status === "completed")
    .sort((left, right) => String(left.uploadedAt).localeCompare(String(right.uploadedAt)))
    .forEach((item) => periods.set(`${item.periodStart}_${item.periodEnd}`, item));
  return [...periods.values()].sort((left, right) => String(left.periodStart).localeCompare(String(right.periodStart)));
}

function metricValue(metric, key) {
  return Number(metric?.values?.[key] || 0);
}

function buildWeeklyDashboardData(state) {
  const weeks = latestImportsByPeriod(state).map((importRecord) => {
    const metrics = state.metrics.filter((item) => item.importId === importRecord.id && item.current);
    const dailyImport = [...(state.dailyImports || [])]
      .filter((item) => item.periodStart === importRecord.periodStart && item.periodEnd === importRecord.periodEnd && item.status === "completed")
      .sort((left, right) => String(right.uploadedAt).localeCompare(String(left.uploadedAt)))[0] || null;
    const dailyUnique = dailyImport
      ? (state.dailyMetrics || []).filter((item) => item.importId === dailyImport.id && item.current)
        .filter((item) => Number.isFinite(Number(item.values?.uniqueViewers)))
        .sort((left, right) => String(left.date).localeCompare(String(right.date)))
        .map((item) => ({ date: item.date.slice(5).replace("-", "/"), value: Number(item.values.uniqueViewers) }))
      : [];
    const total = (key) => Number(importRecord.summary?.[key] ?? metrics.reduce((sum, metric) => sum + metricValue(metric, key), 0));
    const topVideos = [...metrics].sort((left, right) => metricValue(right, "views") - metricValue(left, "views")).slice(0, 4).map((metric) => {
      const video = state.videos.find((item) => item.videoId === metric.videoId) || {};
      return {
        id: metric.videoId,
        title: video.title || metric.videoId,
        url: `https://www.youtube.com/watch?v=${metric.videoId}`,
        publishDate: video.publishedAt ? String(video.publishedAt).slice(0, 10) : "",
        genre: video.genre || "未設定",
        views: metricValue(metric, "views"),
        likes: metricValue(metric, "likes"),
        comments: metricValue(metric, "comments"),
        ctr: Number.isFinite(Number(metric.values?.ctr)) ? `${Number(metric.values.ctr)}%` : "",
        avg: metric.values?.averagePercentageViewed !== null && metric.values?.averagePercentageViewed !== undefined ? `視聴率 ${metric.values.averagePercentageViewed}%` : "",
        memo: "CSV集計値"
      };
    });
    return {
      key: `${importRecord.periodStart}_${importRecord.periodEnd}`,
      week: { start: importRecord.periodStart, end: importRecord.periodEnd, reportDate: String(importRecord.uploadedAt || "").slice(0, 10), status: "CSV取込済み" },
      headline: "コンテンツ別CSVと日別CSVを統合して集計しました。分析の確度はデータ蓄積後に向上します。",
      decisions: ["新規動画の属性を確認する", "日別の再生推移を確認する"],
      goals: { targetDate: "2027-03-31", items: [] },
      kpis: [
        { label: "総視聴回数", value: total("views"), format: "number", note: "コンテンツ別CSV合計" },
        { label: "チャンネル登録者増加数", value: total("subscriberGains"), format: "number", note: "コンテンツ別CSV合計" },
        { label: "新しい視聴者数", value: total("newViewers"), format: "number", note: "CSV合計行ベース" },
        { label: "リピーター", value: total("returningViewers"), format: "number", note: "CSV合計行ベース" },
        { label: "ユニーク視聴者", value: total("uniqueViewers"), format: "number", note: dailyUnique.length ? "日別CSVあり" : "日別CSV未取込" },
        { label: "インプレッション", value: total("impressions"), format: "number", note: `CTR ${Number(importRecord.summary?.ctr || 0)}%` }
      ],
      dailyUnique,
      topVideos,
      insights: [
        { label: "取込状況", text: `コンテンツ別CSV ${metrics.length}動画 / 日別CSV ${dailyUnique.length}日分` },
        { label: "注意", text: "データ不足のため、成功要因や再現性は現時点では統計的な信頼性が低い状態です。" },
        { label: "第三者目線", text: "数週分の蓄積後に、前週比・月間比較・企画別の傾向を判断します。" }
      ],
      actions: ["未確認動画の属性を確認する", "AI Directorの事実・集計結果を確認する"],
      ideas: []
    };
  });
  return { source: { updatedAt: new Date().toISOString(), updateCadence: "土曜〜金曜集計 / 火曜日中にCSV取込" }, weeks };
}

module.exports = { buildWeeklyDashboardData };
