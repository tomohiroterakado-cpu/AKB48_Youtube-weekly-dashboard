const crypto = require("node:crypto");

const REVIEW_TTL_MS = 15 * 60 * 1000;
const GENERATION_TTL_MS = 24 * 60 * 60 * 1000;

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decode(value) {
  try { return JSON.parse(Buffer.from(value, "base64url").toString("utf8")); }
  catch { throw Object.assign(new Error("サムネイル候補の確認情報が正しくありません。もう一度5案を作成してください。"), { status: 400 }); }
}

function signature(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function signThumbnailReview(review, secret, now = Date.now()) {
  const payload = encode({ review, expiresAt: now + REVIEW_TTL_MS });
  return `${payload}.${signature(payload, secret)}`;
}

function verifyThumbnailReview(token, secret, now = Date.now()) {
  const [payload, received] = String(token || "").split(".");
  const expected = signature(payload, secret);
  const valid = payload && received && Buffer.byteLength(received) === Buffer.byteLength(expected) && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  if (!valid) throw Object.assign(new Error("サムネイル候補の確認情報が正しくありません。もう一度5案を作成してください。"), { status: 400 });
  const session = decode(payload);
  if (!session?.review || Number(session.expiresAt) < now) throw Object.assign(new Error("候補の確認時間が切れました。もう一度5案を作成してください。"), { status: 410 });
  return session.review;
}

function generationFingerprint({ review, candidateId, originalImage }) {
  const source = {
    requestedCopy: review?.source?.requestedCopy || "",
    protectedRegions: review?.protection?.protectedRegions || [],
    candidateId,
    originalImageHash: crypto.createHash("sha256").update(String(originalImage || "")).digest("hex")
  };
  return crypto.createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

class ThumbnailGenerationGuard {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.entries = new Map();
  }

  reserve(fingerprint) {
    const now = this.now();
    for (const [key, expiresAt] of this.entries) if (expiresAt <= now) this.entries.delete(key);
    if (this.entries.has(fingerprint)) throw Object.assign(new Error("同じ元画像・テロップ・候補は24時間以内に生成済みです。再生成する場合は、テロップまたは保護範囲を変更してから5案を作成してください。"), { status: 409 });
    this.entries.set(fingerprint, now + GENERATION_TTL_MS);
  }

  release(fingerprint) {
    this.entries.delete(fingerprint);
  }
}

function reservePersistentGeneration(state, fingerprint, now = Date.now()) {
  const createdAt = new Date(now).toISOString();
  state.thumbnailGenerations = (state.thumbnailGenerations || []).filter((item) => Number(item.expiresAt || 0) > now);
  if (state.thumbnailGenerations.some((item) => item.fingerprint === fingerprint)) {
    throw Object.assign(new Error("同じ元画像・テロップ・候補は24時間以内に生成済みです。再生成する場合は、テロップまたは保護範囲を変更してから5案を作成してください。"), { status: 409 });
  }
  state.thumbnailGenerations.push({
    id: fingerprint,
    fingerprint,
    createdAt,
    expiresAt: String(now + GENERATION_TTL_MS)
  });
}

function releasePersistentGeneration(state, fingerprint) {
  state.thumbnailGenerations = (state.thumbnailGenerations || []).filter((item) => item.fingerprint !== fingerprint);
}

module.exports = {
  GENERATION_TTL_MS,
  REVIEW_TTL_MS,
  ThumbnailGenerationGuard,
  generationFingerprint,
  releasePersistentGeneration,
  reservePersistentGeneration,
  signThumbnailReview,
  verifyThumbnailReview
};
