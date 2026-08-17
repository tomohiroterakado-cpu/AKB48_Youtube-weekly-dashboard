const test = require("node:test");
const assert = require("node:assert/strict");
const {
  REVIEW_PERSPECTIVES,
  TITLE_ANGLES,
  buildPrompt,
  generatePrepublishReview,
  learningRecord,
  normalizeReview,
  recordOutcome,
  validateInput
} = require("../lib/prepublish-review");
const { emptyState } = require("../lib/repository");

const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8WqAAAAAElFTkSuQmCC";
const anglePlan = [
  ...Array(6).fill(TITLE_ANGLES[0]),
  ...TITLE_ANGLES.slice(1).flatMap((angle) => Array(4).fill(angle))
];

function candidate(index, total = 95) {
  return {
    title: `候補タイトル${index}`,
    ctrPrediction: "6.5〜8.0%",
    target: "AKBファンとライト層",
    angle: anglePlan[index - 1],
    hookStructure: {
      proof: "選抜16人",
      emotion: "素顔が尊い",
      content: "完成までに密着"
    },
    clickLogic: "客観事実から感情と内容へつなげる",
    adoptionReason: "内容と感情のバランス",
    breakdown: {
      ctr: total - 55,
      contentMatch: 20,
      mobileVisibility: 10,
      emotionWord: 10,
      novelty: 8,
      seriesConsistency: 7
    },
    perspectives: REVIEW_PERSPECTIVES.map((label) => ({ label, score: 90, conclusion: `${label}の結論` }))
  };
}

function rawReview() {
  return {
    candidates: Array.from({ length: 30 }, (_, index) => candidate(index + 1, 95 - (index % 3))),
    topFive: Array.from({ length: 5 }, (_, index) => ({ sourceRank: index + 1, title: `改善${index + 1}`, score: 96, angle: TITLE_ANGLES[index], refinement: "改善理由" })),
    abTests: Array.from({ length: 2 }, (_, index) => ({ title: `AB${index + 1}`, score: 97 - index, ctrPrediction: "7.0〜9.0%", target: "新規", angle: TITLE_ANGLES[index], hypothesis: "仮説" })),
    thumbnailFit: { score: 92, overlapLevel: "低", duplicateElements: [], synergy: "役割分担", improvement: "文字量を減らす" },
    finalRecommendation: {
      title: "最終タイトル",
      score: 97,
      ctrPrediction: "7.5〜9.5%",
      target: "新規とファン",
      angle: TITLE_ANGLES[0],
      hookStructure: { proof: "MV600万回再生", emotion: "カワイイが渋滞", content: "完成までに密着" },
      clickLogic: "実績から感情、内容説明へ進む",
      adoptionReason: "最も強い"
    },
    youtubeDescription: "概要欄",
    xPost: "告知文",
    improvements: ["改善1", "改善2", "改善3"]
  };
}

test("input requires a valid thumbnail and core planning fields", () => {
  assert.throws(() => validateInput({}), /サムネイル画像/);
  const input = validateInput({
    thumbnailDataUrl: pixel,
    videoContent: "動画内容",
    cast: "出演者",
    highlights: "見どころ",
    seriesName: "シリーズ",
    targetAudience: "女性ライト層",
    proofPoints: "MV600万回再生"
  });
  assert.equal(input.channel, "AKBの素を出すちゃんねる");
  assert.equal(input.thumbnailMimeType, "image/png");
  assert.equal(input.proofPoints, "MV600万回再生");
});

test("normalization recalculates weighted totals and marks 95+ candidates", () => {
  const result = normalizeReview(rawReview());
  assert.equal(result.candidates.length, 30);
  assert.equal(result.candidates[0].score, 95);
  assert.equal(result.candidates[0].adoptionEligible, true);
  assert.equal(result.candidates.at(-1).adoptionEligible, false);
  assert.deepEqual(result.candidates[0].perspectives.map((item) => item.label), REVIEW_PERSPECTIVES);
  assert.equal(result.candidates[0].hookStructure.proof, "選抜16人");
  assert.ok(TITLE_ANGLES.includes(result.candidates[0].angle));
});

test("normalization rejects a 30-title set without the required angle diversity", () => {
  const review = rawReview();
  review.candidates[0].angle = TITLE_ANGLES[1];
  assert.throws(() => normalizeReview(review), /訴求軸が指定配分を満たしていません/);
});

test("prompt enforces multi-angle distribution and factual three-layer hooks", () => {
  const prompt = buildPrompt({
    channel: "AKBの素を出すちゃんねる",
    videoContent: "新曲メイキング",
    cast: "選抜16人",
    highlights: "撮影の裏側",
    seriesName: "好きish",
    episode: "",
    targetAudience: "一般層",
    proofPoints: "MV600万回再生",
    currentTitle: ""
  });
  assert.match(prompt, /実績・事実 → 感情 → 内容説明/);
  assert.match(prompt, /三層フック6案/);
  assert.match(prompt, /MV600万回再生/);
  assert.match(prompt, /推測・捏造しない/);
});

test("OpenAI response is normalized and includes a learning id", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ output_text: JSON.stringify(rawReview()) })
  });
  const result = await generatePrepublishReview({
    thumbnailDataUrl: pixel,
    videoContent: "メンバーが料理に挑戦",
    cast: "メンバーA、メンバーB",
    highlights: "予想外の失敗と逆転",
    seriesName: "全力エンタメ学園",
    episode: "第3回",
    targetAudience: "AKBファン、女性ライト層"
  }, { apiKey: "test", model: "test-model", fetchImpl, now: "2026-07-31T00:00:00.000Z" });
  assert.match(result.reviewId, /^pre_/);
  assert.equal(result.candidates.length, 30);
  assert.equal(learningRecord(result).recommendedTitle, "最終タイトル");
});

test("future CTR outcome links back to the adopted title", () => {
  const state = emptyState();
  state.prepublishReviews.push({
    id: "pre_1",
    recommendedTitle: "最終タイトル",
    status: "generated"
  });
  const result = recordOutcome(state, {
    reviewId: "pre_1",
    adoptedTitle: "ABタイトル",
    publishedVideoId: "abcdefghijk",
    actualCtr: 8.4
  }, "2026-08-07T00:00:00.000Z");
  assert.equal(result.status, "updated");
  assert.equal(state.prepublishReviews[0].actualCtr, 8.4);
  assert.equal(state.prepublishReviews[0].adoptedTitle, "ABタイトル");
  assert.equal(state.prepublishReviews[0].publishedVideoId, "abcdefghijk");
});
