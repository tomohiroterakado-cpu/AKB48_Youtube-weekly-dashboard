const crypto = require("node:crypto");

function dateKey(value) {
  const match = String(value || "").match(/(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
  return match ? `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}` : "";
}

function marketReportKey(periodStart, periodEnd) {
  return `${periodStart}_${periodEnd}`;
}

function isSaturdayToFriday(periodStart, periodEnd) {
  const start = Date.parse(`${periodStart}T00:00:00Z`);
  const end = Date.parse(`${periodEnd}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return new Date(start).getUTCDay() === 6 && (end - start) === 6 * 24 * 60 * 60 * 1000;
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

// 7/14にGmailで受信した市場調査レポートを、初回表示用の参考情報として保持する。
// 今後は同じ対象期間の保存済みレポートがあれば、そちらを優先する。
const SEED_MARKET_REPORTS = [{
  id: "market_20260704_20260710_gmail",
  periodStart: "2026-07-04",
  periodEnd: "2026-07-10",
  source: "Gmail",
  subject: "【週次】AKBの素を出すちゃんねる 市場調査レポート 2026/07/14",
  receivedAt: "2026-07-14T13:03:53+09:00",
  status: "reference",
  data: {
    note: "公開情報を補助材料として使う参考情報です。自チャンネルの成績とは分けて表示します。",
    sections: [
      {
        key: "competitors",
        title: "競合・参考チャンネル",
        status: "公開情報の参考",
        entries: [
          {
            label: "FRUITS ZIPPER",
            text: "ライブ本編とShortsを近接公開し、季節ワードと楽曲を束ねる運用。AKBでも新曲・公演素材を同日パッケージ化する余地があります。",
            link: "https://yutura.net/channel/88584/latest/",
            linkLabel: "最新動画を確認"
          },
          {
            label: "乃木坂配信中",
            text: "冠番組とメンバー企画の役割を分けて習慣視聴を作る設計。AKBはエンタメ学園の曜日固定と翌日のShorts展開が転用候補です。",
            link: "https://www.nogizaka46.com/s/n46/contents_list?type=140",
            linkLabel: "公式コンテンツ案内"
          }
        ]
      },
      {
        key: "youtube",
        title: "日本のYouTubeトレンド",
        status: "公開情報の参考",
        entries: [
          {
            label: "国内企業タイアップShortsの参考値",
            text: "7/4〜7/10公開分の企業タイアップShortsを対象にした参考ランキングです。エンターテインメント、食品・美容、体験やレビュー型が含まれます。ただし、日本のShorts全体を代表する傾向ではありません。AKBでの有効性は自チャンネルCSVで別途検証します。",
            link: "https://digimabox.com/youtube-shorts-trend-week-2026-07-04/",
            linkLabel: "企業タイアップShortsの参照元"
          },
          {
            label: "Shortsの視聴体験",
            text: "YouTubeはShortsの視聴機能を更新。冒頭1秒の結論テロップと、3秒以内の表情変化を優先する仮説です。効果は自チャンネルCSVで検証します。",
            link: "https://blog.youtube/intl/ja-jp/news-and-events/youtube-shorts-experience-updates-features/",
            linkLabel: "YouTube公式情報"
          }
        ]
      },
      {
        key: "social-search",
        title: "SNS / 検索トレンド",
        status: "データ不足のため判定不可",
        entries: [
          {
            label: "今回の扱い",
            text: "受信した市場調査レポートには、対象期間のSNS投稿量・検索数・検索語の定量データが含まれていません。根拠のないトレンドは表示しません。十分な履歴または取得元が整った後に利用可能です。"
          }
        ]
      }
    ]
  },
  createdAt: "2026-07-14T13:03:53+09:00",
  updatedAt: "2026-07-14T13:03:53+09:00"
}];

function extractPeriod(text) {
  const matches = [...String(text || "").matchAll(/(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\D{0,8}[〜~]\D{0,8}(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/g)];
  const match = matches.at(-1);
  if (!match) return { periodStart: "", periodEnd: "" };
  return {
    periodStart: `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`,
    periodEnd: `${match[4]}-${String(match[5]).padStart(2, "0")}-${String(match[6]).padStart(2, "0")}`
  };
}

function extractNumberedSection(body, heading) {
  const text = String(body || "").replace(/\r/g, "");
  const startMatch = text.match(heading);
  if (!startMatch || startMatch.index === undefined) return "";
  const afterHeading = text.slice(startMatch.index + startMatch[0].length);
  const nextHeading = afterHeading.search(/(?:^|\n)\s*\d+\.\s+[^\n]+/);
  return (nextHeading < 0 ? afterHeading : afterHeading.slice(0, nextHeading)).trim();
}

function compactText(value) {
  return String(value || "").replace(/\r/g, "").split("\n")
    .map((line) => line.replace(/^\s*[-・]\s*/, "").trim())
    .filter((line) => line && !/^参考[：:]/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function sectionEntries(label, body) {
  return String(body || "").replace(/\r/g, "").split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const urls = [...block.matchAll(/https?:\/\/[^\s)]+/g)].map((match) => match[0]);
      const text = compactText(block.replace(/https?:\/\/[^\s)]+/g, ""));
      if (!text) return null;
      const firstLine = text.split("\n")[0] || "";
      const named = firstLine.match(/^([^：:]{2,48})[：:]\s*(.+)$/);
      return {
        label: named ? named[1].trim() : (index ? `${label} ${index + 1}` : label),
        text: named ? named[2].trim() : text,
        ...(urls[0] ? { link: urls[0], linkLabel: "参照元を開く" } : {})
      };
    })
    .filter(Boolean);
}

function marketReportFromEmail(payload) {
  const body = String(payload.body || "");
  const fromBody = extractPeriod(body);
  const periodStart = dateKey(payload.periodStart) || fromBody.periodStart;
  const periodEnd = dateKey(payload.periodEnd) || fromBody.periodEnd;
  if (!periodStart || !periodEnd) throw new Error("市場調査レポートの対象期間を取得できません。本文または対象期間を確認してください。");
  if (!isSaturdayToFriday(periodStart, periodEnd)) {
    throw new Error("市場調査レポートの対象期間は、土曜日00:00から金曜日23:59までの7日間（JST）である必要があります。");
  }

  const competitor = extractNumberedSection(body, /(?:^|\n)\s*\d+\.\s*[^\n]*(?:競合|参考チャンネル)[^\n]*/m);
  const youtube = extractNumberedSection(body, /(?:^|\n)\s*\d+\.\s*[^\n]*(?:YouTube|ユーチューブ)[^\n]*/im);
  const social = extractNumberedSection(body, /(?:^|\n)\s*\d+\.\s*[^\n]*(?:SNS|検索)[^\n]*/im);
  const competitorEntries = sectionEntries("Gmail市場調査レポート", competitor);
  const youtubeEntries = sectionEntries("Gmail市場調査レポート", youtube);
  const socialEntries = sectionEntries("Gmail市場調査レポート", social);
  if (!competitorEntries.some((entry) => entry.link) || !youtubeEntries.some((entry) => entry.link)) {
    throw new Error("市場調査レポートの競合・YouTubeトレンドには、根拠となる参照URLが必要です。メール本文の見出しと出典URLを確認してください。");
  }
  const contentHash = crypto.createHash("sha256").update(`${payload.subject || ""}\n${body}`).digest("hex");
  const now = new Date().toISOString();
  return {
    id: `market_${marketReportKey(periodStart, periodEnd)}_${contentHash.slice(0, 12)}`,
    periodStart,
    periodEnd,
    source: "Gmail",
    subject: String(payload.subject || "週次市場調査レポート"),
    receivedAt: payload.receivedAt || now,
    status: "reference",
    contentHash,
    data: {
      note: "Gmailで受信した週次市場調査レポートを、公開情報の参考として表示しています。",
      sections: [
        { key: "competitors", title: "競合・参考チャンネル", status: "Gmail本文の参考（出典URL確認済み）", entries: competitorEntries },
        { key: "youtube", title: "日本のYouTubeトレンド", status: "Gmail本文の参考（出典URL確認済み）", entries: youtubeEntries },
        { key: "social-search", title: "SNS / 検索トレンド", status: socialEntries.length ? "Gmail本文の参考（出典URL確認済み）" : "データ不足のため判定不可", entries: socialEntries.length ? socialEntries : [{ label: "今回の扱い", text: "SNS・検索の定量データが本文にないため、判定不可として記録します。" }] }
      ]
    },
    createdAt: now,
    updatedAt: now
  };
}

function attachMarketReports(report, marketReports = []) {
  const saved = new Map((marketReports || [])
    .filter((item) => item.status === "reference")
    .map((item) => [marketReportKey(item.periodStart, item.periodEnd), item]));
  const seeds = new Map(SEED_MARKET_REPORTS.map((item) => [marketReportKey(item.periodStart, item.periodEnd), item]));
  return {
    ...report,
    weeks: (report.weeks || []).map((week) => {
      const key = marketReportKey(week.week.start, week.week.end);
      const marketReport = saved.get(key) || seeds.get(key) || null;
      return marketReport ? { ...week, marketReport: copy(marketReport) } : week;
    })
  };
}

function upsertMarketReport(state, report) {
  state.marketReports = state.marketReports || [];
  const index = state.marketReports.findIndex((item) => item.contentHash && item.contentHash === report.contentHash);
  if (index >= 0) return { status: "skipped_duplicate", report: state.marketReports[index] };
  const samePeriod = state.marketReports.findIndex((item) => item.periodStart === report.periodStart && item.periodEnd === report.periodEnd);
  if (samePeriod >= 0) {
    const pending = { ...report, status: "pending_review", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    state.marketReports.push(pending);
    return { status: "needs_review", report: pending, existingReport: state.marketReports[samePeriod] };
  }
  state.marketReports.push(report);
  return { status: "created", report };
}

function approveMarketReport(state, reportId) {
  state.marketReports = state.marketReports || [];
  const index = state.marketReports.findIndex((item) => item.id === reportId);
  if (index < 0) throw new Error("確認待ちの市場調査レポートが見つかりません。");
  const target = state.marketReports[index];
  if (target.status !== "pending_review") throw new Error("この市場調査レポートは確認待ちではありません。");
  state.marketReports.forEach((item, itemIndex) => {
    if (itemIndex !== index && item.periodStart === target.periodStart && item.periodEnd === target.periodEnd && item.status === "reference") {
      item.status = "superseded";
      item.updatedAt = new Date().toISOString();
    }
  });
  state.marketReports[index] = { ...target, status: "reference", updatedAt: new Date().toISOString() };
  return { status: "approved", report: state.marketReports[index] };
}

module.exports = { SEED_MARKET_REPORTS, approveMarketReport, attachMarketReports, extractPeriod, isSaturdayToFriday, marketReportFromEmail, marketReportKey, upsertMarketReport };
