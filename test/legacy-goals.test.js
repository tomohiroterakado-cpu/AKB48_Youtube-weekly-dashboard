const test = require("node:test");
const assert = require("node:assert/strict");
const { enrichGoals, enrichNarrative, enrichMembershipKpis } = require("../lib/legacy-goals");

test("legacy goal progress uses the latest cumulative cells without summing them twice", () => {
  const report = { weeks: [{ week: { start: "2026-07-04", end: "2026-07-10" }, goals: { items: [] } }] };
  const headers = ["週開始日", "手入力_チャンネル登録者数_締日時点", "CSV_累計_視聴回数_20260401", "CSV_累計_新しい視聴者数_20260401", "CSV_累計_リピーター_20260401", "手入力_メンバーシップ会員数_締日時点"];
  const rows = [["2026-06-29", "98944", "9234877", "692986", "386374", "2160"], ["2026-07-04", "", "9756076", "718852", "477047", "2164"]];
  const goals = enrichGoals(report, { headers, rows }).weeks[0].goals.items;
  assert.equal(goals.find((item) => item.label === "視聴回数").current, 9756076);
  assert.equal(goals.find((item) => item.label === "新しい視聴者数").current, 718852);
  assert.equal(goals.find((item) => item.label === "メンバーシップ会員数").current, 2164);
});

test("membership card uses the closing member count as the main value and the week-over-week change as the note", () => {
  const report = {
    weeks: [{
      week: { start: "2026-07-04", end: "2026-07-10" },
      kpis: [
        { label: "チャンネル登録者増加数", value: 744 },
        { label: "メンバーシップ増減数", value: 4 }
      ]
    }]
  };
  const headers = ["週開始日", "手入力_メンバーシップ会員数_締日時点"];
  const rows = [["2026-06-29", "2160"], ["2026-07-04", "2164"]];
  const kpis = enrichMembershipKpis(report, { headers, rows }).weeks[0].kpis;
  assert.deepEqual(kpis.map((item) => item.label), ["チャンネル登録者増加数", "メンバーシップ会員数"]);
  assert.deepEqual(kpis[1], {
    label: "メンバーシップ会員数",
    value: 2164,
    format: "number",
    note: "前週比 +4人 / 締日時点手入力"
  });
});

test("membership card does not compare against an older week when the immediately previous closing count is missing", () => {
  const report = { weeks: [{ week: { start: "2026-07-11", end: "2026-07-17" }, kpis: [] }] };
  const headers = ["週開始日", "手入力_メンバーシップ会員数_締日時点"];
  const rows = [["2026-06-29", "2160"], ["2026-07-04", ""], ["2026-07-11", "2200"]];
  const card = enrichMembershipKpis(report, { headers, rows }).weeks[0].kpis[0];
  assert.equal(card.value, 2200);
  assert.match(card.note, /比較週なし/);
});

test("membership card preserves zero and marks a missing closing count as unavailable", () => {
  const headers = ["週開始日", "手入力_メンバーシップ会員数_締日時点"];
  const zeroReport = { weeks: [{ week: { start: "2026-07-04", end: "2026-07-10" }, kpis: [] }] };
  const zeroRows = [["2026-06-29", "10"], ["2026-07-04", 0]];
  const zeroCard = enrichMembershipKpis(zeroReport, { headers, rows: zeroRows }).weeks[0].kpis[0];
  assert.equal(zeroCard.value, 0);
  assert.match(zeroCard.note, /前週比 -10人/);

  const blankReport = { weeks: [{ week: { start: "2026-07-04", end: "2026-07-10" }, kpis: [] }] };
  const blankRows = [["2026-06-29", "2160"], ["2026-07-04", ""]];
  const blankCard = enrichMembershipKpis(blankReport, { headers, rows: blankRows }).weeks[0].kpis[0];
  assert.equal(blankCard.value, null);
  assert.equal(blankCard.note, "締日時点未入力");
});

test("membership goal is unavailable until the selected week's closing count is entered", () => {
  const report = { weeks: [{ week: { start: "2026-07-04", end: "2026-07-10" }, goals: { items: [] } }] };
  const headers = ["週開始日", "CSV_累計_視聴回数_20260401", "CSV_累計_新しい視聴者数_20260401", "CSV_累計_リピーター_20260401", "手入力_メンバーシップ会員数_締日時点"];
  const rows = [["2026-06-29", 100, 10, 20, 2160], ["2026-07-04", 200, 20, 40, ""]];
  const membershipGoal = enrichGoals(report, { headers, rows }).weeks[0].goals.items.find((item) => item.label === "メンバーシップ会員数");
  assert.equal(membershipGoal.current, null);
  assert.equal(membershipGoal.unavailable, true);
});

test("legacy weekly rows generate a concrete report with comparisons and three execution ideas", () => {
  const report = {
    weeks: [{
      week: { start: "2026-07-04", end: "2026-07-10" },
      kpis: [{ label: "長尺平均高評価", value: 1261, note: "週内公開の長尺 4本平均" }],
      topVideos: [{ title: "AKB48ワールドカップ", views: 47963 }]
    }]
  };
  const headers = ["週開始日", "総視聴回数", "チャンネル登録者増加数", "ユニーク視聴者数", "新しい視聴者数", "リピーター", "インプレッション数"];
  const rows = [
    ["2026-06-29", 492020, 766, 108864, 24259, 84530, 6510509],
    ["2026-07-04", 521199, 744, 116487, 25866, 90673, 6576221]
  ];
  const week = enrichNarrative(report, { headers, rows }).weeks[0];
  assert.match(week.headline, /AKB48ワールドカップ/);
  assert.equal(week.trend.sections.length, 3);
  assert.match(week.insights[1].text, /登録者増加/);
  assert.equal(week.actions.length, 3);
  assert.equal(week.ideas.length, 3);
});
