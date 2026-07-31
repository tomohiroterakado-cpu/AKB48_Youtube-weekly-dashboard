const ROLES = Object.freeze({
  images2: "デザイン質感担当",
  originalComposite: "顔・ロゴ保護担当",
  photoshopText: "正確な日本語担当",
  aiDirector: "企画意図・候補設計・品質判定担当"
});

const CANDIDATES = Object.freeze([
  { id: "A", name: "元画像踏襲型", purpose: "元サムネの世界観と承認されやすい強みを活かす", direction: "既存の色・立体テロップ・構図の魅力を受け継ぐ" },
  { id: "B", name: "YouTube煽り強化型", purpose: "驚き・疑問・リアクションを強めてクリック前の引きを作る", direction: "主コピーの感情語と立体感を最優先にする" },
  { id: "C", name: "視認性最優先型", purpose: "スマホ一覧で0.5秒以内に主コピーを読ませる", direction: "短文・大文字・高コントラストで情報を絞る" },
  { id: "D", name: "坂道チャンネル参考型", purpose: "密着感・企画感・メンバー主語・コラボの特別感を高める", direction: "櫻坂・日向坂系の訴求構造を参考にし、意匠は模倣しない" },
  { id: "E", name: "顔・ビジュアル主役型", purpose: "表情・集合感・写真の強さを最大限残す", direction: "テロップを顔から避け、人物写真を主役にする" },
  { id: "F", name: "シンプルテロップ型", purpose: "装飾を最小限にして、指定文言を最も読みやすく見せる", direction: "単色を基調に、細い縁取りと十分な余白だけで主コピーを明快に見せる。装飾・光沢・発光は最小限にする" }
]);

const GATES = [
  ["faceLock", "Face Lock", "顔、目、口、肌、髪型が元画像と一致している"],
  ["logoLock", "Logo Lock", "AKB48および協業先ロゴが正確に残っている"],
  ["textAccuracy", "Text Accuracy", "日本語コピーに欠け・誤字・文字化けがない"],
  ["telopQuality", "Telop Quality", "商業サムネイル級の光沢・厚み・視認性がある"],
  ["faceOverlap", "Face Overlap", "顔や目に重要テロップが被っていない"],
  ["mobileReadability", "Mobile Readability", "縮小表示でも主コピーが読める"],
  ["youtubeUiSafety", "YouTube UI Safety", "右下の再生時間表示に重要情報が隠れない"]
];

const FALLBACKS = {
  faceLock: "restore_original_faces",
  logoLock: "restore_original_logos",
  textAccuracy: "photoshop_text",
  telopQuality: "regenerate_design_surface",
  faceOverlap: "reposition_telop",
  mobileReadability: "simplify_main_copy",
  youtubeUiSafety: "reserve_youtube_duration_area"
};

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw Object.assign(new Error(`${label}を入力してください。`), { status: 400 });
  return value.trim();
}

function normalizeRegions(regions) {
  if (!Array.isArray(regions)) throw Object.assign(new Error("保護領域の形式が正しくありません。"), { status: 400 });
  return regions.map((region, index) => {
    const values = ["x", "y", "w", "h"].map((key) => Number(region?.[key]));
    if (!values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw Object.assign(new Error(`保護領域 ${index + 1} の位置が正しくありません。`), { status: 400 });
    }
    const [x, y, w, h] = values;
    if (!w || !h || x + w > 1 || y + h > 1) throw Object.assign(new Error(`保護領域 ${index + 1} を画像内に収めてください。`), { status: 400 });
    return { name: String(region.name || `保護領域 ${index + 1}`), type: region.type || "important_visual", shape: region.shape === "ellipse" ? "ellipse" : "rect", x, y, w, h };
  });
}

function intersects(first, second) {
  return first.x < second.x + second.w && first.x + first.w > second.x && first.y < second.y + second.h && first.y + first.h > second.y;
}

