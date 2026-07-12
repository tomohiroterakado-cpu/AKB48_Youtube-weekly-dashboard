const test = require("node:test");
const assert = require("node:assert/strict");
const { confirmVideos } = require("../lib/review-service");
const { emptyState } = require("../lib/repository");

test("confirmation records adopted and manually corrected fields separately", () => {
  const state = emptyState();
  state.videos.push({ videoId: "abcdefghijk", status: "unconfirmed" });
  state.classifications.push({ videoId: "abcdefghijk", createdAt: "2026-07-01", superseded: false, values: { format: { value: "long" }, genre: { value: "対決・ゲーム" } } });
  const result = confirmVideos(state, { videoIds: ["abcdefghijk"], edits: { abcdefghijk: { format: "long", genre: "密着・ドキュメンタリー" } }, reviewedBy: "tester" }, "2026-07-08T00:00:00.000Z");
  assert.equal(result.confirmed, 1);
  assert.equal(state.videos[0].status, "confirmed");
  assert.equal(state.reviews.find((item) => item.field === "format").source, "user_confirmed");
  assert.equal(state.reviews.find((item) => item.field === "genre").source, "user_manual");
});
