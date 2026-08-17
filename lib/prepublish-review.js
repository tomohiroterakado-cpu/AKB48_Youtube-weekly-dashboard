const crypto = require("node:crypto");

const TITLE_CRITERIA = Object.freeze({
  ctr: 40,
  contentMatch: 20,
  mobileVisibility: 10,
  emotionWord: 10,
  novelty: 10,
  seriesConsistency: 10
});

const REVIEW_PERSPECTIVES = Object.freeze([
  "YouTubeアルゴリズム担当",
  "テレビ番組プロデューサー",
  "MrBeastの企画原則",
  "東海オンエアの企画原則",
  "佐久間宣行の企画原則",
  "一般視聴者"
]);

const TITLE_ANGLES = Object.freeze([
  "三層フック（実績→感情→内容）",
  "実績・事実先行",
  "感情先行",
  "舞台裏・限定感",
  "人物ドラマ",
  "意外性・結末",
  "検索・シリーズ"
]);
const TITLE_ANGLE_QUOTAS = Object.freeze({
  [TITLE_ANGLES[0]]: 6,
  [TITLE_ANGLES[1]]: 4,
  [TITLE_ANGLES[2]]: 4,
  [TITLE_ANGLES[3]]: 4,
  [TITLE_ANGLES[4]]: 4,
  [TITLE_ANGLES[5]]: 4,
  [TITLE_ANGLES[6]]: 4
});

const ANALYSIS_VERSION = "prepublish-v2-multi-angle";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function httpError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function cleanText(value, limit = 4_000) {
  return String(value || "").trim().slice(0, limit);
}

function parseImageDataUrl(value) {
  const text = String(value || "");
  const match = text.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match || !ALLOWED_IMAGE_TYPES.has(match[1])) {
    throw httpError("サムネイル画像はJPEG・PNG・WebPで選択してください。");
  }
  const byteLength = Buffer.from(match[2], "base64").length;
  if (!byteLength || byteLength > MAX_IMAGE_BYTES) {
    throw httpError("サムネイル画像は8MB以下にしてください。", 413);
  }
  return { dataUrl: text, mimeType: match[1], byteLength };
}

function validateInput(body) {
  const thumbnail = parseImageDataUrl(body.thumbnailDataUrl);
  const input = {
    thumbnailDataUrl: thumbnail.dataUrl,
    thumbnailMimeType: thumbnail.mimeType,
    thumbnailBytes: thumbnail.byteLength,
    videoContent: cleanText(body.videoContent, 8_000),
    cast: cleanText(body.cast, 2_000),
    highlights: cleanText(body.highlights, 4_000),
    seriesName: cleanText(body.seriesName, 500),
    episode: cleanText(body.episode, 100),
    targetAudience: cleanText(body.targetAudience, 1_000),
    proofPoints: cleanText(body.proofPoints, 2_000),
    currentTitle: cleanText(body.currentTitle, 300),
    channel: cleanText(body.channel, 200) || "AKBの素を出すちゃんねる"
  };
  const missing = [
    ["動画内容", input.videoContent],
    ["出演者", input.cast],
    ["見どころ", input.highlights],
    ["シリーズ名", input.seriesName],
    ["想定ターゲット", input.targetAudience]
  ].filter(([, value]) => !value).map(([label]) => label);
  if (missing.length) throw httpError(`${missing.join("、")}を入力してください。`);
  return input;
}

function boundedScore(value, maximum) {
  return Math.max(0, Math.min(maximum, Math.round(Number(value) || 0)));
}

