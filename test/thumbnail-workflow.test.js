const assert = require("node:assert/strict");
const test = require("node:test");
const { createThumbnailReview, selectThumbnailCandidate, selectThumbnailPreviewCandidates, selectAllThumbnailPreviewCandidates, assessThumbnailQuality } = require("../lib/thumbnail-workflow");
const { MAX_SOURCE_IMAGE_BYTES, MIN_IMAGE_PIXEL_BUDGET, dataUrlToBlob, buildImageEditPrompt, generateImages2Design, normalizedOutputSize, normalizedQuality } = require("../lib/images2-client");

const input = {
  jobId: "kawasaki-brave-thunders-wallart",
  requestedCopy: "コラボウォールアートが大きすぎ！？",
  editRegions: [
    { brushSize: 0.14, points: [{ x: 0.1, y: 0.68 }, { x: 0.43, y: 0.61 }, { x: 0.76, y: 0.68 }] }
  ]
};

test("6案を提示し、指定テロップを変えずに選択前は生成を許可しない", () => {
  const review = createThumbnailReview(input);
  assert.equal(review.status, "awaiting_selection");
  assert.deepEqual(review.candidates.map((candidate) => candidate.id), ["A", "B", "C", "D", "E", "F"]);
  assert.ok(review.candidates.every((candidate) => candidate.recommendedCopy === input.requestedCopy));
  assert.equal(review.candidates.at(-1).name, "シンプルテロップ型");
  assert.equal(review.generation.allowed, false);
  assert.equal(review.editing.mode, "brush_only");
  assert.equal(review.editing.editRegions[0].brushSize, 0.14);
});

test("編集ブラシで塗った範囲だけを編集対象として候補へ引き継ぐ", () => {
  const review = createThumbnailReview({
    jobId: "brush-edit",
    requestedCopy: "この部分を修正",
    editRegions: [{
      brushSize: 0.12,
      points: [{ x: 0.12, y: 0.68 }, { x: 0.72, y: 0.68 }]
    }]
  });
  const selected = selectThumbnailCandidate(review, "C");

  assert.equal(review.editing.mode, "brush_only");
  assert.equal(review.editing.editRegions.length, 1);
  assert.deepEqual(selected.images2Brief.editRegions[0].points, [{ x: 0.12, y: 0.68 }, { x: 0.72, y: 0.68 }]);
  assert.match(selected.images2Brief.instruction, /ブラシで塗った範囲だけ/);
  assert.match(selected.compositePlan.strategy, /元画像を土台/);
});

test("編集ブラシの座標や太さが不正な場合は受け付けない", () => {
  assert.throws(() => createThumbnailReview({
    jobId: "invalid-brush",
    requestedCopy: "テロップ",
    editRegions: [{ brushSize: 1.2, points: [{ x: 0.2, y: 0.4 }] }]
  }), /編集ブラシ 1/);
});

test("離れたブラシ範囲はテロップが欠けないよう単一領域として描き直しを求める", () => {
  assert.throws(() => createThumbnailReview({
    jobId: "split-brush",
    requestedCopy: "テロップ",
    editRegions: [
      { brushSize: 0.08, points: [{ x: 0.1, y: 0.2 }] },
      { brushSize: 0.08, points: [{ x: 0.8, y: 0.8 }] }
    ]
  }), /ひと続き/);
});

test("選択案だけをImages2.0制作ブリーフへ変換する", () => {
  const review = createThumbnailReview(input);
  assert.throws(() => selectThumbnailCandidate(review, "Z"), /候補 A〜F/);
  const selected = selectThumbnailCandidate(review, "D");
  assert.equal(selected.status, "ready_for_generation");
  assert.equal(selected.selectedCandidate.name, "坂道チャンネル参考型");
  assert.equal(selected.roles.brushComposite, "編集ブラシ合成担当");
});

