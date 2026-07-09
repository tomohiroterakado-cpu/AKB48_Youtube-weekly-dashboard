const SPREADSHEET_ID = '1fYJtcL-rqzLLe-vJmkWBQR5q9M5cxXCam5v0TAHJBZM';

function doGet() {
  const data = buildDashboardData_();
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function buildDashboardData_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const weekly = rowsByHeader_(spreadsheet.getSheetByName('CSV_週次集計'), 3);
  const videos = rowsByHeader_(spreadsheet.getSheetByName('自チャンネル動画'), 3);
  const ideas = rowsByHeader_(spreadsheet.getSheetByName('企画案'), 3);

  const latestWeek = weekly
    .filter((row) => row['週開始日'] && row['週終了日'])
    .pop();

  const weekStart = toDateText_(latestWeek['週開始日']);
  const matchingVideos = videos
    .filter((row) => toDateText_(row['週開始日']) === weekStart)
    .sort((a, b) => Number(b['再生数'] || 0) - Number(a['再生数'] || 0))
    .slice(0, 4);

  const matchingIdeas = ideas
    .filter((row) => toDateText_(row['週開始日']) === weekStart)
    .sort((a, b) => priorityScore_(b['実施優先度']) - priorityScore_(a['実施優先度']))
    .slice(0, 3);

  return {
    source: {
      spreadsheetId: SPREADSHEET_ID,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?usp=drivesdk`,
      updatedAt: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm JST'),
      updateCadence: '毎週火曜 15:00'
    },
    week: {
      start: weekStart,
      end: toDateText_(latestWeek['週終了日']),
      reportDate: toDateText_(latestWeek['集計日']),
      status: String(latestWeek['入力ステータス'] || '')
    },
    headline: String(latestWeek['勝ち要因'] || ''),
    decisions: splitActions_(latestWeek['次アクション']),
    kpis: [
      { label: '総視聴回数', value: Number(latestWeek['総視聴回数'] || 0), format: 'number', note: 'CSV合計行ベース' },
      { label: '総再生時間', value: Number(latestWeek['総再生時間（時間）'] || 0), format: 'hours', note: '長尺が牽引' },
      { label: '平均視聴時間', value: String(latestWeek['平均視聴時間'] || ''), format: 'text', note: '週次平均' },
      { label: '登録者増加数', value: Number(latestWeek['登録者増加数'] || 0), format: 'number', note: '全体合計' },
      { label: 'ユニーク視聴者', value: Number(latestWeek['ユニーク視聴者数'] || 0), format: 'number', note: '合計行を正として採用' },
      { label: 'インプレッション', value: Number(latestWeek['インプレッション数'] || 0), format: 'number', note: `CTR ${latestWeek['インプレッションCTR'] || ''}%` },
      { label: '高評価数', value: Number(latestWeek['高評価数'] || 0), format: 'number', note: '熱量の基礎値' },
      { label: 'コメント追加', value: Number(latestWeek['コメント追加回数'] || 0), format: 'number', note: '会話量の基礎値' }
    ],
    dailyUnique: [],
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
      { label: '勝ち要因', text: String(latestWeek['勝ち要因'] || '') },
      { label: '課題', text: String(latestWeek['課題'] || '') },
      { label: '第三者目線', text: 'ライト層は企画のわかりやすさ、古参ファンは関係性と成長過程、一般視聴者は一瞬で伝わる感情フックで反応しやすい。' }
    ],
    actions: splitActions_(latestWeek['次アクション']),
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

function rowsByHeader_(sheet, headerRow) {
  const values = sheet.getDataRange().getValues();
  const headers = values[headerRow - 1];
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
  const match = text.match(/[?&]v=([^&]+)/);
  return match ? match[1] : '';
}

function priorityScore_(value) {
  if (value === '高') return 3;
  if (value === '中') return 2;
  if (value === '低') return 1;
  return 0;
}
