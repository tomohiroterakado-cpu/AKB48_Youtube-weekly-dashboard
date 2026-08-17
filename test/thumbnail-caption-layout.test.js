const assert = require("node:assert/strict");
const test = require("node:test");

const { createCaptionLayout } = require("../thumbnail-caption-layout");

function measureText(line, fontSize) {
  return Array.from(String(line || "")).length * fontSize * 0.82;
}

test("指定テロップを欠けさせず、保護領域とYouTube表示領域を避ける", () => {
  const text = "全員集合「好きish」収録楽曲全曲ステージパフォーマンス";
  const layout = createCaptionLayout({
    text,
    width: 1536,
    height: 864,
    protectedRegions: [
      { name: "集合写真", type: "face", shape: "rect", x: 0.2, y: 0.2, w: 0.6, h: 0.5 },
    ],
    measureText,
  });

  assert.equal(layout.lines.join(""), text);
  assert.equal(layout.hasCollision, false);
  assert.equal(layout.youtubeUiSafe, true);
  assert.equal(layout.mobileReadable, true);
  assert.ok(layout.safeArea.y + layout.safeArea.h <= 0.83 || layout.safeArea.x + layout.safeArea.w <= 0.79);
});

test("安全領域が足りない場合は文言を切らずにエラーで止める", () => {
  assert.throws(
    () => createCaptionLayout({
      text: "長いテロップを勝手に省略してはいけません",
      width: 1280,
      height: 720,
      protectedRegions: [
        { name: "全域", type: "face", shape: "rect", x: 0, y: 0, w: 1, h: 1 },
      ],
      measureText,
    }),
    /安全なテロップ領域/,
  );
});
