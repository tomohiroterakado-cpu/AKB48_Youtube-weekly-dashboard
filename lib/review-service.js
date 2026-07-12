const crypto = require("node:crypto");

const REVIEW_FIELDS = ["format", "genre", "subgenre", "members", "guests", "tags", "collaboration", "titleAppeal", "targetAudience", "notes"];

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

module.exports = { REVIEW_FIELDS, confirmVideos };
