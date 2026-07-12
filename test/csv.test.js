const test = require("node:test");
const assert = require("node:assert/strict");
const { mapYouTubeCsv, parseCsv } = require("../lib/csv");

test("quoted commas and BOM are parsed", () => {
  const rows = parseCsv('\uFEFFコンテンツ,動画のタイトル\nabc,"企画, 前編"\n');
  assert.deepEqual(rows, [["コンテンツ", "動画のタイトル"], ["abc", "企画, 前編"]]);
});

test("YouTube aliases map to canonical fields", () => {
  const result = mapYouTubeCsv("コンテンツ,動画のタイトル,視聴回数,インプレッションのクリック率 (%)\n合計,,1000,4.2\nabcdefghijk,テスト動画,800,5.5\n");
  assert.equal(result.videos[0].videoId, "abcdefghijk");
  assert.equal(result.videos[0].views, 800);
  assert.equal(result.videos[0].ctr, 5.5);
  assert.equal(result.summary.videoId, "合計");
});

test("missing required columns return a readable error", () => {
  assert.throws(() => mapYouTubeCsv("動画のタイトル,視聴回数\nテスト,10\n"), /必須列.*動画ID/);
});

test("YouTube footer note is not treated as a video", () => {
  const result = mapYouTubeCsv("動画ID,動画タイトル\nabcdefghijk,動画\n上位 500 件の結果を表示しています,\n");
  assert.equal(result.videos.length, 1);
  assert.equal(result.ignoredRowCount, 1);
});