function normalizeCandidate(candidate, index) {
  const source = candidate || {};
  const breakdown = source.breakdown || {};
  const normalizedBreakdown = {
    ctr: boundedScore(breakdown.ctr, TITLE_CRITERIA.ctr),
    contentMatch: boundedScore(breakdown.contentMatch, TITLE_CRITERIA.contentMatch),
    mobileVisibility: boundedScore(breakdown.mobileVisibility, TITLE_CRITERIA.mobileVisibility),
    emotionWord: boundedScore(breakdown.emotionWord, TITLE_CRITERIA.emotionWord),
    novelty: boundedScore(breakdown.novelty, TITLE_CRITERIA.novelty),
    seriesConsistency: boundedScore(breakdown.seriesConsistency, TITLE_CRITERIA.seriesConsistency)
  };
  const total = Object.values(normalizedBreakdown).reduce((sum, score) => sum + score, 0);
  const reviewsByLabel = new Map((source.perspectives || []).map((item) => [cleanText(item.label, 100), item]));
  return {
    rank: index + 1,
    title: cleanText(source.title, 120),
    score: total,
    adoptionEligible: total >= 95,
    ctrPrediction: cleanText(source.ctrPrediction, 100),
    target: cleanText(source.target, 300),
    angle: cleanText(source.angle, 100),
    hookStructure: {
      proof: cleanText(source.hookStructure?.proof, 300),
      emotion: cleanText(source.hookStructure?.emotion, 300),
      content: cleanText(source.hookStructure?.content, 300)
    },
    clickLogic: cleanText(source.clickLogic, 600),
    adoptionReason: cleanText(source.adoptionReason, 600),
    breakdown: { ...normalizedBreakdown, total },
    perspectives: REVIEW_PERSPECTIVES.map((label) => {
      const item = reviewsByLabel.get(label) || {};
      return {
        label,
        score: boundedScore(item.score, 100),
        conclusion: cleanText(item.conclusion, 500)
      };
    })
  };
}

function normalizeReview(raw) {
  const candidates = (raw.candidates || [])
    .slice(0, 30)
    .map(normalizeCandidate)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "ja"))
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  if (candidates.length !== 30 || candidates.some((item) => !item.title)) {
    throw httpError("AIのタイトル候補が30案に満たないため、もう一度生成してください。", 502);
  }
  const angleCounts = candidates.reduce((counts, candidate) => {
    counts[candidate.angle] = (counts[candidate.angle] || 0) + 1;
    return counts;
  }, {});
  const invalidDistribution = Object.entries(TITLE_ANGLE_QUOTAS)
    .filter(([angle, expected]) => angleCounts[angle] !== expected)
    .map(([angle, expected]) => `${angle}:${angleCounts[angle] || 0}/${expected}`);
  if (invalidDistribution.length) {
    throw httpError(`AIの訴求軸が指定配分を満たしていません（${invalidDistribution.join("、")}）。もう一度生成してください。`, 502);
  }
  return {
    candidates,
    topFive: (raw.topFive || []).slice(0, 5).map((item, index) => ({
      rank: index + 1,
      sourceRank: boundedScore(item.sourceRank, 30) || index + 1,
      title: cleanText(item.title, 120),
      score: boundedScore(item.score, 100),
      angle: cleanText(item.angle, 100),
      refinement: cleanText(item.refinement, 600)
    })),
    abTests: (raw.abTests || []).slice(0, 2).map((item, index) => ({
      label: index === 0 ? "A" : "B",
      title: cleanText(item.title, 120),
      score: boundedScore(item.score, 100),
      ctrPrediction: cleanText(item.ctrPrediction, 100),
      target: cleanText(item.target, 300),
      angle: cleanText(item.angle, 100),
      hypothesis: cleanText(item.hypothesis, 600)
    })),
    thumbnailFit: {
      score: boundedScore(raw.thumbnailFit?.score, 100),
      overlapLevel: cleanText(raw.thumbnailFit?.overlapLevel, 100),
      duplicateElements: (raw.thumbnailFit?.duplicateElements || []).slice(0, 8).map((item) => cleanText(item, 200)),
      synergy: cleanText(raw.thumbnailFit?.synergy, 800),
      improvement: cleanText(raw.thumbnailFit?.improvement, 800)
    },
    finalRecommendation: {
      title: cleanText(raw.finalRecommendation?.title, 120),
      score: boundedScore(raw.finalRecommendation?.score, 100),
      ctrPrediction: cleanText(raw.finalRecommendation?.ctrPrediction, 100),
      target: cleanText(raw.finalRecommendation?.target, 300),
      angle: cleanText(raw.finalRecommendation?.angle, 100),
      hookStructure: {
        proof: cleanText(raw.finalRecommendation?.hookStructure?.proof, 300),
        emotion: cleanText(raw.finalRecommendation?.hookStructure?.emotion, 300),
        content: cleanText(raw.finalRecommendation?.hookStructure?.content, 300)
      },
      clickLogic: cleanText(raw.finalRecommendation?.clickLogic, 800),
      adoptionReason: cleanText(raw.finalRecommendation?.adoptionReason, 1_000)
    },
    youtubeDescription: cleanText(raw.youtubeDescription, 6_000),
    xPost: cleanText(raw.xPost, 1_000),
    improvements: (raw.improvements || []).slice(0, 10).map((item) => cleanText(item, 500))
  };
}

