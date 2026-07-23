const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const director = fs.readFileSync(path.join(root, "director.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");

test("thumbnail route exposes the complete Images2.0 production workflow", () => {
  [
    "data-route=\"thumbnail\"", "data-director-view=\"thumbnail\"", "thumbnailOriginalFile",
    "thumbnailPreviewSurface", "thumbnailReview", "thumbnailCandidateRail", "thumbnailGenerate",
    "thumbnailQualityList", "thumbnailDownload", "thumbnailFinalPreview", "./thumbnail.js"
  ].forEach((token) => assert.ok(index.includes(token), `index.html must include ${token}`));
  assert.match(director, /resolved === "thumbnail"/);
  assert.match(styles, /Images2\.0 高品質サムネイル制作/);
});

test("thumbnail API keeps generation, composition planning, and quality gating server-side", () => {
  ["/api/thumbnails/review", "/api/thumbnails/select", "/api/thumbnails/generate", "/api/thumbnails/quality"].forEach((route) => {
    assert.ok(server.includes(route), `server.js must include ${route}`);
  });
  assert.match(server, /authorizeWrite\(req\)/);
  assert.match(server, /generateImages2Design/);
});
