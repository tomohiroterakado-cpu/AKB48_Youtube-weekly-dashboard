const GENRE_RULES = [
  { genre: "密着・ドキュメンタリー", keywords: ["密着", "舞台裏", "裏側", "ドキュメンタリー"] },
  { genre: "Vlog・おでかけ", keywords: ["vlog", "旅行", "旅", "おでかけ"] },
  { genre: "対決・ゲーム", keywords: ["対決", "勝負", "ゲーム", "選手権", "ワールドカップ"] },
  { genre: "グルメ・大食い", keywords: ["大食い", "爆食", "コストコ", "食べ", "グルメ"] },
  { genre: "音楽・パフォーマンス", keywords: ["歌ってみた", "踊ってみた", "dance", "mv", "バンド", "ライブ"] },
  { genre: "発表・ニュース", keywords: ["発表", "お知らせ", "重大", "初解禁"] },
  { genre: "トーク・関係性", keywords: ["本音", "結婚", "気まず", "質問", "トーク"] }
];

const TAG_KEYWORDS = ["密着", "Vlog", "対決", "大食い", "切り抜き", "コストコ", "ドッキリ", "初公開", "本音", "コラボ", "舞台裏", "ライブ"];
const EMOTION_WORDS = ["衝撃", "本気", "まさか", "気まず", "泣", "爆笑", "重大", "最高", "最悪", "初"];

function confidence(value, reason, score, needsReview = score < 0.85) {
  return { value, reason, confidence: Math.round(score * 100), needsReview, source: "system_auto" };
}

function extractTitleFeatures(title) {
  const text = String(title || "");
  return {
    characterCount: [...text].length,
    hasBrackets: /【[^】]+】/.test(text),
    hasNumber: /[0-9０-９]/.test(text),
    isQuestion: /[?？]/.test(text),
    hasExclamation: /[!！]/.test(text),
    hasAkb48: /AKB48/i.test(text),
    hasResultConcealment: /(結果|まさか|どうなる|果たして|一体)/.test(text),
    emotionWords: EMOTION_WORDS.filter((word) => text.includes(word)),
    hashtags: [...text.matchAll(/#([^\s#]+)/g)]
      .map((match) => match[1].replace(/[】」』.,!?！？]+$/g, ""))
      .filter((tag) => tag && !/^\d+$/.test(tag))
  };
}

function detectMembers(title, memberNames = []) {
  const text = String(title || "");
  const confirmedMasterMatches = memberNames.filter((name) => name && text.includes(name));
  if (confirmedMasterMatches.length) {
    return confidence(confirmedMasterMatches, "メンバーマスタとタイトルの一致", 0.95, false);
  }
  const hashtagCandidates = extractTitleFeatures(text).hashtags
    .filter((tag) => /^[一-龠々ヶぁ-んァ-ヶー]{3,10}$/.test(tag))
    .filter((tag) => !["切り抜き", "エンタメ学園"].includes(tag));
  return confidence([...new Set(hashtagCandidates)], hashtagCandidates.length ? "タイトル内の日本語ハッシュタグ" : "一致候補なし", hashtagCandidates.length ? 0.55 : 0.2, true);
}

function classifyFormat(title, durationSeconds) {
  const text = String(title || "");
  if (/(生配信|ライブ配信|生放送)/.test(text)) return confidence("live", "タイトルに配信キーワード", 0.9, false);
  if (/#shorts|切り抜き/i.test(text)) return confidence("shorts", "タイトルにShorts・切り抜き表記", 0.95, false);
  if (Number(durationSeconds) > 0 && Number(durationSeconds) <= 180) return confidence("shorts_candidate", "尺が180秒以下。縦型かはCSVだけでは判定不可", 0.65, true);
  return confidence("long", "尺とタイトルから通常動画候補", Number(durationSeconds) ? 0.8 : 0.55, true);
}

function classifyGenre(title) {
  const text = String(title || "").toLowerCase();
  const matches = GENRE_RULES
    .map((rule) => ({ ...rule, hits: rule.keywords.filter((word) => text.includes(word.toLowerCase())) }))
    .filter((rule) => rule.hits.length)
    .sort((a, b) => b.hits.length - a.hits.length);
  if (!matches.length) return confidence("未判定", "既定キーワードとの一致なし", 0.2, true);
  return confidence(matches[0].genre, `キーワード: ${matches[0].hits.join("、")}`, Math.min(0.9, 0.6 + matches[0].hits.length * 0.12), true);
}

function classifyVideo(video, memberNames = []) {
  const titleFeatures = extractTitleFeatures(video.title);
  const tags = TAG_KEYWORDS.filter((word) => String(video.title || "").toLowerCase().includes(word.toLowerCase()));
  if (titleFeatures.hashtags.length) {
    tags.push(...titleFeatures.hashtags.filter((tag) => !/^(AKB48|AKB|akb48|akb)$/i.test(tag)));
  }
  return {
    format: classifyFormat(video.title, video.durationSeconds),
    genre: classifyGenre(video.title),
    members: detectMembers(video.title, memberNames),
    tags: confidence([...new Set(tags)], tags.length ? "タイトルのキーワードとハッシュタグ" : "候補なし", tags.length ? 0.7 : 0.2, true),
    titleFeatures,
    thumbnailUrl: `https://img.youtube.com/vi/${encodeURIComponent(video.videoId)}/hqdefault.jpg`,
    thumbnailStatus: "未判定"
  };
}

module.exports = { classifyFormat, classifyGenre, classifyVideo, detectMembers, extractTitleFeatures };
