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

function publishedDateKey(value) {
  const text = String(value || "").trim();
  const ymd = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (ymd) return `${ymd[1]}-${String(ymd[2]).padStart(2, "0")}-${String(ymd[3]).padStart(2, "0")}`;
  const english = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})/);
  if (english) {
    const months = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
    const month = months[english[1].toLowerCase()] || 0;
    if (month) return `${english[3]}-${String(month).padStart(2, "0")}-${String(english[2]).padStart(2, "0")}`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function isLongFormPublishedInPeriod(video, metric, periodStart, periodEnd) {
  const publishedAt = publishedDateKey(video?.publishedAt);
  const duration = Number(video?.durationSeconds || metric?.values?.durationSeconds || 0);
  return publishedAt >= periodStart && publishedAt <= periodEnd && duration > 180;
}

function average(values) {
  const numbers = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!numbers.length) return 0;
  return Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 10) / 10;
}

function buildWeeklyDashboardData(state) {
  const videosById = new Map((state.videos || []).map((video) => [video.videoId, video]));
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
    const longFormMetrics = metrics.filter((metric) => isLongFormPublishedInPeriod(videosById.get(metric.videoId), metric, importRecord.periodStart, importRecord.periodEnd));
    const longFormLikesAverage = average(longFormMetrics.map((metric) => metricValue(metric, "likes")));
    const topVideos = [...metrics].sort((left, right) => metricValue(right, "views") - metricValue(left, "views")).slice(0, 4).map((metric) => {
      const video = videosById.get(metric.videoId) || {};
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
        { label: "チャンネル登録者", value: total("subscribers"), format: "number", note: "コンテンツ別CSVの指標（締日時点の総数ではありません）" },
        { label: "新しい視聴者数", value: total("newViewers"), format: "number", note: "CSV合計行ベース" },
        { label: "リピーター", value: total("returningViewers"), format: "number", note: "CSV合計行ベース" },
        { label: "ユニーク視聴者", value: total("uniqueViewers"), format: "number", note: dailyUnique.length ? "日別CSVあり" : "日別CSV未取込" },
        { label: "インプレッション", value: total("impressions"), format: "number", note: `CTR ${Number(importRecord.summary?.ctr || 0)}%` },
        { label: "週間推定収益", value: total("estimatedRevenue"), format: "yen", note: "YouTube Studioの推定値" },
        { label: "コメント追加数", value: total("comments"), format: "number", note: "コンテンツ別CSV合計" },
        { label: "長尺平均高評価", value: longFormLikesAverage, format: "number", note: longFormMetrics.length ? `週内公開の長尺 ${longFormMetrics.length}本平均` : "対象の週内公開長尺なし" }
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

module.exports = { buildWeeklyDashboardData, isLongFormPublishedInPeriod, publishedDateKey };