function paddedBounds(region, padding = 0.024) {
  const x = Math.max(0, region.x - padding);
  const y = Math.max(0, region.y - padding);
  const right = Math.min(1, region.x + region.w + padding);
  const bottom = Math.min(1, region.y + region.h + padding);
  return { x, y, w: right - x, h: bottom - y };
}

function usableTextArea(candidate, excluded) {
  return candidate.w >= 0.36 && candidate.h >= 0.14 && !excluded.some((region) => intersects(candidate, region));
}

function computeTelopSafeArea(protectedRegions) {
  const excluded = protectedRegions.map((region) => paddedBounds(region));
  const preferredAreas = [
    { x: 0.04, y: 0.73, w: 0.92, h: 0.22 },
    { x: 0.04, y: 0.05, w: 0.92, h: 0.21 },
    { x: 0.04, y: 0.53, w: 0.92, h: 0.20 },
    { x: 0.04, y: 0.32, w: 0.92, h: 0.20 },
    { x: 0.61, y: 0.24, w: 0.35, h: 0.48 },
    { x: 0.04, y: 0.24, w: 0.35, h: 0.48 }
  ];
  const preferred = preferredAreas.find((candidate) => usableTextArea(candidate, excluded));
  if (preferred) return { ...preferred, clearance: 0.024, source: "preferred" };

  const xs = [...new Set([0.025, 0.16, 0.32, 0.5, 0.68, 0.84, 0.975, ...excluded.flatMap((region) => [region.x, region.x + region.w])])].sort((a, b) => a - b);
  const ys = [...new Set([0.025, 0.18, 0.34, 0.5, 0.66, 0.82, 0.975, ...excluded.flatMap((region) => [region.y, region.y + region.h])])].sort((a, b) => a - b);
  let best = null;
  for (let left = 0; left < xs.length - 1; left += 1) {
    for (let right = left + 1; right < xs.length; right += 1) {
      for (let top = 0; top < ys.length - 1; top += 1) {
        for (let bottom = top + 1; bottom < ys.length; bottom += 1) {
          const candidate = { x: xs[left], y: ys[top], w: xs[right] - xs[left], h: ys[bottom] - ys[top] };
          if (!usableTextArea(candidate, excluded)) continue;
          const horizontalBonus = Math.min(candidate.w / candidate.h, 4) * 0.04;
          const score = candidate.w * candidate.h + candidate.w * 0.18 + horizontalBonus;
          if (!best || score > best.score) best = { ...candidate, score };
        }
      }
    }
  }
  if (!best) return null;
  return { x: best.x, y: best.y, w: best.w, h: best.h, clearance: 0.024, source: "computed" };
}

function createThumbnailReview(input) {
  const jobId = requiredText(input?.jobId, "案件名");
  const requestedCopy = requiredText(input?.requestedCopy, "テロップ文言");
  const protectedRegions = normalizeRegions(input?.protectedRegions || []);
  const telopSafeArea = computeTelopSafeArea(protectedRegions);
  if (!telopSafeArea) {
    throw Object.assign(new Error("保護領域が画像の大半を占めているため、テロップを安全に置けません。保護範囲を少し狭めるか、顔とロゴを分けて囲んでください。"), { status: 400 });
  }
  return {
    workflowVersion: "1.1",
    jobId,
    status: "awaiting_selection",
    source: { requestedCopy },
    roles: ROLES,
    protection: {
      protectedRegions,
      faceStrategy: "restore_original_after_generation",
      logoStrategy: "restore_original_after_generation",
      textStrategy: "safe_area_exact_overlay",
      telopSafeArea,
      telopPlacementPolicy: "保護領域と画像幅・高さの2.4%の余白を避け、指定文言を安全領域へ完全表示する"
    },
    candidates: CANDIDATES.map((candidate) => ({
      ...candidate,
      recommendedCopy: requestedCopy,
      generationScope: ["テロップ", "装飾", "金属感", "光沢", "背景プレート"],
      prohibitedScope: ["人物の顔", "目", "口", "髪型", "公式ロゴ", "協業ロゴ", "重要背景"]
    })),
    generation: { allowed: false, reason: "6案のうち1案を選択してからImages2.0生成へ進みます。" }
  };
}

