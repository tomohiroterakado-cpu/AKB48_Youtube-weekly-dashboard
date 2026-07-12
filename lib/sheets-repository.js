const TABLES = {
  imports: { sheet: "AI_csv_imports", fields: ["id", "channel", "periodStart", "periodEnd", "fileName", "fileHash", "uploadedAt", "sourceRows", "importedRows", "newVideoCount", "updatedVideoCount", "skippedRows", "duplicateCount", "missingCounts", "unknownHeaders", "summary", "status", "error"] },
  videos: { sheet: "AI_videos", fields: ["videoId", "title", "publishedAt", "durationSeconds", "status", "format", "genre", "subgenre", "members", "guests", "tags", "collaboration", "titleAppeal", "targetAudience", "seasonalEvent", "productionCost", "shootingDifficulty", "notes", "thumbnailUrl", "createdAt", "updatedAt", "reviewedAt", "reviewedBy"] },
  metrics: { sheet: "AI_video_metrics", fields: ["id", "importId", "videoId", "periodStart", "periodEnd", "version", "current", "conflictPolicy", "values", "importedAt"] },
  classifications: { sheet: "AI_auto_classifications", fields: ["id", "videoId", "values", "createdAt", "model", "superseded"] },
  reviews: { sheet: "AI_classification_reviews", fields: ["id", "videoId", "field", "autoValue", "reviewedValue", "reviewedBy", "reviewedAt", "source"] },
  members: { sheet: "AI_members", fields: ["id", "name", "aliases", "active", "createdAt", "updatedAt"] },
  categories: { sheet: "AI_video_categories", fields: ["id", "name", "parentId", "active", "createdAt", "updatedAt"] }
};

const JSON_FIELDS = new Set(["missingCounts", "unknownHeaders", "summary", "members", "guests", "tags", "values", "aliases"]);
const BOOLEAN_FIELDS = new Set(["active", "current", "superseded"]);

function cellValue(value, field) {
  if (JSON_FIELDS.has(field)) return value === undefined || value === null ? "" : JSON.stringify(value);
  if (value === undefined || value === null) return "";
  return value;
}

function parseValue(value, field) {
  if (BOOLEAN_FIELDS.has(field)) return value === true || String(value).toLowerCase() === "true";
  if (!JSON_FIELDS.has(field)) return value;
  if (value === "" || value === undefined || value === null) return field === "values" || field === "summary" || field === "missingCounts" ? {} : [];
  try { return JSON.parse(value); } catch { return field === "values" ? {} : []; }
}

function primaryKey(table) {
  return table === "videos" ? "videoId" : "id";
}

class GoogleSheetsRepository {
  constructor({ spreadsheetId, accessToken, fetchImpl = fetch }) {
    if (!spreadsheetId) throw new Error("GOOGLE_SPREADSHEET_IDが必要です。");
    this.spreadsheetId = spreadsheetId;
    this.accessToken = accessToken || "";
    this.fetch = fetchImpl;
    this.schemaReady = false;
    this.rowIndexes = {};
    this.queue = Promise.resolve();
    this.cachedToken = "";
    this.tokenExpiresAt = 0;
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
    const token = await this.token();
    const response = await this.fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Google Sheets API ${response.status}: ${detail.slice(0, 500)}`);
    }
    return response.status === 204 ? null : response.json();
  }

  async ensureSchema() {
    if (this.schemaReady) return;
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}`;
    const metadata = await this.request(`${base}?fields=sheets.properties(title)`);
    const existing = new Set((metadata.sheets || []).map((item) => item.properties.title));
    const missing = Object.values(TABLES).filter((table) => !existing.has(table.sheet));
    if (missing.length) {
      await this.request(`${base}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ requests: missing.map((table) => ({ addSheet: { properties: { title: table.sheet, gridProperties: { frozenRowCount: 1 } } } })) })
      });
    }
    for (const table of Object.values(TABLES)) {
      if (!existing.has(table.sheet)) {
        await this.writeRange(`${table.sheet}!A1`, [table.fields]);
      }
    }
    this.schemaReady = true;
  }

  async readRange(range) {
    const encoded = encodeURIComponent(range);
    return this.request(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encoded}?majorDimension=ROWS`);
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

  async batchWriteRanges(data) {
    for (let index = 0; index < data.length; index += 200) {
      const chunk = data.slice(index, index + 200);
      await this.request(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "RAW", data: chunk.map((item) => ({ ...item, majorDimension: "ROWS" })) })
      });
    }
  }

  async read() {
    await this.ensureSchema();
    const state = { schemaVersion: 1, imports: [], videos: [], metrics: [], classifications: [], reviews: [], members: [], categories: [], settings: {} };
    this.rowIndexes = {};
    await Promise.all(Object.entries(TABLES).map(async ([name, table]) => {
      const result = await this.readRange(`${table.sheet}!A:Z`);
      const rows = result.values || [];
      const headers = rows[0] || table.fields;
      const key = primaryKey(name);
      this.rowIndexes[name] = new Map();
      state[name] = rows.slice(1).filter((row) => row.some((value) => value !== "")).map((row, index) => {
        const item = {};
        headers.forEach((field, column) => { if (field) item[field] = parseValue(row[column] ?? "", field); });
        if (item[key]) this.rowIndexes[name].set(String(item[key]), index + 2);
        return item;
      });
    }));
    return state;
  }

  async mutate(mutator) {
    const operation = this.queue.then(async () => {
      const before = await this.read();
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
      } catch (error) {
        throw new Error(`Sheetsへの保存が途中で中断されました。取込履歴を確認して同じCSVを再実行してください。詳細: ${error.message}`);
      }
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}

module.exports = { GoogleSheetsRepository, TABLES, cellValue, parseValue };
