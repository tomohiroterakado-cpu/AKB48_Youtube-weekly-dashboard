const SPREADSHEET_ID = '1fYJtcL-rqzLLe-vJmkWBQR5q9M5cxXCam5v0TAHJBZM';
const TARGET_DATE = '2027-03-31';

const DEFAULT_GOALS = [
  { label: '累計視聴回数', metric: '総視聴回数', target: 20000000, unit: '回', format: 'number' },
  { label: '累計再生時間', metric: '総再生時間（時間）', target: 1500000, unit: '時間', format: 'hours' },
  { label: '累計登録者増加', metric: '登録者増加数', target: 30000, unit: '人', format: 'number' },
  { label: '累計ユニーク視聴者', metric: 'ユニーク視聴者数', target: 4000000, unit: '人', format: 'number' }
];

function doGet(e) {
  const data = buildDashboardData_();
  const json = JSON.stringify(data);
  const callback = e && e.parameter && e.parameter.callback;
  if (callback && /^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(callback)) {
    return ContentService
      .createTextOutput(`${callback}(${json});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function buildDashboardData_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const weekly = rowsByHeader_(spreadsheet.getSheetByName('CSV_週次集計'), 3)
    .filter((row) => row['週開始日'] && row['週終了日'])
    .sort((a, b) => dateTime_(a['週開始日']) - dateTime_(b['週開始日']));
  const videos = rowsByHeader_(spreadsheet.getSheetByName('自チャンネル動画'), 3);
  const ideas = rowsByHeader_(spreadsheet.getSheetByName('企画案'), 3);
  const daily = rowsByHeader_(spreadsheet.getSheetByName('CSV_日別'), 3);
  const goalSettings = readGoals_(spreadsheet.getSheetByName('目標設定'));

  return {
    source: {
      spreadsheetId: SPREADSHEET_ID,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?usp=drivesdk`,
      updatedAt: `${Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm')} JST`,
      updateCadence: '毎週火曜 15:00'
    },
    weeks: weekly.map((row, index) => buildWeekData_(row, index, weekly, videos, ideas, daily, goalSettings))
  };
}

function buildWeekData_(weeklyRow, weekIndex, allWeeks, videos, ideas, daily, goalSettings) {
  const weekStart = toDateText_(weeklyRow['週開始日']);
  const matchingVideos = videos
    .filter((row) => toDateText_(row['週開始日']) === weekStart)
    .sort((a, b) => Number(b['再生数'] || 0) - Number(a['再生数'] || 0))
    .slice(0, 4);

  const matchingIdeas = ideas
    .filter((row) => toDateText_(row['週開始日']) === weekStart)
    .sort((a, b) => priorityScore_(b['実施優先度']) - priorityScore_(a['実施優先度']))
    .slice(0, 3);

  const matchingDaily = daily
    .filter((row) => toDateText_(row['週開始日']) === weekStart)
    .map((row) => ({
      date: toShortDateText_(row['日付'] || row['日']),
      value: Number(row['ユニーク視聴者数'] || row['ユニーク視聴者'] || row['視聴者数'] || 0)
    }))
    .filter((row) => row.date && row.value);

  return {
    key: `${weekStart}_${toDateText_(weeklyRow['週終了日'])}`,
    week: {
      start: weekStart,
      end: toDateText_(weeklyRow['週終了日']),
      reportDate: toDateText_(weeklyRow['集計日']),
      status: String(weeklyRow['入力ステータス'] || '')
    },
    headline: String(weeklyRow['勝ち要因'] || ''),
    decisions: splitActions_(weeklyRow['次アクション']),
    goals: buildGoals_(goalSettings, allWeeks, weekIndex),
    kpis: [
      { label: '総視聴回数', value: Number(weeklyRow['総視聴回数'] || 0), format: 'number', note: 'CSV合計行ベース' },
      { label: '総再生時間', value: Number(weeklyRow['総再生時間（時間）'] || 0), format: 'hours', note: '長尺が牽引' },
      { label: '平均視聴時間', value: String(weeklyRow['平均視聴時間'] || ''), format: 'text', note: '週次平均' },
      { label: '登録者増加数', value: Number(weeklyRow['登録者増加数'] || 0), format: 'number', note: '全体合計' },
      { label: 'ユニーク視聴者', value: Number(weeklyRow['ユニーク視聴者数'] || 0), format: 'number', note: '合計行を正として採用' },
      { label: 'インプレッション', value: Number(weeklyRow['インプレッション数'] || 0), format: 'number', note: `CTR ${weeklyRow['インプレッションCTR'] || ''}%` },
      { label: '高評価数', value: Number(weeklyRow['高評価数'] || 0), format: 'number', note: '熱量の基礎値' },
      { label: 'コメント追加', value: Number(weeklyRow['コメント追加回数'] || 0), format: 'number', note: '会話量の基礎値' }
    ],
    dailyUnique: matchingDaily,
    topVideos: matchingVideos.map((row) => ({
      id: videoIdFromUrl_(row['URL']),
      title: String(row['動画タイトル'] || ''),
      url: String(row['URL'] || ''),
      genre: String(row['企画ジャンル'] || ''),
      views: Number(row['再生数'] || 0),
      likes: Number(row['高評価数'] || 0),
      comments: Number(row['コメント数'] || 0),
      ctr: String(row['想定CTR'] || ''),
      avg: String(row['維持率'] || ''),
      memo: String(row['改善メモ'] || '')
    })),
    insights: [
      { label: '勝ち要因', text: String(weeklyRow['勝ち要因'] || '') },
      { label: '課題', text: String(weeklyRow['課題'] || '') },
      { label: '第三者目線', text: 'ライト層は企画のわかりやすさ、古参ファンは関係性と成長過程、一般視聴者は一瞬で伝わる感情フックで反応しやすい。' }
    ],
    actions: splitActions_(weeklyRow['次アクション']),
    ideas: matchingIdeas.map((row) => ({
      name: String(row['企画名'] || ''),
      priority: String(row['実施優先度'] || ''),
      aim: String(row['狙い'] || ''),
      title: String(row['想定タイトル'] || ''),
      thumbnail: String(row['サムネ方向性'] || ''),
      metric: String(row['成功指標'] || '')
    }))
  };
}

