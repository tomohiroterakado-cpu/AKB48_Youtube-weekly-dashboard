const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPlans, columnsFor, dateKey, videoKey } = require("../lib/legacy-sheet-sync");

const importRecord = {
  id: "import_20260704",
  periodStart: "2026-07-04",
  periodEnd: "2026-07-10",
  uploadedAt: "2026-07-14T03:15:00.000Z",
  summary: { views: 521199, likes: 10128, newViewers: 25866, returningViewers: 90673 }
};

const state = {
  videos: [
    { videoId: "abcdefghijk", title: "長尺動画", publishedAt: "2026-07-04T10:00:00Z", durationSeconds: 600 },
    { videoId: "lmnopqrstuv", title: "Shorts動画", publishedAt: "2026-07-05T10:00:00Z", durationSeconds: 30 }
  ],
  metrics: [
    { importId: importRecord.id, videoId: "abcdefghijk", current: true, values: { views: 1000, likes: 100, durationSeconds: 600 } },
    { importId: importRecord.id, videoId: "lmnopqrstuv", current: true, values: { views: 2000, likes: 50, durationSeconds: 30 } }
  ],
  dailyMetrics: [{ importId: "daily_1", current: true, date: "2026-07-04", values: { uniqueViewers: 41014 } }]
};

test("legacy sheet sync builds weekly, content, video, and daily plans", () => {
  const plans = buildPlans(state, importRecord, { id: "daily_1" });
  assert.deepEqual(plans.map((plan) => plan.sheet), ["CSV_週次集計", "CSV_貼付用", "自チャンネル動画", "CSV_日別"]);

  const weekly = Array(10).fill("");
  plans[0].apply(weekly, columnsFor(["週開始日", "総視聴回数", "新しい視聴者数"]), plans[0].records[0]);
  assert.deepEqual(weekly.slice(0, 3), ["2026-07-04", 521199, 25866]);

  const content = Array(10).fill("");
  plans[1].apply(content, columnsFor(["週開始日", "動画ID", "企画ジャンル", "高評価数"]), plans[1].records[0]);
  assert.deepEqual(content.slice(0, 4), ["2026-07-04", "abcdefghijk", "長尺", 100]);

  const daily = Array(6).fill("");
  plans[3].apply(daily, columnsFor(["週開始日", "日付", "ユニーク視聴者数"]), plans[3].records[0]);
  assert.deepEqual(daily.slice(0, 3), ["2026-07-04", "2026-07-04", 41014]);
});

test("legacy synchronization keys normalize dates and YouTube URLs", () => {
  assert.equal(dateKey("2026/7/4"), "2026-07-04");
  assert.equal(videoKey("https://www.youtube.com/watch?v=abcdefghijk"), "abcdefghijk");
  assert.equal(videoKey("https://youtu.be/abcdefghijk"), "abcdefghijk");
});
