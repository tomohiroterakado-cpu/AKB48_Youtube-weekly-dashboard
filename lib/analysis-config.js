// 調整する場合はこの値だけを変更する。分析ロジック本体には閾値を埋め込まない。
const ANALYSIS_CONFIDENCE = Object.freeze({
  high: { minimumWeeks: 8, minimumVideos: 30, label: "高", reason: "8週以上・30動画以上" },
  medium: { minimumWeeks: 4, minimumVideos: 15, label: "中", reason: "4週以上・15動画以上。ただし偏りに注意" },
  low: { label: "低", reason: "動画数または期間が少なく、現時点では統計的な信頼性が低い" }
});

module.exports = { ANALYSIS_CONFIDENCE };
