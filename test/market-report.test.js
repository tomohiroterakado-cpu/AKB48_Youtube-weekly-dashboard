const test = require("node:test");
const assert = require("node:assert/strict");
const { attachMarketReports, marketReportFromEmail, upsertMarketReport } = require("../lib/market-report");

const report = { weeks: [{ week: { start: "2026-07-04", end: "2026-07-10" } }] };

test("the received market report is attached only to the matching weekly report", () => {
  const week = attachMarketReports(report).weeks[0];
  assert.equal(week.marketReport.source, "Gmail");
  assert.equal(week.marketReport.data.sections.length, 3);
  assert.match(week.marketReport.data.sections[2].status, /判定不可/);
});

test("a Gmail market report extracts its period and keeps missing social data as unavailable", () => {
  const item = marketReportFromEmail({
    subject: "週次市場調査レポート",
    body: "対象: 2026/07/11〜2026/07/17\n5. 競合/参考チャンネルの注目事例\n- 競合の参考情報 https://example.com/competitor\n6. 日本YouTube全体のトレンド/注目コンテンツ\n- Shortsの参考情報 https://example.com/youtube\n7. ファン心理・第三者目線"
  });
  assert.equal(item.periodStart, "2026-07-11");
  assert.equal(item.periodEnd, "2026-07-17");
  assert.match(item.data.sections[2].status, /判定不可/);
});

test("the same Gmail report is skipped rather than duplicated", () => {
  const state = { marketReports: [] };
  const item = marketReportFromEmail({ body: "対象: 2026/07/11〜2026/07/17\n5. 競合\n参考 https://example.com/a\n6. YouTube\n参考 https://example.com/b", subject: "週次市場調査レポート" });
  assert.equal(upsertMarketReport(state, item).status, "created");
  assert.equal(upsertMarketReport(state, item).status, "skipped_duplicate");
  assert.equal(state.marketReports.length, 1);
});

test("a period that is not Saturday through Friday is rejected", () => {
  assert.throws(() => marketReportFromEmail({
    body: "対象: 2026/07/12〜2026/07/18",
    subject: "週次市場調査レポート"
  }), /土曜日00:00から金曜日23:59/);
});

test("a revised mail for the same period is saved for review without replacing the active report", () => {
  const state = { marketReports: [] };
  const original = marketReportFromEmail({ body: "対象: 2026/07/11〜2026/07/17\n5. 競合\n参考 https://example.com/a\n6. YouTube\n参考 https://example.com/b", subject: "週次市場調査レポート A" });
  const revision = marketReportFromEmail({ body: "対象: 2026/07/11〜2026/07/17\n5. 競合\n参考 https://example.com/a2\n6. YouTube\n参考 https://example.com/b2", subject: "週次市場調査レポート B" });
  assert.equal(upsertMarketReport(state, original).status, "created");
  assert.equal(upsertMarketReport(state, revision).status, "needs_review");
  assert.equal(state.marketReports.length, 2);
  assert.equal(state.marketReports[0].status, "reference");
  assert.equal(state.marketReports[1].status, "pending_review");
});
