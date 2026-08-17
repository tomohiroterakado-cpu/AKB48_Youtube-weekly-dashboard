const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const director = fs.readFileSync(path.join(root, "director.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const thumbnail = fs.readFileSync(path.join(root, "thumbnail.js"), "utf8");

test("thumbnail route exposes the complete Images2.0 production workflow", () => {
  [
    "data-route=\"thumbnail\"", "data-director-view=\"thumbnail\"", "thumbnailOriginalFile",
    "thumbnailPreviewSurface", "thumbnailReview", "thumbnailCandidateRail", "thumbnailGenerate",
    "thumbnailPreviewControls", "thumbnailPreviewModePicker", "thumbnailGeneratePreviews",
    "thumbnailQualityList", "thumbnailDownload", "thumbnailFinalPreview", "data-thumbnail-shape", "./thumbnail.js"
  ].forEach((token) => assert.ok(index.includes(token), `index.html must include ${token}`));
  assert.match(director, /resolved === "thumbnail"/);
  assert.match(styles, /Images2\.0 高品質サムネイル制作/);
  assert.match(thumbnail, /location\.hash === "#thumbnail"/);
  assert.match(thumbnail, /を読み込みました。顔は楕円、ロゴや重要な文字は四角/);
  assert.match(index, /thumbnailOriginalPreview"[^>]*draggable="false"/);
  assert.match(styles, /thumbnailPreviewSurface img[^\n]*pointer-events: none/);
  assert.match(styles, /thumbnailRegion--ellipse/);
  assert.match(thumbnail, /createProtectionMask/);
  assert.match(thumbnail, /drawOriginalInsideRegion/);
  assert.match(thumbnail, /must never be blended with image-model output/);
  assert.match(thumbnail, /保護範囲を元画像から再復元する/);
  assert.match(thumbnail, /restoredFaceCount/);
  assert.match(thumbnail, /renderThumbnailSafetyFallbackOption/);
  assert.match(thumbnail, /AIなしでテロップを合成する/);
  assert.match(thumbnail, /createTextOnlyThumbnail/);
});

test("thumbnail API keeps generation, composition planning, and quality gating server-side", () => {
  ["/api/thumbnails/review", "/api/thumbnails/select", "/api/thumbnails/previews", "/api/thumbnails/generate", "/api/thumbnails/quality"].forEach((route) => {
    assert.ok(server.includes(route), `server.js must include ${route}`);
  });
  assert.match(server, /authorizeWrite\(req\)/);
  assert.match(server, /generateImages2Design/);
  assert.match(server, /\/api\/thumbnails\/regenerate/);
  assert.match(server, /previewOutputSize/);
  assert.match(thumbnail, /generateThumbnailPreviews/);
  assert.match(index, /コスト優先：2案だけ低画質プレビュー/);
  assert.match(index, /比較優先：6案すべて低画質プレビュー/);
  assert.match(styles, /Images2\.0 高品質サムネイル制作/);
  assert.match(fs.readFileSync(path.join(root, "thumbnail.js"), "utf8"), /今回だけ再生成する/);
});

test("指定テロップを安全領域へ正確に合成する契約を維持する", () => {
  assert.match(index, /thumbnail-caption-layout\.js/);
  assert.match(thumbnail, /getThumbnailCaptionLayoutOrThrow/);
  assert.match(thumbnail, /composeThumbnailWithExactCaption/);
  assert.match(thumbnail, /captionSafeArea/);
  assert.match(thumbnail, /切らずに正確に合成/);
});