function itemSchema(properties) {
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
}

function reviewSchema() {
  const score = (maximum = 100) => ({ type: "integer", minimum: 0, maximum });
  const text = { type: "string" };
  const breakdown = itemSchema({
    ctr: score(40),
    contentMatch: score(20),
    mobileVisibility: score(10),
    emotionWord: score(10),
    novelty: score(10),
    seriesConsistency: score(10)
  });
  const hookStructure = itemSchema({ proof: text, emotion: text, content: text });
  const angle = { type: "string", enum: TITLE_ANGLES };
  const perspective = itemSchema({ label: text, score: score(), conclusion: text });
  const candidate = itemSchema({
    title: text,
    ctrPrediction: text,
    target: text,
    angle,
    hookStructure,
    clickLogic: text,
    adoptionReason: text,
    breakdown,
    perspectives: { type: "array", minItems: 6, maxItems: 6, items: perspective }
  });
  return itemSchema({
    candidates: { type: "array", minItems: 30, maxItems: 30, items: candidate },
    topFive: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: itemSchema({ sourceRank: score(30), title: text, score: score(), angle, refinement: text })
    },
    abTests: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: itemSchema({ title: text, score: score(), ctrPrediction: text, target: text, angle, hypothesis: text })
    },
    thumbnailFit: itemSchema({
      score: score(),
      overlapLevel: text,
      duplicateElements: { type: "array", items: text },
      synergy: text,
      improvement: text
    }),
    finalRecommendation: itemSchema({
      title: text,
      score: score(),
      ctrPrediction: text,
      target: text,
      angle,
      hookStructure,
      clickLogic: text,
      adoptionReason: text
    }),
    youtubeDescription: text,
    xPost: text,
    improvements: { type: "array", minItems: 3, maxItems: 10, items: text }
  });
}

