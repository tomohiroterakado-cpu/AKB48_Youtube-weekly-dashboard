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

test("保護枠が画像全体を覆っても、下帯を差し替えて文言を欠けさせない", () => {
  const text = "ご視聴ありがとうございました！";
  const layout = createCaptionLayout({
    text,
    width: 1280,
    height: 720,
    protectedRegions: [
      { name: "全域", type: "face", shape: "rect", x: 0, y: 0, w: 1, h: 1 },
    ],
    measureText,
  });

  assert.equal(layout.lines.join(""), text);
  assert.equal(layout.placement, "bottom-band");
  assert.equal(layout.usedBottomBandFallback, true);
  assert.ok(layout.replacementArea);
  assert.equal(layout.hasCollision, false);
});

test("下帯にも収まらない文言は切らずにエラーで止める", () => {
  assert.throws(
    () => createCaptionLayout({
      text: "長いテロップを勝手に省略してはいけません".repeat(100),
      width: 1280,
      height: 720,
      protectedRegions: [
        { name: "全域", type: "face", shape: "rect", x: 0, y: 0, w: 1, h: 1 },
      ],
      measureText,
    }),
    /下帯にも収まらない/,
  );
});
