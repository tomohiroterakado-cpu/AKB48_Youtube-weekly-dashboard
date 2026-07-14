const test = require("node:test");
const assert = require("node:assert/strict");
const { buildWeeklyDashboardData, publishedDateKey } = require("../lib/weekly-dashboard-report");

test("long-form likes average only includes videos published during the selected week", () => {
  const state = {
    imports: [{ id: "import_1", periodStart: "2026-07-04", periodEnd: "2026-07-10", uploadedAt: "2026-07-14", status: "completed", summary: {} }],
    dailyImports: [],
    dailyMetrics: [],
    videos: [
      { videoId: "abcdefghijk", title: "今週の長尺", publishedAt: "Jul 4, 2026", durationSeconds: 900 },
      { videoId: "lmnopqrstuv", title: "今週のShorts", publishedAt: "Jul 5, 2026", durationSeconds: 45 },
      { videoId: "12345678901", title: "過去の長尺", publishedAt: "Jun 20, 2026", durationSeconds: 900 }
    ],
    metrics: [
      { importId: "import_1", videoId: "abcdefghijk", current: true, values: { likes: 1200, views: 100 } },
      { importId: "import_1", videoId: "lmnopqrstuv", current: true, values: { likes: 500, views: 90 } },
      { importId: "import_1", videoId: "12345678901", current: true, values: { likes: 3000, views: 80 } }
    ]
  };
  const report = buildWeeklyDashboardData(state);
  const longLikes = report.weeks[0].kpis.find((item) => item.label === "長尺平均高評価");
  assert.deepEqual(longLikes, { label: "長尺平均高評価", value: 1200, format: "number", note: "週内公開の長尺 1本平均" });
});

test("published date parser supports YouTube Studio English date strings", () => {
  assert.equal(publishedDateKey("Jul 4, 2026"), "2026-07-04");
});

test("weekly report includes YouTube Studio revenue and comment totals", () => {
  const state = {
    imports: [{ id: "import_1", periodStart: "2026-07-04", periodEnd: "2026-07-10", uploadedAt: "2026-07-14", status: "completed", summary: { subscribers: 441, estimatedRevenue: 531808.506, comments: 764 } }],
    dailyImports: [],
    dailyMetrics: [],
    videos: [],
    metrics: []
  };
  const report = buildWeeklyDashboardData(state);
  assert.deepEqual(report.weeks[0].kpis.find((item) => item.label === "チャンネル登録者"), { label: "チャンネル登録者", value: 441, format: "number", note: "コンテンツ別CSVの指標（締日時点の総数ではありません）" });
  assert.deepEqual(report.weeks[0].kpis.find((item) => item.label === "週間推定収益"), { label: "週間推定収益", value: 531808.506, format: "yen", note: "YouTube Studioの推定値" });
  assert.deepEqual(report.weeks[0].kpis.find((item) => item.label === "コメント追加数"), { label: "コメント追加数", value: 764, format: "number", note: "コンテンツ別CSV合計" });
});
