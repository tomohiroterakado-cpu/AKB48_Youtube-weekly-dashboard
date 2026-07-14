function normal(value) { return String(value || "").normalize("NFKC").trim(); }
function number(value) { const parsed = Number(String(value || "").replace(/,/g, "")); return Number.isFinite(parsed) ? parsed : 0; }
function key(value) { const match = String(value || "").match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/); return match ? `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}` : ""; }
function column(headers, name) { return headers.findIndex((item) => normal(item) === normal(name)); }
function cell(row, headers, name) { const index = column(headers, name); return index < 0 ? "" : row[index]; }
function latestManual(rows, headers, weekStart, name) {
  return rows.filter((row) => key(cell(row, headers, "週開始日")) <= weekStart).reverse().map((row) => cell(row, headers, name)).find((value) => String(value || "") !== "") || "";
}
function pace(current, target, weekEnd) {
  const targetDate = new Date("2027-03-31T00:00:00Z");
  const currentDate = new Date(`${weekEnd}T00:00:00Z`);
  const startDate = new Date("2026-04-01T00:00:00Z");
  const remaining = Math.max(1, Math.ceil((targetDate - currentDate) / 604800000));
  const elapsed = Math.max(1, Math.ceil((currentDate - startDate) / 604800000));
  const required = Math.max(0, (target - current) / remaining);
  const actual = current / elapsed;
  return { progress: Math.round(current / target * 1000) / 10, probability: required ? Math.min(100, Math.round(actual / required * 1000) / 10) : 100, requiredWeeklyPace: Math.round(required * 10) / 10 };
}
function enrichGoals(report, values) {
  const weeks = report.weeks.map((week) => {
    const row = values.rows.find((candidate) => key(cell(candidate, values.headers, "週開始日")) === week.week.start);
    if (!row) return week;
    const channel = number(latestManual(values.rows, values.headers, week.week.start, "手入力_チャンネル登録者数_締日時点"));
    const membership = number(latestManual(values.rows, values.headers, week.week.start, "手入力_メンバーシップ会員数_締日時点"));
    const metrics = [
      ["チャンネル登録数", channel, 120000],
      ["視聴回数", number(cell(row, values.headers, "CSV_累計_視聴回数_20260401")), 15000000],
      ["新しい視聴者数", number(cell(row, values.headers, "CSV_累計_新しい視聴者数_20260401")), 1500000],
      ["リピーター", number(cell(row, values.headers, "CSV_累計_リピーター_20260401")), 1800000],
      ["メンバーシップ会員数", membership, 1500]
    ];
    return { ...week, goals: { targetDate: "2027-03-31", items: metrics.map(([label, current, target]) => ({ label, current, target, format: "number", ...pace(current, target, week.week.end) })) } };
  });
  return { ...report, weeks };
}
async function buildReportWithLegacyGoals(repository, report) {
  if (typeof repository.readRange !== "function") return report;
  const result = await repository.readRange("CSV_週次集計!A:ZZ");
  const allRows = result.values || [];
  const headers = allRows[2] || [];
  if (!headers.length) return report;
  return enrichGoals(report, { headers, rows: allRows.slice(3) });
}
module.exports = { buildReportWithLegacyGoals, enrichGoals };
