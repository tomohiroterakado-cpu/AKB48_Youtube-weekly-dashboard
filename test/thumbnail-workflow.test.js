const assert = require("node:assert/strict");
const test = require("node:test");
const { createThumbnailReview, selectThumbnailCandidate, assessThumbnailQuality } = require("../lib/thumbnail-workflow");
const { MAX_SOURCE_IMAGE_BYTES, dataUrlToBlob, buildImageEditPrompt, generateImages2Design } = require("../lib/images2-client");

const input = {
  jobId: "kawasaki-brave-thunders-wallart",
  requestedCopy: "コラボウォールアートが大きすぎ！？",
  protectedRegions: [
    { name: "左下の顔", type: "face", x: 0.21, y: 0.59, w: 0.13, h: 0.18 },
    { name: "協業ロゴ", type: "logo", x: 0.55, y: 0, w: 0.41, h: 0.19 }
  ]
};

test("5案を提示し、選択前は生成を許可しない", () => {
  const review = createThumbnailReview(input);
  assert.equal(review.status, "awaiting_selection");
  assert.deepEqual(review.candidates.map((candidate) => candidate.id), ["A", "B", "C", "D", "E"]);
  assert.equal(review.generation.allowed, false);
  assert.equal(review.protection.faceStrategy, "restore_original_after_generation");
});

test("選択案だけをImages2.0制作ブリーフへ変換する", () => {
  const review = createThumbnailReview(input);
  assert.throws(() => selectThumbnailCandidate(review, "Z"), /候補 A〜E/);
  const selected = selectThumbnailCandidate(review, "D");
  assert.equal(selected.status, "ready_for_generation");
  assert.equal(selected.selectedCandidate.name, "坂道チャンネル参考型");
  assert.equal(selected.roles.originalComposite, "顔・ロゴ保護担当");
});

test("顔・日本語・顔被りに問題があれば完成を止める", () => {
  const quality = assessThumbnailQuality({
    faceLock: false, logoLock: true, textAccuracy: false, telopQuality: true,
    faceOverlap: false, mobileReadability: true, youtubeUiSafety: true
  });
  assert.equal(quality.status, "revision_required");
  assert.deepEqual(quality.fallbacks, ["restore_original_faces", "photoshop_text", "reposition_telop"]);
});

test("Images2.0への指示はテロップだけを変え、保護対象を明示する", () => {
  const production = selectThumbnailCandidate(createThumbnailReview(input), "A");
  const prompt = buildImageEditPrompt(production);
  assert.match(prompt, /コラボウォールアートが大きすぎ！？/);
  assert.match(prompt, /左下の顔/);
  assert.match(prompt, /Do not add, remove, replace, or alter faces/);
});

test("画像生成APIは画面側の制限を回避した8MB超の画像を受け付けない", () => {
  const image = `data:image/png;base64,${Buffer.alloc(MAX_SOURCE_IMAGE_BYTES + 1).toString("base64")}`;
  assert.throws(() => dataUrlToBlob(image), /8MB以下/);
});

test("選択案だけを画像編集APIへ渡し、Base64のPNGを返す", async () => {
  const production = selectThumbnailCandidate(createThumbnailReview(input), "A");
  let request;
  const output = await generateImages2Design({
    originalImage: "data:image/png;base64,iVBORw0KGgo=",
    production,
    outputSize: { width: 1280, height: 720 },
    apiKey: "test-key",
    model: "gpt-image-2",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ data: [{ b64_json: "ZmFrZQ==" }] }) };
    }
  });
  assert.equal(request.url, "https://api.openai.com/v1/images/edits");
  assert.equal(request.options.body.get("model"), "gpt-image-2");
  assert.ok(request.options.body.get("image[]"));
  assert.equal(request.options.body.get("size"), "1280x720");
  assert.equal(output.outputSize, "1280x720");
  assert.equal(output.imageDataUrl, "data:image/png;base64,ZmFrZQ==");
});