function selectThumbnailCandidate(review, candidateId) {
  if (!review || review.status !== "awaiting_selection") throw Object.assign(new Error("選択待ちの候補を指定してください。"), { status: 400 });
  const selectedCandidate = (review.candidates || []).find((candidate) => candidate.id === candidateId);
  if (!selectedCandidate) throw Object.assign(new Error("候補 A〜F のいずれかを選択してください。"), { status: 400 });
  return {
    workflowVersion: "1.1",
    jobId: review.jobId,
    status: "ready_for_generation",
    selectedCandidate,
    roles: ROLES,
    images2Brief: {
      requestedCopy: selectedCandidate.recommendedCopy,
      direction: selectedCandidate.direction,
      editableAreas: selectedCandidate.generationScope,
      protectedRegions: review.protection.protectedRegions,
      telopSafeArea: review.protection.telopSafeArea,
      instruction: "装飾・質感・テロップ背景プレートだけを高品質化する。指定文言はアプリ側で安全領域に正確に組み込む。人物・ロゴ・重要背景は変えず、生成後に元画像から前面復帰する。"
    },
    compositePlan: {
      restore: ["顔", "目", "口", "髪型", "公式ロゴ", "協業ロゴ", "重要背景"],
      faceOverlapPolicy: "顔・目・保護領域へのテロップ被りを許可しない",
      telopSafeArea: review.protection.telopSafeArea
    },
    textPolicy: { primary: "safe_area_exact_overlay", fallback: "photoshop_text", requiredCheck: "human_visual_check" }
  };
}

function selectThumbnailPreviewCandidates(review, candidateIds) {
  if (!review || review.status !== "awaiting_selection") throw Object.assign(new Error("選択待ちの候補を指定してください。"), { status: 400 });
  if (!Array.isArray(candidateIds) || candidateIds.length !== 2 || new Set(candidateIds).size !== 2) {
    throw Object.assign(new Error("比較する候補を重複なしで2案選んでください。"), { status: 400 });
  }
  return candidateIds.map((candidateId) => selectThumbnailCandidate(review, candidateId));
}

function selectAllThumbnailPreviewCandidates(review) {
  if (!review || review.status !== "awaiting_selection") throw Object.assign(new Error("選択待ちの候補を指定してください。"), { status: 400 });
  const candidateIds = Array.isArray(review.candidates) ? review.candidates.map((candidate) => candidate.id) : [];
  if (candidateIds.length !== 6 || new Set(candidateIds).size !== candidateIds.length) {
    throw Object.assign(new Error("比較用の6案を確認できません。もう一度6案を設計してください。"), { status: 400 });
  }
  return candidateIds.map((candidateId) => selectThumbnailCandidate(review, candidateId));
}

function assessThumbnailQuality(checks) {
  const gates = GATES.map(([key, label, criterion]) => ({ key, label, criterion, passed: checks?.[key] === true }));
  const failed = gates.filter((gate) => !gate.passed);
  return {
    status: failed.length ? "revision_required" : "approved_for_export",
    gates,
    failedGates: failed.map((gate) => gate.key),
    fallbacks: failed.map((gate) => FALLBACKS[gate.key]),
    nextAction: failed.length ? "失敗した品質ゲートだけを修正し、再判定する。" : "最終PNGを書き出し、選択理由・生成指示・合成方針とともに保存する。"
  };
}

module.exports = { createThumbnailReview, computeTelopSafeArea, selectThumbnailCandidate, selectThumbnailPreviewCandidates, selectAllThumbnailPreviewCandidates, assessThumbnailQuality };