function buildGoals_(goalSettings, allWeeks, weekIndex) {
  const weeksToDate = allWeeks.slice(0, weekIndex + 1);
  const endDate = toDate_(allWeeks[weekIndex]['週終了日']);
  const targetDate = toDate_(goalSettings[0]?.targetDate || TARGET_DATE);
  const remainingWeeks = Math.max(1, Math.ceil((targetDate.getTime() - endDate.getTime()) / (7 * 24 * 60 * 60 * 1000)));

  return {
    targetDate: Utilities.formatDate(targetDate, 'Asia/Tokyo', 'yyyy-MM-dd'),
    items: goalSettings.map((goal) => {
      const current = weeksToDate.reduce((sum, row) => sum + Number(row[goal.metric] || 0), 0);
      const progress = goal.target ? (current / goal.target) * 100 : 0;
      const requiredWeeklyPace = Math.max(0, (goal.target - current) / remainingWeeks);
      const actualWeeklyPace = current / Math.max(1, weeksToDate.length);
      const probability = requiredWeeklyPace > 0 ? Math.min(100, (actualWeeklyPace / requiredWeeklyPace) * 100) : 100;
      return {
        label: goal.label,
        current,
        target: goal.target,
        progress: round1_(progress),
        probability: round1_(probability),
        requiredWeeklyPace: round1_(requiredWeeklyPace),
        format: goal.format
      };
    })
  };
}

function readGoals_(sheet) {
  if (!sheet) return DEFAULT_GOALS.map((goal) => ({ ...goal, targetDate: TARGET_DATE }));

  const rows = rowsByHeader_(sheet, 1)
    .filter((row) => row['目標名'] && row['対象指標'] && row['目標値'])
    .map((row) => ({
      label: String(row['目標名']),
      metric: String(row['対象指標']),
      target: Number(row['目標値'] || 0),
      unit: String(row['単位'] || ''),
      targetDate: toDateText_(row['期限']) || TARGET_DATE,
      format: String(row['表示形式'] || 'number')
    }));

  return rows.length ? rows : DEFAULT_GOALS.map((goal) => ({ ...goal, targetDate: TARGET_DATE }));
}

function rowsByHeader_(sheet, headerRow) {
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  const headers = values[headerRow - 1] || [];
  return values.slice(headerRow).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      if (header) item[String(header)] = row[index];
    });
    return item;
  });
}

function toDateText_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(value || '');
}

function toShortDateText_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'Asia/Tokyo', 'M/d');
  }
  return String(value || '');
}

function toDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return value;
  return new Date(String(value || TARGET_DATE));
}

function dateTime_(value) {
  return toDate_(value).getTime();
}

function splitActions_(value) {
  const text = String(value || '');
  const parts = text
    .split(/[。．\n]/)
    .map((part) => part.replace(/^\d+\)\s*/, '').trim())
    .filter(Boolean);
  return parts.length ? parts.slice(0, 4) : ['最新CSVの反映状況を確認する', '勝ち動画の横展開を決める', '次回企画の優先順位を決める'];
}

function videoIdFromUrl_(url) {
  const text = String(url || '');
  const watchMatch = text.match(/[?&]v=([^&]+)/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = text.match(/youtu\.be\/([^?&/]+)/);
  if (shortMatch) return shortMatch[1];
  const shortsMatch = text.match(/\/shorts\/([^?&/]+)/);
  return shortsMatch ? shortsMatch[1] : '';
}

function priorityScore_(value) {
  if (value === '高') return 3;
  if (value === '中') return 2;
  if (value === '低') return 1;
  return 0;
}

function round1_(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}
