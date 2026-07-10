const SPREADSHEET_ID = '1fYJtcL-rqzLLe-vJmkWBQR5q9M5cxXCam5v0TAHJBZM';
const TARGET_DATE = '2027-03-31';
const REPORT_RECIPIENT = 'tomohiro.terakado@dh2020.co.jp';
const DASHBOARD_URL = 'https://akb-weekly-dashboard-238040933312.asia-northeast1.run.app';
const EMAIL_TRIGGER_FUNCTION = 'sendWeeklyDashboardEmail';

const DEFAULT_GOALS = [
  { label: '累計視聴回数', metric: '総視聴回数', target: 20000000, unit: '回', format: 'number' },
  { label: '累計再生時間', metric: '総再生時間（時間）', target: 1500000, unit: '時間', format: 'hours' },
  { label: '累計登録者増加', metric: '登録者増加数', target: 30000, unit: '人', format: 'number' },
  { label: '累計ユニーク視聴者', metric: 'ユニーク視聴者数', target: 4000000, unit: '人', format: 'number' }
];

const FALLBACK_DAILY_UNIQUE_BY_WEEK = {
  '2026-06-29': [
    { date: '6/29', value: 21358 },
    { date: '6/30', value: 17941 },
    { date: '7/1', value: 16215 },
    { date: '7/2', value: 14520 },
    { date: '7/3', value: 34703 },
    { date: '7/4', value: 41014 },
    { date: '7/5', value: 36273 }
  ]
};

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

function sendWeeklyDashboardEmail() {
  let latestWeek = null;
  let subject = '【週次】AKBの素を出すちゃんねる YouTubeレポート更新通知';

  try {
    const data = buildDashboardData_();
    latestWeek = latestWeek_(data);
    subject = `【週次】AKBの素を出すちゃんねる YouTubeレポート ${latestWeek.week.start}〜${latestWeek.week.end}`;
    MailApp.sendEmail({
      to: REPORT_RECIPIENT,
      subject,
      body: buildEmailBody_(data, latestWeek),
      htmlBody: buildEmailHtml_(data, latestWeek)
    });
    appendSendLog_(latestWeek, subject, '送信済み', '');
  } catch (error) {
    appendSendLog_(latestWeek, subject, '送信失敗', String(error && error.message ? error.message : error));
    throw error;
  }
}

function setupWeeklyDashboardEmailTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === EMAIL_TRIGGER_FUNCTION)
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger(EMAIL_TRIGGER_FUNCTION)
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.TUESDAY)
    .atHour(15)
    .nearMinute(0)
    .everyWeeks(1)
    .inTimezone('Asia/Tokyo')
    .create();

  return `毎週火曜15:00のメール通知を設定しました: ${REPORT_RECIPIENT}`;
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
  const dailyUnique = matchingDaily.length ? matchingDaily : fallbackDailyUnique_(weekStart);

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
    dailyUnique,
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

function fallbackDailyUnique_(weekStart) {
  return FALLBACK_DAILY_UNIQUE_BY_WEEK[weekStart] || [];
}

function latestWeek_(data) {
  if (!data.weeks || !data.weeks.length) {
    throw new Error('週次データがありません。CSV_週次集計を確認してください。');
  }
  return data.weeks[data.weeks.length - 1];
}

function buildEmailBody_(data, week) {
  const kpiLines = week.kpis
    .slice(0, 8)
    .map((item) => `- ${item.label}: ${formatEmailValue_(item.value, item.format)}`)
    .join('\n');
  const actionLines = week.actions.map((action, index) => `${index + 1}. ${action}`).join('\n');

  return [
    'AKBの素を出すちゃんねる 週次YouTubeレポートを更新しました。',
    '',
    `対象週: ${week.week.start}〜${week.week.end}`,
    `レポート日: ${week.week.reportDate}`,
    '',
    '▼Webサイト',
    DASHBOARD_URL,
    '',
    '▼蓄積シート',
    data.source.spreadsheetUrl,
    '',
    '▼今週の結論',
    week.headline || '-',
    '',
    '▼主要KPI',
    kpiLines,
    '',
    '▼次アクション',
    actionLines,
    '',
    `最終更新: ${data.source.updatedAt}`
  ].join('\n');
}

function buildEmailHtml_(data, week) {
  const kpis = week.kpis
    .slice(0, 8)
    .map((item) => `<li><strong>${escapeHtml_(item.label)}:</strong> ${escapeHtml_(formatEmailValue_(item.value, item.format))}</li>`)
    .join('');
  const actions = week.actions
    .map((action) => `<li>${escapeHtml_(action)}</li>`)
    .join('');

  return `
    <div style="font-family: Arial, 'Hiragino Sans', 'Yu Gothic', sans-serif; line-height: 1.7; color: #202124;">
      <h2>AKBの素を出すちゃんねる 週次YouTubeレポートを更新しました</h2>
      <p><strong>対象週:</strong> ${escapeHtml_(week.week.start)}〜${escapeHtml_(week.week.end)}<br>
      <strong>レポート日:</strong> ${escapeHtml_(week.week.reportDate)}</p>
      <p style="font-size: 16px;"><strong>Webサイト:</strong><br>
      <a href="${DASHBOARD_URL}">${DASHBOARD_URL}</a></p>
      <p><strong>蓄積シート:</strong><br>
      <a href="${data.source.spreadsheetUrl}">${data.source.spreadsheetUrl}</a></p>
      <h3>今週の結論</h3>
      <p>${escapeHtml_(week.headline || '-')}</p>
      <h3>主要KPI</h3>
      <ul>${kpis}</ul>
      <h3>次アクション</h3>
      <ol>${actions}</ol>
      <p style="color:#666;">最終更新: ${escapeHtml_(data.source.updatedAt)}</p>
    </div>
  `;
}

function appendSendLog_(week, subject, result, errorText) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName('送信ログ') || spreadsheet.insertSheet('送信ログ');
  if (sheet.getLastRow() < 3) {
    sheet.getRange(1, 1, 3, 8).setValues([
      ['メール送信ログ', '', '', '', '', '', '', ''],
      ['毎週火曜15時のWebサイト更新通知メール送信結果を記録。LINE送信は行わない。', '', '', '', '', '', '', ''],
      ['レポート対象週', '送信日時', '送信先', '件名', 'レポートURL/保存先', '送信結果', 'エラー内容', '次回改善メモ']
    ]);
  }

  const weekText = week ? `${week.week.start}〜${week.week.end}` : '';
  sheet.appendRow([
    weekText,
    `${Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm')} JST`,
    REPORT_RECIPIENT,
    subject,
    DASHBOARD_URL,
    result,
    errorText,
    'メール本文にWebサイトURLを記載'
  ]);
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

function formatEmailValue_(value, format) {
  if (value === undefined || value === null || value === '') return '-';
  if (format === 'hours') return `${formatNumber_(value)}h`;
  if (format === 'yen') return `¥${formatNumber_(value)}`;
  if (format === 'percent') return `${formatNumber_(value)}%`;
  if (format === 'text') return String(value);
  return formatNumber_(value);
}

function formatNumber_(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return String(value);
  return number.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
