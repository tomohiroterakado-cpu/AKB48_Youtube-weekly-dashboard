const COLUMN_ALIASES = {
  videoId: ["動画ID", "コンテンツ", "video id", "video_id"],
  title: ["動画タイトル", "動画のタイトル", "title"],
  publishedAt: ["公開日時", "動画公開時刻", "動画公開日", "公開日"],
  visibility: ["公開設定", "公開設定のステータス", "公開範囲", "公開ステータス", "visibility"],
  durationSeconds: ["長さ", "動画の長さ", "duration"],
  uniqueViewers: ["ユニーク視聴者数", "ユニーク視聴者"],
  newViewers: ["新しい視聴者数", "新規視聴者数"],
  returningViewers: ["リピーター", "リピーター数"],
  views: ["視聴回数", "再生数"],
  watchHours: ["総再生時間（単位: 時間）", "総再生時間（時間）", "総再生時間"],
  subscribers: ["チャンネル登録者", "チャンネル登録者数"],
  subscriberGains: ["登録者増加数", "チャンネル登録者増加数"],
  estimatedRevenue: ["推定収益 (JPY)", "推定収益", "推定収益（JPY）"],
  averageViewDuration: ["平均視聴時間"],
  impressions: ["インプレッション数", "インプレッション"],
  ctr: ["インプレッションのクリック率 (%)", "インプレッションCTR", "クリック率"],
  likes: ["高評価数"],
  comments: ["コメントの追加回数", "コメント追加回数", "コメント数"],
  shares: ["共有数", "シェア数"],
  averagePercentageViewed: ["平均視聴率 (%)", "平均視聴率"],
  choseToViewRate: ["視聴を選択した割合 (%)", "視聴を選択した割合"],
  swipedAwayRate: ["スワイプされた割合 (%)", "スワイプされた割合"]
};

const REQUIRED_FIELDS = ["videoId", "title"];
const DAILY_DATE_ALIASES = ["日付", "日", "date", "日付（JST）"];
const NUMERIC_FIELDS = [
  "uniqueViewers", "newViewers", "returningViewers", "views", "watchHours",
  "subscribers", "subscriberGains", "estimatedRevenue", "impressions", "ctr",
  "likes", "comments", "shares", "averagePercentageViewed", "choseToViewRate", "swipedAwayRate"
];

function normalizeHeader(value) {
  return String(value || "").replace(/^\uFEFF/, "").normalize("NFKC").trim().toLowerCase();
}

const ALIAS_LOOKUP = Object.entries(COLUMN_ALIASES).reduce((lookup, [canonical, aliases]) => {
  aliases.forEach((alias) => lookup.set(normalizeHeader(alias), canonical));
  return lookup;
}, new Map());

function parseCsv(text) {
  const input = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("CSVの引用符が閉じられていません。");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((items) => items.some((value) => String(value).trim() !== ""));
}

function numberValue(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).replace(/[,%￥¥]/g, "").trim();
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function durationSecondsValue(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  const match = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (match) {
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if (minutes < 60 && seconds < 60) return hours * 3600 + minutes * 60 + seconds;
  }
  return numberValue(value);
}

function mapYouTubeCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("CSVにデータがありません。");
  const headers = rows[0].map((value) => String(value || "").trim());
  const mapping = {};
  const unknownHeaders = [];
  headers.forEach((header, index) => {
    const canonical = ALIAS_LOOKUP.get(normalizeHeader(header));
    if (canonical && mapping[canonical] === undefined) mapping[canonical] = index;
    else if (header && !canonical) unknownHeaders.push(header);
  });

  const missingRequired = REQUIRED_FIELDS.filter((field) => mapping[field] === undefined);
  if (missingRequired.length) {
    const labels = missingRequired.map((field) => COLUMN_ALIASES[field][0]);
    const error = new Error(`必須列が見つかりません: ${labels.join("、")}`);
    error.code = "MISSING_COLUMNS";
    error.details = { headers, missingRequired, expectedAliases: COLUMN_ALIASES };
    throw error;
  }

  const records = rows.slice(1).map((values, rowIndex) => {
    const record = { sourceRow: rowIndex + 2 };
    Object.entries(mapping).forEach(([field, index]) => {
      record[field] = values[index] === undefined ? "" : String(values[index]).trim();
    });
    return record;
  });
  const summary = records.find((record) => normalizeHeader(record.videoId) === "合計") || null;
  const videos = records
    .filter((record) => record.videoId && normalizeHeader(record.videoId) !== "合計")
    .filter((record) => /^[A-Za-z0-9_-]{11}$/.test(record.videoId))
    .map((record) => ({
      ...record,
      durationSeconds: durationSecondsValue(record.durationSeconds),
      uniqueViewers: numberValue(record.uniqueViewers),
      newViewers: numberValue(record.newViewers),
      returningViewers: numberValue(record.returningViewers),
      views: numberValue(record.views),
      watchHours: numberValue(record.watchHours),
      subscribers: numberValue(record.subscribers),
      subscriberGains: numberValue(record.subscriberGains),
      estimatedRevenue: numberValue(record.estimatedRevenue),
      impressions: numberValue(record.impressions),
      ctr: numberValue(record.ctr),
      likes: numberValue(record.likes),
      comments: numberValue(record.comments),
      shares: numberValue(record.shares),
      averagePercentageViewed: numberValue(record.averagePercentageViewed),
      choseToViewRate: numberValue(record.choseToViewRate),
      swipedAwayRate: numberValue(record.swipedAwayRate)
    }));

  return {
    headers,
    mapping,
    unknownHeaders,
    summary,
    videos,
    rowCount: records.length,
    ignoredRowCount: records.filter((record) => record.videoId && normalizeHeader(record.videoId) !== "合計" && !/^[A-Za-z0-9_-]{11}$/.test(record.videoId)).length
  };
}

function dailyDateValue(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function mapDailyYouTubeCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("日別CSVにデータがありません。");
  const headers = rows[0].map((value) => String(value || "").trim());
  const mapping = {};
  const unknownHeaders = [];
  let dateIndex;
  headers.forEach((header, index) => {
    if (DAILY_DATE_ALIASES.map(normalizeHeader).includes(normalizeHeader(header)) && dateIndex === undefined) {
      dateIndex = index;
      return;
    }
    const canonical = ALIAS_LOOKUP.get(normalizeHeader(header));
    if (canonical && mapping[canonical] === undefined) mapping[canonical] = index;
    else if (header && !canonical) unknownHeaders.push(header);
  });
  if (dateIndex === undefined) {
    const error = new Error(`日別CSVに必須列が見つかりません: ${DAILY_DATE_ALIASES[0]}`);
    error.code = "MISSING_DAILY_DATE_COLUMN";
    error.details = { headers, expectedAliases: DAILY_DATE_ALIASES };
    throw error;
  }
  const availableMetrics = NUMERIC_FIELDS.filter((field) => mapping[field] !== undefined);
  if (!availableMetrics.length) throw new Error("日別CSVに利用できる数値列が見つかりません。ユニーク視聴者数、視聴回数などの列を含めてください。");

  const invalidRows = [];
  const records = rows.slice(1).map((values, rowIndex) => {
    const date = dailyDateValue(values[dateIndex]);
    if (!date) {
      if (String(values[dateIndex] || "").trim()) invalidRows.push(rowIndex + 2);
      return null;
    }
    const record = { sourceRow: rowIndex + 2, date };
    Object.entries(mapping).forEach(([field, index]) => {
      record[field] = numberValue(values[index]);
    });
    return record;
  }).filter(Boolean);
  const duplicateDates = records.reduce((duplicates, record, index) => {
    if (records.findIndex((item) => item.date === record.date) !== index) duplicates.add(record.date);
    return duplicates;
  }, new Set());
  if (duplicateDates.size) throw new Error(`日別CSV内で日付が重複しています: ${[...duplicateDates].join("、")}`);

  return {
    headers,
    mapping,
    unknownHeaders,
    records,
    rowCount: rows.length - 1,
    invalidRows,
    missingMetricColumns: ["uniqueViewers"].filter((field) => mapping[field] === undefined)
  };
}

module.exports = { COLUMN_ALIASES, REQUIRED_FIELDS, DAILY_DATE_ALIASES, NUMERIC_FIELDS, dailyDateValue, durationSecondsValue, mapDailyYouTubeCsv, mapYouTubeCsv, normalizeHeader, numberValue, parseCsv };
