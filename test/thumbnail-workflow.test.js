const assert = require("node:assert/strict");
const test = require("node:test");
const { createThumbnailReview, computeTelopSafeArea, selectThumbnailCandidate, selectThumbnailPreviewCandidates, selectAllThumbnailPreviewCandidates, assessThumbnailQuality } = require("../lib/thumbnail-workflow");
const { MAX_SOURCE_IMAGE_BYTES, dataUrlToBlob, buildImageEditPrompt, generateImages2Design, normalizedOutputSize } = require("../lib/images2-client");

const input = {
  jobId: "kawasaki-brave-thunders-wallart",
  requestedCopy: "コラボウォールアートが大きすぎ！？",
  protectedRegions: [
    { name: "左下の顔", type: "face", shape: "ellipse", x: 0.21, y: 0.59, w: 0.13, h: 0.18 },
    { name: "協業ロゴ", type: "logo", x: 0.55, y: 0, w: 0.41, h: 0.19 }
  ]
};

test("6案を提示し、指定テロップを変えずに選択前は生成を許可しない", () => {
  const review = createThumbnailReview(input);
  assert.equal(review.status, "awaiting_selection");
  assert.deepEqual(review.candidates.map((candidate) => candidate.id), ["A", "B", "C", "D", "E", "F"]);
  assert.ok(review.candidates.every((candidate) => candidate.recommendedCopy === input.requestedCopy));
  assert.equal(review.candidates.at(-1).name, "シンプルテロップ型");
  assert.equal(review.generation.allowed, false);
  assert.equal(review.protection.faceStrategy, "restore_original_after_generation");
  assert.equal(review.protection.protectedRegions[0].shape, "ellipse");
  assert.ok(review.protection.telopSafeArea);
  assert.equal(review.protection.textStrategy, "safe_area_exact_overlay");
});

test("テロップ安全領域は保護領域と十分な余白を含めて重ならない", () => {
  const safeArea = computeTelopSafeArea(input.protectedRegions);
  assert.ok(safeArea);
  input.protectedRegions.forEach((region) => {
    const padded = {
      x: Math.max(0, region.x - 0.024),
      y: Math.max(0, region.y - 0.024),
      w: Math.min(1, region.x + region.w + 0.024) - Math.max(0, region.x - 0.024),
      h: Math.min(1, region.y + region.h + 0.024) - Math.max(0, region.y - 0.024)
    };
    const overlaps = safeArea.x < padded.x + padded.w && safeArea.x + safeArea.w > padded.x && safeArea.y < padded.y + padded.h && safeArea.y + safeArea.h > padded.y;
    assert.equal(overlaps, false);
  });
});

test("選択案だけをImages2.0制作ブリーフへ変換する", () => {
  const review = createThumbnailReview(input);
  assert.throws(() => selectThumbnailCandidate(review, "Z"), /候補 A〜F/);
  const selected = selectThumbnailCandidate(review, "D");
  assert.equal(selected.status, "ready_for_generation");
  assert.equal(selected.selectedCandidate.name, "坂道チャンネル参考型");
  assert.equal(selected.roles.originalComposite, "顔・ロゴ保護担当");
  assert.deepEqual(selected.images2Brief.telopSafeArea, review.protection.telopSafeArea);
});

test("低画質プレビュー用には重複なしで任意の2案だけを選べる", () => {
  const review = createThumbnailReview(input);
  assert.throws(() => selectThumbnailPreviewCandidates(review, ["A"]), /2案/);
  assert.throws(() => selectThumbnailPreviewCandidates(review, ["A", "A"]), /重複なし/);
  assert.deepEqual(selectThumbnailPreviewCandidates(review, ["B", "E"]).map((item) => item.selectedCandidate.id), ["B", "E"]);
});

test("比較優先では設計済みの6案すべてをプレビュー用に選べる", () => {
  const review = createThumbnailReview(input);
  assert.deepEqual(selectAllThumbnailPreviewCandidates(review).map((item) => item.selectedCandidate.id), ["A", "B", "C", "D", "E", "F"]);
});

test("顔・日本語・顔被りに問題があれば完成を止める", () => {
  const quality = assessThumbnailQuality({
    faceLock: false, logoLock: true, textAccuracy: false, telopQuality: true,
    faceOverlap: false, mobileReadability: true, youtubeUiSafety: true
  });
  assert.equal(quality.status, "revision_required");
  assert.deepEqual(quality.fallbacks, ["restore_original_faces", "photoshop_text", "reposition_telop"]);
});

test("Images2.0への指示は保護対象とテロップ安全領域を明示する", () => {
  const production = selectThumbnailCandidate(createThumbnailReview(input), "A");
  const prompt = buildImageEditPrompt(production);
  assert.match(prompt, /コラボウォールアートが大きすぎ！？/);
  assert.match(prompt, /左下の顔/);
  assert.match(prompt, /Do not add, remove, replace, or alter faces/);
  assert.match(prompt, /Reserve this clear text-safe area/);
  assert.match(prompt, /The application will typeset the exact requested copy after generation/);
  assert.match(prompt, /Do not render Japanese text/);
  assert.match(prompt, /without creating a banner, base panel, ribbon, plaque, or caption plate/);
  assert.match(prompt, /one tone calmer than a flashy gaming thumbnail/);
});

test("画像生成APIは画面側の制限を回避した8MB超の画像を受け付けない", () => {
  const image = `data:image/png;base64,${Buffer.alloc(MAX_SOURCE_IMAGE_BYTES + 1).toString("base64")}`;
  assert.throws(() => dataUrlToBlob(image), /8MB以下/);
});

test("画像生成用のサイズは16の倍数へ正規化する", () => {
  assert.equal(normalizedOutputSize({ width: 1706, height: 960 }), "1712x960");
  assert.equal(normalizedOutputSize({ width: 1280, height: 720 }), "1280x720");
  assert.equal(normalizedOutputSize({ width: 400, height: 300 }), "auto");
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
  assert.equal(request.options.body.get("quality"), "high");
  assert.equal(output.outputSize, "1280x720");
  assert.equal(output.imageDataUrl, "data:image/png;base64,ZmFrZQ==");
});

test("比較プレビューはlow品質を指定できる", async () => {
  const production = selectThumbnailCandidate(createThumbnailReview(input), "B");
  let request;
  const output = await generateImages2Design({
    originalImage: "data:image/png;base64,iVBORw0KGgo=",
    production,
    outputSize: { width: 1024, height: 576 },
    quality: "low",
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ data: [{ b64_json: "ZmFrZQ==" }] }) };
    }
  });
  assert.equal(request.options.body.get("size"), "1024x576");
  assert.equal(request.options.body.get("quality"), "low");
  assert.equal(output.quality, "low");
});
