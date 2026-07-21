const TABLES = {
  imports: { sheet: "AI_csv_imports", fields: ["id", "channel", "periodStart", "periodEnd", "fileName", "fileHash", "uploadedAt", "sourceRows", "importedRows", "newVideoCount", "updatedVideoCount", "skippedRows", "duplicateCount", "missingCounts", "unknownHeaders", "summary", "status", "error"] },
  dailyImports: { sheet: "AI_daily_csv_imports", fields: ["id", "contentImportId", "channel", "periodStart", "periodEnd", "fileName", "fileHash", "uploadedAt", "sourceRows", "importedRows", "skippedRows", "duplicateCount", "missingDates", "missingMetricColumns", "unknownHeaders", "status", "error"] },
  videos: { sheet: "AI_videos", fields: ["videoId", "title", "publishedAt", "durationSeconds", "status", "format", "genre", "subgenre", "members", "guests", "tags", "collaboration", "titleAppeal", "targetAudience", "seasonalEvent", "productionCost", "shootingDifficulty", "notes", "thumbnailUrl", "createdAt", "updatedAt", "reviewedAt", "reviewedBy", "visibility"] },
  metrics: { sheet: "AI_video_metrics", fields: ["id", "importId", "videoId", "periodStart", "periodEnd", "version", "current", "conflictPolicy", "values", "importedAt"] },
  dailyMetrics: { sheet: "AI_daily_metrics", fields: ["id", "importId", "periodStart", "periodEnd", "date", "version", "current", "conflictPolicy", "values", "importedAt"] },
  classifications: { sheet: "AI_auto_classifications", fields: ["id", "videoId", "values", "createdAt", "model", "superseded"] },
  reviews: { sheet: "AI_classification_reviews", fields: ["id", "videoId", "field", "autoValue", "reviewedValue", "reviewedBy", "reviewedAt", "source"] },
  members: { sheet: "AI_members", fields: ["id", "name", "aliases", "active", "createdAt", "updatedAt"] },
  categories: { sheet: "AI_video_categories", fields: ["id", "name", "parentId", "active", "createdAt", "updatedAt"] },
  marketReports: { sheet: "AI_market_reports", fields: ["id", "periodStart", "periodEnd", "source", "subject", "receivedAt", "status", "contentHash", "data", "createdAt", "updatedAt"] }
};

const JSON_FIELDS = new Set(["missingCounts", "missingDates", "missingMetricColumns", "unknownHeaders", "summary", "members", "guests", "tags", "values", "aliases", "data"]);
const BOOLEAN_FIELDS = new Set(["active", "current", "superseded"]);
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_REQUEST_RETRIES = 2;
const READ_CACHE_MS = 5_000;

function cellValue(value, field) {
  if (JSON_FIELDS.has(field)) return value === undefined || value === null ? "" : JSON.stringify(value);
  if (value === undefined || value === null) return "";
  // Sheets APIのセルには配列・オブジェクトを直接渡せないため、想定外の構造も安全に文字列化する。
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function parseValue(value, field) {
  if (BOOLEAN_FIELDS.has(field)) return value === true || String(value).toLowerCase() === "true";
  if (!JSON_FIELDS.has(field)) return value;
  if (value === "" || value === undefined || value === null) return field === "values" || field === "summary" || field === "missingCounts" || field === "data" ? {} : [];
  try { return JSON.parse(value); } catch { return field === "values" || field === "data" ? {} : []; }
}

function primaryKey(table) {
  return table === "videos" ? "videoId" : "id";
}

function spreadsheetColumn(columnNumber) {
  let value = Number(columnNumber || 1);
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result || "A";
}

function spreadsheetColumnNumber(columnName) {
  return String(columnName || "A").toUpperCase().split("").reduce((total, character) => {
    const value = character.charCodeAt(0) - 64;
    return value >= 1 && value <= 26 ? total * 26 + value : total;
  }, 0);
}

function gridRequirement(write) {
  const match = String(write?.range || "").match(/^(.+)!([A-Z]+)(\d+)$/);
  if (!match) return null;
  const values = Array.isArray(write.values) ? write.values : [];
  const width = Math.max(1, ...values.map((row) => Array.isArray(row) ? row.length : 0));
  return {
    sheet: match[1],
    rows: Number(match[3]) + Math.max(0, values.length - 1),
    columns: spreadsheetColumnNumber(match[2]) + width - 1
  };
}

function retryAfterMs(value) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(String(value || ""));
  return Number.isNaN(date) ? 0 : Math.max(0, date - Date.now());
}

