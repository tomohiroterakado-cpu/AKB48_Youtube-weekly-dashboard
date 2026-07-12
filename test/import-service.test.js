const test = require("node:test");
const assert = require("node:assert/strict");
const { commitImport, previewImport } = require("../lib/import-service");
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