test("低画質比較では任意の2案または6案全体を選べる", () => {
  const review = createThumbnailReview(input);
  assert.throws(() => selectThumbnailPreviewCandidates(review, ["A"]), /重複なく2案/);
  assert.deepEqual(selectThumbnailPreviewCandidates(review, ["A", "C"]).map((item) => item.selectedCandidate.id), ["A", "C"]);
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

test("Images2.0への指示はブラシ内だけを編集対象として明示する", () => {
  const production = selectThumbnailCandidate(createThumbnailReview(input), "A");
  const prompt = buildImageEditPrompt(production);
  assert.match(prompt, /Do not render any Japanese text/);
  assert.doesNotMatch(prompt, /コラボウォールアートが大きすぎ！？/);
  assert.match(prompt, /editable zone/);
  assert.match(prompt, /x 0\.030–0\.830/);
  assert.match(prompt, /Do not add, remove, replace, or alter faces/);
  assert.match(prompt, /one tone calmer than a flashy gaming thumbnail/);
});

test("長いブラシ筆跡でもImages2.0のプロンプト上限を超えない", () => {
  const points = Array.from({ length: 2400 }, (_, index) => ({
    x: 0.08 + (index % 80) * 0.01,
    y: 0.58 + Math.floor(index / 80) * 0.004
  }));
  const production = selectThumbnailCandidate(createThumbnailReview({
    jobId: "long-brush",
    requestedCopy: "逆再生　これを聞き取れたら天才",
    editRegions: [{ brushSize: 0.12, points }]
  }), "A");

  const prompt = buildImageEditPrompt(production);
  assert.ok(prompt.length <= 32000, `prompt length was ${prompt.length}`);
  assert.match(prompt, /exact brush mask/);
});

test("画像生成APIは画面側の制限を回避した8MB超の画像を受け付けない", () => {
  const image = `data:image/png;base64,${Buffer.alloc(MAX_SOURCE_IMAGE_BYTES + 1).toString("base64")}`;
  assert.throws(() => dataUrlToBlob(image), /8MB以下/);
});

test("画像生成用のサイズは16の倍数へ正規化する", () => {
  assert.equal(normalizedOutputSize({ width: 1706, height: 960 }), "1712x960");
  assert.equal(normalizedOutputSize({ width: 1536, height: 864 }), "1536x864");
  assert.equal(normalizedOutputSize({ width: 1024, height: 576 }), "auto");
  assert.equal(MIN_IMAGE_PIXEL_BUDGET, 1024 * 1024);
  assert.equal(normalizedOutputSize({ width: 400, height: 300 }), "auto");
  assert.equal(normalizedQuality("low"), "low");
  assert.equal(normalizedQuality("unknown"), "high");
});

test("最小ピクセル数のエラー時はサイズautoで一度だけ再試行する", async () => {
  const production = selectThumbnailCandidate(createThumbnailReview(input), "A");
  const sizes = [];
  const output = await generateImages2Design({
    originalImage: "data:image/png;base64,iVBORw0KGgo=",
    production,
    outputSize: { width: 1536, height: 864 },
    quality: "low",
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      sizes.push(options.body.get("size"));
      if (sizes.length === 1) return { ok: false, status: 400, json: async () => ({ error: { message: "Requested resolution is below the current minimum pixel budget." } }) };
      return { ok: true, json: async () => ({ data: [{ b64_json: "ZmFrZQ==" }] }) };
    }
  });
  assert.deepEqual(sizes, ["1536x864", "auto"]);
  assert.equal(output.outputSize, "auto");
});

test("選択案だけを画像編集APIへ渡し、Base64のPNGを返す", async () => {
  const production = selectThumbnailCandidate(createThumbnailReview(input), "A");
  let request;
  const output = await generateImages2Design({
    originalImage: "data:image/png;base64,iVBORw0KGgo=",
    production,
    outputSize: { width: 1280, height: 720 },
    quality: "low",
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
  assert.equal(request.options.body.get("size"), "auto");
  assert.equal(request.options.body.get("quality"), "low");
  assert.equal(output.outputSize, "auto");
  assert.equal(output.quality, "low");
  assert.equal(output.imageDataUrl, "data:image/png;base64,ZmFrZQ==");
});
