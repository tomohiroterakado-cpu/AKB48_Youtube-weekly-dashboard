const assert = require("node:assert/strict");
const test = require("node:test");
const { ThumbnailGenerationGuard, generationFingerprint, releasePersistentGeneration, reservePersistentGeneration, signThumbnailReview, verifyThumbnailReview } = require("../lib/thumbnail-session");

const review = { source: { requestedCopy: "新テロップ" }, protection: { protectedRegions: [] }, candidates: [{ id: "A" }] };

test("サムネイル候補は署名後に改ざんできず、有効期限を過ぎると使えない", () => {
  const token = signThumbnailReview(review, "secret", 100);
  assert.deepEqual(verifyThumbnailReview(token, "secret", 101), review);
  assert.throws(() => verifyThumbnailReview(`${token}x`, "secret", 101), /確認情報/);
  assert.throws(() => verifyThumbnailReview(token, "secret", 100 + (16 * 60 * 1000)), /時間が切れ/);
});

test("同じ元画像と候補は24時間以内に二重生成できない", () => {
  let now = 100;
  const guard = new ThumbnailGenerationGuard(() => now);
  const fingerprint = generationFingerprint({ review, candidateId: "A", originalImage: "data:image/png;base64,AAAA" });
  guard.reserve(fingerprint);
  assert.throws(() => guard.reserve(fingerprint), /生成済み/);
  now += 24 * 60 * 60 * 1000 + 1;
  assert.doesNotThrow(() => guard.reserve(fingerprint));
});

test("生成済み識別子は永続データでも24時間重複を防ぎ、失敗時は解放できる", () => {
  const state = { thumbnailGenerations: [] };
  reservePersistentGeneration(state, "same", 100);
  assert.throws(() => reservePersistentGeneration(state, "same", 101), /生成済み/);
  releasePersistentGeneration(state, "same");
  assert.doesNotThrow(() => reservePersistentGeneration(state, "same", 102));
  assert.doesNotThrow(() => reservePersistentGeneration(state, "expired", 0));
  assert.doesNotThrow(() => reservePersistentGeneration(state, "expired", (24 * 60 * 60 * 1000) + 1));
});
