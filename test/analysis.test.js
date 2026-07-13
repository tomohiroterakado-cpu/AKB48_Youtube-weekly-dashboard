const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDirectorReport, confidenceForState } = require("../lib/analysis");
const { ANALYSIS_CONFIDENCE } = require("../lib/analysis-config");
const { emptyState } = require("../lib/repository");

test("one week is labelled low confidence", () => {
  const state = emptyState();
  state.imports.push({ id: "i1", periodStart: "2026-06-29", periodEnd: "2026-07-05", uploadedAt: "2026-07-07", summary: {} });
  state.videos.push({ videoId: "abcdefghijk", title: "動画A" });
  state.metrics.push({ importId: "i1", videoId: "abcdefghijk", current: true, values: { views: 1000, impressions: 5000, ctr: 5 } });
  const report = buildDirectorReport(state);
  assert.equal(report.status, "参考値");
  assert.equal(report.confidence.level, "低");
  assert.match(report.interpretations[0].text, /判定不可/);
});

test("confidence is unavailable without data", () => {
  assert.equal(confidenceForState(emptyState()).level, "判定不可");
});

test("confidence thresholds come from the dedicated settings file", () => {
  const state = emptyState();
  for (let week = 0; week < ANALYSIS_CONFIDENCE.medium.minimumWeeks; week += 1) {
    state.imports.push({ id: `i${week}`, periodStart: `2026-0${week + 1}-01`, periodEnd: `2026-0${week + 1}-07` });
  }
  for (let video = 0; video < ANALYSIS_CONFIDENCE.medium.minimumVideos; video += 1) {
    state.metrics.push({ current: true, videoId: `video${video}` });
  }
  assert.equal(confidenceForState(state).level, "中");
});
