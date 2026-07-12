const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDirectorReport, confidenceForState } = require("../lib/analysis");
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
