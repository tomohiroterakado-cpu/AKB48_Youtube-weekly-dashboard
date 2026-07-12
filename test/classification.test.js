const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyVideo, extractTitleFeatures } = require("../lib/classification");

test("title features are extracted deterministically", () => {
  const result = extractTitleFeatures("【初公開】AKB48で本気の対決！？ #山内瑞葵");
  assert.equal(result.hasBrackets, true);
  assert.equal(result.hasAkb48, true);
  assert.equal(result.isQuestion, true);
  assert.deepEqual(result.hashtags, ["山内瑞葵"]);
});

test("confirmed master member match has high confidence", () => {
  const result = classifyVideo({ videoId: "abc", title: "山内瑞葵が本気の対決", durationSeconds: 900 }, ["山内瑞葵"]);
  assert.deepEqual(result.members.value, ["山内瑞葵"]);
  assert.equal(result.members.needsReview, false);
  assert.equal(result.genre.value, "対決・ゲーム");
});

test("short duration alone remains a candidate", () => {
  const result = classifyVideo({ videoId: "abc", title: "短い動画", durationSeconds: 90 }, []);
  assert.equal(result.format.value, "shorts_candidate");
  assert.equal(result.format.needsReview, true);
});
