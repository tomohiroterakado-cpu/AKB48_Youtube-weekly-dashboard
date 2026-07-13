const crypto = require("node:crypto");
const { classifyVideo } = require("./classification");

const REVIEW_FIELDS = ["format", "genre", "subgenre", "members", "guests", "tags", "collaboration", "titleAppeal", "targetAudience", "notes"];
const ATTRIBUTE_FIELDS = [...REVIEW_FIELDS, "seasonalEvent", "productionCost", "shootingDifficulty"];

function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function latestClassification(state, videoId) {
  return state.classifications
    .filter((item) => item.videoId === videoId && !item.superseded)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
}

function autoValueForField(classification, field) {
  const candidate = classification?.values?.[field];
  return candidate && Object.prototype.hasOwnProperty.call(candidate, "value") ? candidate.value : null;
}

function confirmVideos(state, body, now = new Date().toISOString()) {
  const ids = Array.isArray(body.videoIds) ? body.videoIds : [];
  let confirmed = 0;
  state.videos.forEach((video) => {
    if (!ids.includes(video.videoId)) return;
    const edits = body.edits?.[video.videoId] || {};
    const classification = latestClassification(state, video.videoId);
    REVIEW_FIELDS.forEach((field) => {
      const autoValue = autoValueForField(classification, field);
      if (edits[field] === undefined && autoValue === null) return;
      const reviewedValue = edits[field] !== undefined ? edits[field] : autoValue;
      video[field] = reviewedValue;
      state.reviews.push({
        id: `review_${crypto.randomUUID()}`,
        videoId: video.videoId,
        field,
        autoValue,
        reviewedValue,
        reviewedBy: body.reviewedBy || "dashboard-user",
        reviewedAt: now,
        source: sameValue(autoValue, reviewedValue) ? "user_confirmed" : "user_manual"
      });
    });
    video.status = "confirmed";
    video.reviewedAt = now;
    video.reviewedBy = body.reviewedBy || "dashboard-user";
    video.updatedAt = now;
    confirmed += 1;
  });
  return { confirmed };
}

function reclassifyUnconfirmedVideos(state, videoIds, now = new Date().toISOString()) {
  const requested = new Set(Array.isArray(videoIds) ? videoIds : []);
  const memberNames = state.members.filter((member) => member.active !== false).map((member) => member.name);
  let reclassified = 0;
  state.videos.forEach((video) => {
    if (video.status !== "unconfirmed" || (requested.size && !requested.has(video.videoId))) return;
    state.classifications
      .filter((item) => item.videoId === video.videoId && !item.superseded)
      .forEach((item) => { item.superseded = true; });
    state.classifications.push({
      id: `classification_${crypto.randomUUID()}`,
      videoId: video.videoId,
      values: classifyVideo(video, memberNames),
      createdAt: now,
      model: "rules-v1",
      superseded: false
    });
    reclassified += 1;
  });
  return { reclassified };
}

function updateVideoAttributes(state, body, now = new Date().toISOString()) {
  const video = state.videos.find((item) => item.videoId === body.videoId);
  if (!video) throw new Error("対象動画が見つかりません。");
  const edits = body.edits || {};
  ATTRIBUTE_FIELDS.forEach((field) => {
    if (edits[field] === undefined) return;
    const autoValue = autoValueForField(latestClassification(state, video.videoId), field);
    const reviewedValue = edits[field];
    if (sameValue(video[field], reviewedValue)) return;
    video[field] = reviewedValue;
    state.reviews.push({
      id: `review_${crypto.randomUUID()}`,
      videoId: video.videoId,
      field,
      autoValue,
      reviewedValue,
      reviewedBy: body.reviewedBy || "dashboard-user",
      reviewedAt: now,
      source: "user_manual"
    });
  });
  video.updatedAt = now;
  return { status: "updated", videoId: video.videoId };
}

module.exports = { ATTRIBUTE_FIELDS, REVIEW_FIELDS, confirmVideos, reclassifyUnconfirmedVideos, updateVideoAttributes };
