const test = require("node:test");
const assert = require("node:assert/strict");
const { enrichGoals } = require("../lib/legacy-goals");

test("legacy goal progress uses the latest cumulative cells without summing them twice", () => {
  const report = { weeks: [{ week: { start: "2026-07-04", end: "2026-07-10" }, goals: { items: [] } }] };
  const headers = ["週開始日", "手入力_チャンネル登録者数_締日時点", "CSV_累計_視聴回数_20260401", "CSV_累計_新しい視聴者数_20260401", "CSV_累計_リピーター_20260401", "手入力_メンバーシップ会員数_締日時点"];
  const rows = [["2026-06-29", "98944", "9234877", "692986", "386374", "2160"], ["2026-07-04", "", "9756076", "718852", "477047", ""]];
  const goals = enrichGoals(report, { headers, rows }).weeks[0].goals.items;
  assert.equal(goals.find((item) => item.label === "視聴回数").current, 9756076);
  assert.equal(goals.find((item) => item.label === "新しい視聴者数").current, 718852);
  assert.equal(goals.find((item) => item.label === "メンバーシップ会員数").current, 2160);
});
