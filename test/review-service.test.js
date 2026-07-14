const test = require("node:test");
const assert = require("node:assert/strict");
const { confirmVideos, reclassifyUnconfirmedVideos, updateVideoAttributes } = require("../lib/review-service");
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

test("reclassification only changes unconfirmed videos", () => {
  const state = emptyState();
  state.videos.push({ videoId: "abcdefghijk", title: "山内瑞葵の対決", status: "unconfirmed" });
  state.videos.push({ videoId: "lmnopqrstuv", title: "確認済み動画", status: "confirmed", genre: "ユーザー確認済み" });
  state.members.push({ name: "山内瑞葵", active: true });
  state.classifications.push({ id: "old", videoId: "abcdefghijk", superseded: false, values: {} });
  const result = reclassifyUnconfirmedVideos(state, ["abcdefghijk", "lmnopqrstuv"], "2026-07-08T00:00:00.000Z");
  assert.equal(result.reclassified, 1);
  assert.equal(state.classifications.find((item) => item.id === "old").superseded, true);
  assert.equal(state.videos.find((video) => video.videoId === "lmnopqrstuv").genre, "ユーザー確認済み");
});

test("video attributes can be edited after confirmation", () => {
  const state = emptyState();
  state.videos.push({ videoId: "abcdefghijk", title: "確認済み", status: "confirmed", tags: [] });
  const result = updateVideoAttributes(state, { videoId: "abcdefghijk", edits: { genre: "トーク・関係性", members: ["山内瑞葵"], productionCost: "中" } }, "2026-07-08T00:00:00.000Z");
  assert.equal(result.status, "updated");
  assert.equal(state.videos[0].genre, "トーク・関係性");
  assert.deepEqual(state.videos[0].members, ["山内瑞葵"]);
  assert.equal(state.reviews.length, 3);
});

test("video attributes retain an explicitly set visibility", () => {
  const state = { videos: [{ videoId: "abcdefghijk", title: "公開設定を持つ動画" }], classifications: [], reviews: [] };
  updateVideoAttributes(state, { videoId: "abcdefghijk", edits: { visibility: "限定公開" } }, "2026-07-08T00:00:00.000Z");
  assert.equal(state.videos[0].visibility, "限定公開");
  assert.equal(state.reviews[0].field, "visibility");
});
