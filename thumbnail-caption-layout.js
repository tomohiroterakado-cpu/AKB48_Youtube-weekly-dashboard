(function attachThumbnailCaptionLayout(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ThumbnailCaptionLayout = api;
})(typeof window !== "undefined" ? window : globalThis, function createThumbnailCaptionLayout() {
  const OUTER_MARGIN = 0.035;
  // The YouTube duration badge occupies this corner on desktop and mobile.
  const DURATION_BADGE = { x: 0.79, y: 0.83, w: 0.19, h: 0.14 };

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizedRect(region) {
    const x = Number(region?.x);
    const y = Number(region?.y);
    const w = Number(region?.w);
    const h = Number(region?.h);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
    const left = clamp(x, 0, 1);
    const top = clamp(y, 0, 1);
    const right = clamp(x + w, 0, 1);
    const bottom = clamp(y + h, 0, 1);
    if (right <= left || bottom <= top) return null;
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  function expand(rect, amount) {
    const left = clamp(rect.x - amount, 0, 1);
    const top = clamp(rect.y - amount, 0, 1);
    const right = clamp(rect.x + rect.w + amount, 0, 1);
    const bottom = clamp(rect.y + rect.h + amount, 0, 1);
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  function rectanglesIntersect(first, second) {
    return first.x < second.x + second.w
      && first.x + first.w > second.x
      && first.y < second.y + second.h
      && first.y + first.h > second.y;
  }

  function uniqueSorted(values) {
    return [...new Set(values.map((value) => clamp(value, 0, 1).toFixed(5)))].map(Number).sort((a, b) => a - b);
  }

  function wrapText(text, fontSize, maxWidth, measureText) {
    const lines = [];
    let line = "";
    for (const character of Array.from(text)) {
      const candidate = line + character;
      if (line && measureText(candidate, fontSize) > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function candidateAreas(blockers) {
    const xEdges = uniqueSorted([OUTER_MARGIN, 1 - OUTER_MARGIN, ...blockers.flatMap((item) => [item.x, item.x + item.w])]);
    const yEdges = uniqueSorted([OUTER_MARGIN, 1 - OUTER_MARGIN, ...blockers.flatMap((item) => [item.y, item.y + item.h])]);
    const areas = [];
    for (let xIndex = 0; xIndex < xEdges.length - 1; xIndex += 1) {
      for (let xEndIndex = xIndex + 1; xEndIndex < xEdges.length; xEndIndex += 1) {
        for (let yIndex = 0; yIndex < yEdges.length - 1; yIndex += 1) {
          for (let yEndIndex = yIndex + 1; yEndIndex < yEdges.length; yEndIndex += 1) {
            const area = {
              x: xEdges[xIndex],
              y: yEdges[yIndex],
              w: xEdges[xEndIndex] - xEdges[xIndex],
              h: yEdges[yEndIndex] - yEdges[yIndex]
            };
            if (area.w < 0.12 || area.h < 0.09) continue;
            if (!blockers.some((blocker) => rectanglesIntersect(area, blocker))) areas.push(area);
          }
        }
      }
    }
    return areas;
  }

  function fitTextIntoArea({ text, area, width, height, measureText }) {
    const pixelWidth = Math.round(area.w * width);
    const pixelHeight = Math.round(area.h * height);
    const minFont = Math.max(22, Math.round(width * 0.018));
    const maxFont = Math.max(minFont, Math.round(Math.min(pixelWidth * 0.095, pixelHeight * 0.34, width * 0.09)));
    for (let fontSize = maxFont; fontSize >= minFont; fontSize -= 2) {
      const lines = wrapText(text, fontSize, pixelWidth * 0.91, measureText);
      const lineHeight = Math.round(fontSize * 1.16);
      if (lines.length <= 4 && lines.length * lineHeight <= pixelHeight * 0.86) {
        return { area, lines, fontSize, lineHeight, pixelWidth, pixelHeight };
      }
    }
    return null;
  }

  function createCaptionLayout({ text, width, height, protectedRegions = [], measureText }) {
    const requestedText = String(text || "").trim();
    if (!requestedText) throw new Error("変更後のテロップ文言を入力してください。");
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error("元サムネイルのサイズを取得できませんでした。");
    if (typeof measureText !== "function") throw new Error("テロップの幅を計測できませんでした。");

    const blockers = [DURATION_BADGE];
    protectedRegions.forEach((region) => {
      const normalized = normalizedRect(region);
      if (!normalized) return;
      blockers.push(expand(normalized, region?.type === "face" ? 0.026 : 0.018));
    });

    const fits = candidateAreas(blockers)
      .map((area) => fitTextIntoArea({ text: requestedText, area, width, height, measureText }))
      .filter(Boolean)
      .sort((first, second) => {
        if (second.fontSize !== first.fontSize) return second.fontSize - first.fontSize;
        return (second.area.w * second.area.h) - (first.area.w * first.area.h);
      });
    const best = fits[0];
    if (!best) throw new Error("安全なテロップ領域がありません。保護範囲を見直してください。文言は切らずに停止しました。");

    const textWidth = Math.max(...best.lines.map((line) => measureText(line, best.fontSize)));
    const textHeight = best.lines.length * best.lineHeight;
    const textX = Math.round((best.area.x * width) + (best.pixelWidth / 2));
    const textY = Math.round((best.area.y * height) + (best.pixelHeight / 2));
    const textBounds = {
      x: Math.round(textX - textWidth / 2 - best.fontSize * 0.12),
      y: Math.round(textY - textHeight / 2 - best.fontSize * 0.12),
      w: Math.round(textWidth + best.fontSize * 0.24),
      h: Math.round(textHeight + best.fontSize * 0.24)
    };
    const normalizedTextBounds = { x: textBounds.x / width, y: textBounds.y / height, w: textBounds.w / width, h: textBounds.h / height };
    return {
      text: requestedText,
      lines: best.lines,
      fontSize: best.fontSize,
      lineHeight: best.lineHeight,
      safeArea: best.area,
      textBounds,
      normalizedTextBounds,
      blockers,
      hasCollision: blockers.some((blocker) => rectanglesIntersect(normalizedTextBounds, blocker)),
      mobileReadable: best.fontSize >= width * 0.032,
      youtubeUiSafe: !rectanglesIntersect(normalizedTextBounds, DURATION_BADGE)
    };
  }

  return { createCaptionLayout, normalizedRect, rectanglesIntersect };
});