function buildPrompt(input) {
  return [
    "あなたは日本トップクラスのYouTubeタイトル研究AIです。",
    "対象は「AKBの素を出すちゃんねる」と「AKB48の全力エンタメ学園」。公開前パッケージのCTR最大化が目的です。",
    "",
    "次の順で内部作業してください。長い内部議論は出力せず、結論と短い理由だけをJSONにしてください。",
    "1. 動画と添付サムネイルを理解する。",
    "2. AKBファン、ライト層、女性、おすすめ表示で流入する新規視聴者を分析する。",
    "3. タイトルを30案作る。",
    "4. 各案を6視点でレビューする。",
    "5. 評価、第三者チェック、表現調整の3回ブラッシュアップを行う。",
    "6. 上位5案を再設計し、対照的な仮説を持つABテスト2案と最終案を決める。",
    "",
    "6視点のlabelは必ず次の完全一致で返す:",
    REVIEW_PERSPECTIVES.join(" / "),
    "人物・チャンネル本人の文体模倣ではなく、公開されている企画原則（明快さ、好奇心、関係性、意外性、一般理解）として評価する。",
    "",
    "多角的タイトル設計（必須）:",
    "・タイトルは『クリックする理由』を、①実績・数字・客観事実、②感情、③動画で見られる内容・視聴価値の3層で設計する。",
    "・最も強い三層フック案では、原則として『実績・事実 → 感情 → 内容説明』の順に重要語を配置する。例:『600万回という実績 → カワイイが渋滞という感情 → 完成までに密着という内容』。例文の固有表現は入力事実に合う場合だけ使う。",
    "・数字、再生回数、受賞、初公開、人数、記録などは、入力された実績・話題性または動画内容で確認できる事実だけを使う。外部の最新情報を推測・捏造しない。",
    "・実績がない企画では、人数、企画ルール、初挑戦、制限時間など入力内の客観事実を使う。それもなければhookStructure.proofを『なし（根拠情報なし）』とし、感情と内容の2層で勝負する。",
    "・各案のangle、hookStructure（proof / emotion / content）、clickLogicを短く具体的に返す。",
    "・30案の訴求軸は次の本数で必ず分散する: 三層フック6案、実績・事実先行4案、感情先行4案、舞台裏・限定感4案、人物ドラマ4案、意外性・結末4案、検索・シリーズ4案。",
    "・上位5案はできるだけ異なる訴求軸から選び、ABテスト2案はクリック仮説が明確に対照的な組み合わせにする。",
    "",
    "タイトル条件:",
    "・40文字前後。スマホで重要語が前半に見える。",
    "・感情ワードを入れる。",
    "・サムネイルの文字や情報と競合・重複させない。",
    "・動画内容と乖離しない。誇張や事実にない煽りは禁止。",
    "・30案は語尾だけ変える量産にせず、訴求軸を分散する。",
    "",
    "評価基準:",
    "CTR 40点 / 内容一致 20点 / スマホ視認性 10点 / 感情ワード 10点 / 新規性 10点 / シリーズ感 10点。",
    "合計95点以上だけを採用候補とする。点数は甘く付けず、各配点内で整数評価する。",
    "CTR配点では、実績・事実による信頼、感情による衝動、内容説明による視聴後の約束が揃っているかを重視する。ただし根拠のない実績を入れた案はCTRが高そうでも内容一致を大きく減点する。",
    "各候補のctrPredictionは過去実績が未提供の場合、絶対予測ではなく幅（例: 6.5〜8.0%）で示す。",
    "",
    `チャンネル: ${input.channel}`,
    `動画内容: ${input.videoContent}`,
    `出演者: ${input.cast}`,
    `見どころ: ${input.highlights}`,
    `シリーズ名: ${input.seriesName}`,
    `回数: ${input.episode || "未指定"}`,
    `想定ターゲット: ${input.targetAudience}`,
    `実績・話題性（使用可能な事実）: ${input.proofPoints || "未入力。動画内容内の客観事実だけを使用"}`,
    `現在のタイトル案: ${input.currentTitle || "なし"}`,
    "",
    "YouTube概要欄は冒頭2行で見どころが伝わり、出演者・シリーズ情報・視聴促進CTAを含める。事実にないURLや日時は作らない。",
    "X告知文はスマホで読みやすく、冒頭のフック、見どころ、視聴CTA、必要最小限のハッシュタグを含める。事実にないURLは作らず「動画はこちら▼」までにする。",
    "サムネ相性は、文字の重複だけでなく、顔・表情・人数・色・視線・主役・タイトル前半との役割分担を評価する。",
    "最終案が95点未満なら、その事実を採用理由に明記し、公開前の再改善を促す。"
  ].join("\n");
}

function extractOutputText(response) {
  if (response.output_text) return response.output_text;
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
      if (content.type === "refusal" && content.refusal) throw httpError(content.refusal, 422);
    }
  }
  if (response.incomplete_details) throw httpError("AIの出力が途中で終了しました。入力を短くして再実行してください。", 502);
  throw httpError("AIから解析結果を取得できませんでした。", 502);
}

