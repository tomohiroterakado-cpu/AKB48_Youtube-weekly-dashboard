const test = require("node:test");
const assert = require("node:assert/strict");
const { commitImport, commitWeeklyImport, previewImport, previewWeeklyImport } = require("../lib/import-service");
const { MemoryRepository } = require("../lib/repository");

const csv = "コンテンツ,動画のタイトル,動画公開時刻,長さ,視聴回数\nabcdefghijk,【初公開】山内瑞葵が対決,Jul 4 2026,900,1000\n";
const base = { fileName: "表データ.csv", periodStart: "2026-06-29", periodEnd: "2026-07-05", channel: "AKBの素を出すちゃんねる", csvText: csv };

test("first import creates one unconfirmed video", async () => {
  const repository = new MemoryRepository();
  const result = await commitImport(repository, base);
  const state = await repository.read();
  assert.equal(result.newVideoCount, 1);
  assert.equal(state.videos[0].status, "unconfirmed");
  assert.equal(state.metrics.length, 1);
  assert.equal(state.classifications.length, 1);
});

test("same file hash is skipped", async () => {
  const repository = new MemoryRepository();
  await commitImport(repository, base);
  const result = await commitImport(repository, base);
  const state = await repository.read();
  assert.equal(result.status, "skipped_duplicate");
  assert.equal(state.imports.length, 1);
  assert.equal(state.metrics.length, 1);
});

test("same period with a changed export keeps a new version", async () => {
  const repository = new MemoryRepository();
  await commitImport(repository, base);
  await commitImport(repository, { ...base, csvText: csv.replace("1000", "1200"), fileName: "表データ_更新.csv" });
  const state = await repository.read();
  assert.equal(state.videos.length, 1);
  assert.equal(state.metrics.length, 2);
  assert.equal(state.metrics[0].current, false);
  assert.equal(state.metrics[1].version, 2);
});

test("preview reports missing values without crashing", async () => {
  const repository = new MemoryRepository();
  const preview = await previewImport(repository, { ...base, csvText: "動画ID,動画タイトル\nabcdefghijk,テスト\n" });
  assert.equal(preview.missingCounts.publishedAt, 1);
  assert.equal(preview.registeredVideoCount, 1);
});

test("invalid CSV previews leave an error record", async () => {
  const repository = new MemoryRepository();
  await assert.rejects(previewImport(repository, { ...base, csvText: "動画タイトル,視聴回数\nテスト,10\n" }), /必須列/);
  const state = await repository.read();
  assert.equal(state.imports[0].status, "error");
  assert.match(state.imports[0].error, /必須列/);
});

test("historical first-seen videos do not require weekly review", async () => {
  const repository = new MemoryRepository();
  const content = "動画ID,動画タイトル,公開日時\nabcdefghijk,過去動画,Jun 1 2026\nlmnopqrstuv,今週動画,Jul 4 2026\n";
  const result = await commitImport(repository, { ...base, csvText: content });
  const state = await repository.read();
  assert.equal(result.manualReviewCount, 1);
  assert.equal(state.videos.find((video) => video.videoId === "abcdefghijk").status, "historical");
  assert.equal(state.videos.find((video) => video.videoId === "lmnopqrstuv").status, "unconfirmed");
});

test("confirmed video attributes are not overwritten by a later import", async () => {
  const repository = new MemoryRepository();
  await commitImport(repository, base);
  await repository.mutate((state) => {
    state.videos[0].status = "confirmed";
    state.videos[0].genre = "ユーザー確認済みジャンル";
  });
  await commitImport(repository, { ...base, fileName: "翌週.csv", periodStart: "2026-07-06", periodEnd: "2026-07-12", csvText: csv.replace("1000", "1500") });
  const state = await repository.read();
  assert.equal(state.videos[0].genre, "ユーザー確認済みジャンル");
  assert.equal(state.videos[0].status, "confirmed");
  assert.equal(state.classifications.length, 1);
});

test("visibility is imported without overwriting a manually confirmed visibility", async () => {
  const repository = new MemoryRepository();
  await commitImport(repository, { ...base, csvText: "動画ID,動画タイトル,公開日時,公開設定\nabcdefghijk,テスト,Jul 4 2026,限定公開\n" });
  let state = await repository.read();
  assert.equal(state.videos[0].visibility, "限定公開");
  await repository.mutate((draft) => { draft.videos[0].visibility = "公開"; });
  await commitImport(repository, { ...base, fileName: "翌週.csv", periodStart: "2026-07-06", periodEnd: "2026-07-12", csvText: "動画ID,動画タイトル,公開日時,公開設定\nabcdefghijk,テスト,Jul 4 2026,限定公開\n" });
  state = await repository.read();
  assert.equal(state.videos[0].visibility, "公開");
});

test("an interrupted import is resumed under the original import id", async () => {
  const repository = new MemoryRepository();
  const processingId = "import_processing";
  const state = await repository.read();
  state.imports.push({ id: processingId, fileHash: require("../lib/import-service").sha256(csv), status: "processing", newVideoCount: 1 });
  state.videos.push({ videoId: "abcdefghijk", title: "途中まで保存された動画", status: "unconfirmed" });
  state.metrics.push({ id: "partial", importId: processingId, videoId: "abcdefghijk", periodStart: base.periodStart, periodEnd: base.periodEnd, version: 1, current: true, values: {} });
  repository.state = state;
  const result = await commitImport(repository, base);
  const completed = (await repository.read()).imports;
  const metrics = (await repository.read()).metrics;
  assert.equal(completed.length, 1);
  assert.equal(completed[0].id, processingId);
  assert.equal(completed[0].status, "completed");
  assert.equal(result.manualReviewCount, 1);
  assert.equal(metrics.filter((item) => item.current).length, 1);
});

const weeklyBase = {
  contentFileName: "コンテンツ別.csv",
  contentCsvText: csv,
  dailyFileName: "日別.csv",
  dailyCsvText: "日付,ユニーク視聴者数,視聴回数\n2026-07-04,100,300\n2026-07-05,110,320\n2026-07-06,120,340\n2026-07-07,130,360\n2026-07-08,140,380\n2026-07-09,150,400\n2026-07-10,160,420\n",
  periodStart: "2026-07-04",
  periodEnd: "2026-07-10",
  channel: "AKBの素を出すちゃんねる"
};

test("weekly import stores content and daily CSVs separately", async () => {
  const repository = new MemoryRepository();
  const result = await commitWeeklyImport(repository, weeklyBase);
  const state = await repository.read();
  assert.equal(result.status, "completed");
  assert.equal(state.imports.length, 1);
  assert.equal(state.dailyImports.length, 1);
  assert.equal(state.dailyMetrics.length, 7);
  assert.equal(state.dailyMetrics.find((item) => item.date === "2026-07-10").values.uniqueViewers, 160);
});

test("weekly import rejects a period that is not Saturday through Friday", async () => {
  const repository = new MemoryRepository();
  await assert.rejects(previewWeeklyImport(repository, { ...weeklyBase, periodStart: "2026-07-05", periodEnd: "2026-07-11" }), /土曜日開始・金曜日終了/);
});

test("same weekly CSV pair is skipped without duplicate daily rows", async () => {
  const repository = new MemoryRepository();
  await commitWeeklyImport(repository, weeklyBase);
  const result = await commitWeeklyImport(repository, weeklyBase);
  const state = await repository.read();
  assert.equal(result.status, "skipped_duplicate");
  assert.equal(state.dailyMetrics.length, 7);
});