function retryDelayMs(attempt, retryAfter = 0, status = 0, random = Math.random) {
  const exponential = Math.min(24_000, 1_000 * (2 ** attempt));
  const quotaWindow = status === 429 && retryAfter === 0 ? 60_000 : 0;
  const jitter = status === 429 ? Math.round(random() * 1_000) : 0;
  return Math.max(exponential, retryAfter, quotaWindow) + jitter;
}

function canRetryRequest(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  return method === "GET" || method === "PUT" || url.includes("/values:batchUpdate") || options.retrySafe === true;
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

class GoogleSheetsRepository {
  constructor({ spreadsheetId, accessToken, fetchImpl = fetch, sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)), now = () => Date.now(), random = Math.random }) {
    if (!spreadsheetId) throw new Error("GOOGLE_SPREADSHEET_IDが必要です。");
    this.spreadsheetId = spreadsheetId;
    this.accessToken = accessToken || "";
    this.fetch = fetchImpl;
    this.schemaReady = false;
    this.rowIndexes = {};
    this.queue = Promise.resolve();
    this.cachedToken = "";
    this.tokenExpiresAt = 0;
    this.sleep = sleep;
    this.now = now;
    this.random = random;
    this.schemaPromise = null;
    this.readPromise = null;
    this.stateCache = null;
    this.sheetGrid = new Map();
  }

  async token() {
    if (this.accessToken) return this.accessToken;
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) return this.cachedToken;
    const response = await this.fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
      headers: { "Metadata-Flavor": "Google" }
    });
    if (!response.ok) throw new Error(`Cloud Run認証情報を取得できません (${response.status})`);
    const payload = await response.json();
    this.cachedToken = payload.access_token;
    this.tokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in || 300) - 60) * 1000;
    return this.cachedToken;
  }

  async request(url, options = {}) {
    const retryable = canRetryRequest(url, options);
    for (let attempt = 0; ; attempt += 1) {
      let response;
      try {
        const token = await this.token();
        response = await this.fetch(url, {
          ...options,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...(options.headers || {})
          }
        });
      } catch (error) {
        if (retryable && attempt < MAX_REQUEST_RETRIES) {
          await this.sleep(retryDelayMs(attempt, 0, 0, this.random));
          continue;
        }
        throw error;
      }
      if (response.ok) return response.status === 204 ? null : response.json();

      const detail = await response.text();
      if (retryable && RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_REQUEST_RETRIES) {
        await this.sleep(retryDelayMs(attempt, retryAfterMs(response.headers.get("retry-after")), response.status, this.random));
        continue;
      }
      throw new Error(`Google Sheets API ${response.status}: ${detail.slice(0, 500)}`);
    }
  }

  async ensureSchema() {
    if (this.schemaReady) return;
    if (this.schemaPromise) return this.schemaPromise;
    this.schemaPromise = this.ensureSchemaNow();
    try {
      await this.schemaPromise;
    } finally {
      this.schemaPromise = null;
    }
  }

  async ensureSchemaNow() {
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}`;
    const metadata = await this.request(`${base}?fields=sheets.properties(sheetId,title,gridProperties.columnCount)`);
    const existingByTitle = new Map((metadata.sheets || []).map((item) => [item.properties.title, item.properties]));
    const missing = Object.values(TABLES).filter((table) => !existingByTitle.has(table.sheet));
    if (missing.length) {
      await this.request(`${base}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ requests: missing.map((table) => ({ addSheet: { properties: { title: table.sheet, gridProperties: { frozenRowCount: 1 } } } })) })
      });
    }
    const resizeRequests = Object.values(TABLES)
      .map((table) => ({ table, properties: existingByTitle.get(table.sheet) }))
      .filter(({ properties, table }) => properties && Number(properties.gridProperties?.columnCount || 0) < table.fields.length)
      .map(({ properties, table }) => ({
        updateSheetProperties: {
          properties: { sheetId: properties.sheetId, gridProperties: { columnCount: table.fields.length } },
          fields: "gridProperties.columnCount"
        }
      }));
    if (resizeRequests.length) {
      await this.request(`${base}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: resizeRequests }) });
    }
    const existingTables = Object.values(TABLES).filter((table) => existingByTitle.has(table.sheet));
    const headerRows = await this.readRanges(existingTables.map((table) => `${table.sheet}!1:1`));
    for (const [index, table] of existingTables.entries()) {
      const headerRow = headerRows[index] || {};
      const headers = headerRow.values?.[0] || [];
      const missingFields = table.fields.filter((field) => !headers.includes(field));
      if (missingFields.length) await this.writeRange(`${table.sheet}!${spreadsheetColumn(headers.length + 1)}1`, [missingFields]);
    }
    for (const table of Object.values(TABLES).filter((item) => !existingByTitle.has(item.sheet))) await this.writeRange(`${table.sheet}!A1`, [table.fields]);
    this.schemaReady = true;
  }

  async readRange(range) {
    const encoded = encodeURIComponent(range);
    return this.request(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encoded}?majorDimension=ROWS`);
  }

  async readRanges(ranges) {
    if (!ranges.length) return [];
    const query = new URLSearchParams({ majorDimension: "ROWS" });
    ranges.forEach((range) => query.append("ranges", range));
    const result = await this.request(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values:batchGet?${query.toString()}`);
    return result.valueRanges || ranges.map(() => ({}));
  }

  async writeRange(range, values) {
    const encoded = encodeURIComponent(range);
    return this.request(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encoded}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ range, majorDimension: "ROWS", values })
    });
  }

  async appendRows(sheet, values) {
    if (!values.length) return;
    const encoded = encodeURIComponent(`${sheet}!A:Z`);
    await this.request(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encoded}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: "POST",
      body: JSON.stringify({ majorDimension: "ROWS", values })
    });
  }

  async ensureGridForRanges(data) {
    const requiredBySheet = new Map();
    data.map(gridRequirement).filter(Boolean).forEach((required) => {
      const previous = requiredBySheet.get(required.sheet) || { rows: 0, columns: 0 };
      requiredBySheet.set(required.sheet, {
        rows: Math.max(previous.rows, required.rows),
        columns: Math.max(previous.columns, required.columns)
      });
    });

    const needsCheck = [...requiredBySheet.entries()].some(([sheet, required]) => {
      const current = this.sheetGrid.get(sheet);
      return !current || current.rows < required.rows || current.columns < required.columns;
    });
    if (!needsCheck) return;

    const base = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}`;
    const metadata = await this.request(`${base}?fields=sheets.properties(sheetId,title,gridProperties.rowCount,gridProperties.columnCount)`);
    (metadata.sheets || []).forEach((item) => {
      const properties = item.properties || {};
      this.sheetGrid.set(properties.title, {
        sheetId: properties.sheetId,
        rows: Number(properties.gridProperties?.rowCount || 0),
        columns: Number(properties.gridProperties?.columnCount || 0)
      });
    });

    const requests = [...requiredBySheet.entries()].flatMap(([sheet, required]) => {
      const current = this.sheetGrid.get(sheet);
      if (!current) return [];
      const rows = Math.max(current.rows, required.rows);
      const columns = Math.max(current.columns, required.columns);
      if (rows === current.rows && columns === current.columns) return [];
      this.sheetGrid.set(sheet, { ...current, rows, columns });
      return [{
        updateSheetProperties: {
          properties: { sheetId: current.sheetId, gridProperties: { rowCount: rows, columnCount: columns } },
          fields: "gridProperties.rowCount,gridProperties.columnCount"
        }
      }];
    });
    if (requests.length) {
      await this.request(`${base}:batchUpdate`, {
        method: "POST",
        retrySafe: true,
        body: JSON.stringify({ requests })
      });
    }
  }

  async batchWriteRanges(data) {
    for (let index = 0; index < data.length; index += 200) {
      const chunk = data.slice(index, index + 200);
      await this.ensureGridForRanges(chunk);
      await this.request(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "RAW", data: chunk.map((item) => ({ ...item, majorDimension: "ROWS" })) })
      });
    }
  }

  async read({ fresh = false, trackRowIndexes = false } = {}) {
    if (!fresh && this.stateCache && this.now() < this.stateCache.expiresAt) return cloneState(this.stateCache.state);
    if (!fresh && this.readPromise) return cloneState(await this.readPromise);
    const operation = this.readFresh({ trackRowIndexes });
    if (!fresh) this.readPromise = operation;
    try {
      const state = await operation;
      if (!fresh) this.stateCache = { state: cloneState(state), expiresAt: this.now() + READ_CACHE_MS };
      return cloneState(state);
    } finally {
      if (this.readPromise === operation) this.readPromise = null;
    }
  }

  async readFresh({ trackRowIndexes = false } = {}) {
    await this.ensureSchema();
    const state = { schemaVersion: 1, imports: [], dailyImports: [], videos: [], metrics: [], dailyMetrics: [], classifications: [], reviews: [], members: [], categories: [], marketReports: [], settings: {} };
    const rowIndexes = {};
    const entries = Object.entries(TABLES);
    const tableRows = await this.readRanges(entries.map(([, table]) => `${table.sheet}!A:Z`));
    entries.forEach(([name, table], index) => {
      const result = tableRows[index] || {};
      const rows = result.values || [];
      const headers = rows[0] || table.fields;
      const key = primaryKey(name);
      rowIndexes[name] = new Map();
      state[name] = rows.slice(1).filter((row) => row.some((value) => value !== "")).map((row, index) => {
        const item = {};
        headers.forEach((field, column) => { if (field) item[field] = parseValue(row[column] ?? "", field); });
        if (item[key]) rowIndexes[name].set(String(item[key]), index + 2);
        return item;
      });
    });
    if (trackRowIndexes) this.rowIndexes = rowIndexes;
    return state;
  }

  async mutate(mutator) {
    const operation = this.queue.then(async () => {
      const before = await this.read({ fresh: true, trackRowIndexes: true });
      const draft = JSON.parse(JSON.stringify(before));
      const result = await mutator(draft);
      const completionTargets = draft.imports
        .filter((item) => item.status === "completed")
        .filter((item) => {
          const previous = before.imports.find((candidate) => candidate.id === item.id);
          return !previous || previous.status !== "completed";
        })
        .map((item) => ({ id: item.id, finalRow: TABLES.imports.fields.map((field) => cellValue(item[field], field)) }));

      // Google Sheetsには複数表にまたがるトランザクションがない。完了状態は全行書込み後にだけ付ける。
      completionTargets.forEach((target) => {
        const item = draft.imports.find((candidate) => candidate.id === target.id);
        item.status = "processing";
      });
      const updates = [];
      const additionsByTable = [];
      const completionRows = new Map();
      for (const [name, table] of Object.entries(TABLES)) {
        const key = primaryKey(name);
        const beforeById = new Map(before[name].map((item) => [String(item[key]), item]));
        const additions = [];
        for (const item of draft[name]) {
          const itemKey = String(item[key] || "");
          const previous = beforeById.get(itemKey);
          const row = table.fields.map((field) => cellValue(item[field], field));
          if (!previous) additions.push(row);
          else if (JSON.stringify(previous) !== JSON.stringify(item)) {
            const rowNumber = this.rowIndexes[name].get(itemKey);
            updates.push({ range: `${table.sheet}!A${rowNumber}`, values: [row] });
          }
        }
        if (additions.length) {
          const existingRows = [...this.rowIndexes[name].values()];
          const firstRow = Math.max(1, ...existingRows) + 1;
          additionsByTable.push({ range: `${table.sheet}!A${firstRow}`, values: additions });
          if (name === "imports") additions.forEach((row, index) => completionRows.set(String(row[0]), firstRow + index));
        }
      }
      const orderedWrites = [...additionsByTable.filter((item) => item.range.startsWith("AI_csv_imports!")), ...updates, ...additionsByTable.filter((item) => !item.range.startsWith("AI_csv_imports!"))];
      try {
        await this.batchWriteRanges(orderedWrites);
        const completionWrites = completionTargets.map((target) => {
          const rowNumber = completionRows.get(target.id) || this.rowIndexes.imports.get(target.id);
          return { range: `${TABLES.imports.sheet}!A${rowNumber}`, values: [target.finalRow] };
        }).filter((item) => item.range !== `${TABLES.imports.sheet}!Aundefined`);
        await this.batchWriteRanges(completionWrites);
        this.stateCache = null;
      } catch (error) {
        throw new Error(`Sheetsへの保存が途中で中断されました。取込履歴を確認して同じCSVを再実行してください。詳細: ${error.message}`);
      }
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}

module.exports = { GoogleSheetsRepository, TABLES, cellValue, parseValue, retryDelayMs, retryAfterMs, spreadsheetColumn, spreadsheetColumnNumber };