async function generatePrepublishReview(body, options = {}) {
  const input = validateInput(body);
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  const model = options.model || process.env.OPENAI_TEXT_MODEL || "gpt-5.6";
  const fetchImpl = options.fetchImpl || fetch;
  if (!apiKey) throw httpError("OPENAI_API_KEYが未設定のため、公開前レビューAIを利用できません。", 503);

  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "medium" },
      store: false,
      max_output_tokens: 30_000,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: buildPrompt(input) },
          { type: "input_image", image_url: input.thumbnailDataUrl, detail: "high" }
        ]
      }],
      text: {
        verbosity: "medium",
        format: {
          type: "json_schema",
          name: "akb_prepublish_review",
          strict: true,
          schema: reviewSchema()
        }
      }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || `OpenAI APIへの接続に失敗しました (${response.status})`;
    throw httpError(message, response.status === 429 ? 429 : 502);
  }
  let parsed;
  try {
    parsed = JSON.parse(extractOutputText(payload));
  } catch (error) {
    if (error.status) throw error;
    throw httpError("AIの解析結果を読み取れませんでした。もう一度生成してください。", 502);
  }
  const review = normalizeReview(parsed);
  const createdAt = options.now || new Date().toISOString();
  const reviewId = `pre_${crypto.randomUUID()}`;
  return {
    reviewId,
    analysisVersion: ANALYSIS_VERSION,
    createdAt,
    model,
    inputSummary: {
      channel: input.channel,
      seriesName: input.seriesName,
      episode: input.episode,
      targetAudience: input.targetAudience,
      proofPoints: input.proofPoints,
      currentTitle: input.currentTitle
    },
    ...review
  };
}

function learningRecord(result) {
  return {
    id: result.reviewId,
    createdAt: result.createdAt,
    channel: result.inputSummary.channel,
    seriesName: result.inputSummary.seriesName,
    episode: result.inputSummary.episode,
    targetAudience: result.inputSummary.targetAudience,
    proofPoints: result.inputSummary.proofPoints,
    currentTitle: result.inputSummary.currentTitle,
    recommendedTitle: result.finalRecommendation.title,
    abTitles: result.abTests.map((item) => item.title),
    estimatedCtr: result.finalRecommendation.ctrPrediction,
    status: "generated",
    adoptedTitle: "",
    publishedVideoId: "",
    actualCtr: "",
    measuredAt: "",
    analysisVersion: result.analysisVersion,
    model: result.model
  };
}

function recordOutcome(state, body, now = new Date().toISOString()) {
  const reviewId = cleanText(body.reviewId, 200);
  const record = (state.prepublishReviews || []).find((item) => item.id === reviewId);
  if (!record) throw httpError("公開前レビューが見つかりません。", 404);
  const actualCtr = Number(body.actualCtr);
  if (!Number.isFinite(actualCtr) || actualCtr < 0 || actualCtr > 100) {
    throw httpError("公開後CTRは0〜100の数値で入力してください。");
  }
  record.adoptedTitle = cleanText(body.adoptedTitle, 120) || record.recommendedTitle;
  record.publishedVideoId = cleanText(body.publishedVideoId, 100);
  record.actualCtr = actualCtr;
  record.measuredAt = cleanText(body.measuredAt, 100) || now;
  record.status = "measured";
  return { status: "updated", reviewId, actualCtr };
}

module.exports = {
  ANALYSIS_VERSION,
  REVIEW_PERSPECTIVES,
  TITLE_ANGLE_QUOTAS,
  TITLE_ANGLES,
  TITLE_CRITERIA,
  buildPrompt,
  generatePrepublishReview,
  learningRecord,
  normalizeReview,
  recordOutcome,
  reviewSchema,
  validateInput
};
