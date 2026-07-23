const test = require("node:test");
const assert = require("node:assert/strict");
const { cellValue, GoogleSheetsRepository, parseValue, retryAfterMs, retryDelayMs, spreadsheetColumn, spreadsheetColumnNumber, TABLES } = require("../lib/sheets-repository");
const { emptyState } = require("../lib/repository");

test("nested values round-trip through a sheet cell", () => {
  const source = { views: 1200, tags: ["対決", "長尺"] };
  const stored = cellValue(source, "values");
  assert.equal(typeof stored, "string");
  assert.deepEqual(parseValue(stored, "values"), source);
});

test("missing arrays and objects keep their expected shape", () => {
  assert.deepEqual(parseValue("", "members"), []);
  assert.deepEqual(parseValue("", "summary"), {});
  assert.deepEqual(parseValue("", "data"), {});
});

test("boolean cells are restored as booleans", () => {
  assert.equal(parseValue("false", "current"), false);
  assert.equal(parseValue("TRUE", "superseded"), true);
});

test("unexpected list values are serialized before writing to Sheets", () => {
  assert.equal(cellValue(["2026-07-04", "2026-07-05"], "unmappedField"), '["2026-07-04","2026-07-05"]');
  assert.equal(cellValue({ note: "test" }, "unmappedField"), '{"note":"test"}');
});

test("schema migration can append a header after column Z", () => {
  assert.equal(spreadsheetColumn(1), "A");
  assert.equal(spreadsheetColumn(26), "Z");
  assert.equal(spreadsheetColumn(27), "AA");
  assert.equal(spreadsheetColumnNumber("AA"), 27);
});

test("サムネイル生成の重複防止履歴も専用シートへ保存する", () => {
  assert.equal(TABLES.thumbnailGenerations.sheet, "AI_thumbnail_generations");
  assert.deepEqual(TABLES.thumbnailGenerations.fields, ["id", "fingerprint", "createdAt", "expiresAt"]);
});

test("batch writes expand a legacy sheet before writing beyond its current grid", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("?fields=sheets.properties")) {
      return new Response(JSON.stringify({
        sheets: [{ properties: { sheetId: 7, title: "CSV_貼付用", gridProperties: { rowCount: 1000, columnCount: 20 } } }]
      }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const repository = new GoogleSheetsRepository({ spreadsheetId: "test", accessToken: "test", fetchImpl });
  await repository.batchWriteRanges([{ range: "CSV_貼付用!A1001", values: [Array(23).fill("value")] }]);
  const resize = calls.find((call) => call.url.endsWith(":batchUpdate"));
  const properties = JSON.parse(resize.options.body).requests[0].updateSheetProperties.properties.gridProperties;
  assert.deepEqual(properties, { rowCount: 1001, columnCount: 23 });
  assert.equal(calls.some((call) => call.url.includes("/values:batchUpdate")), true);
});

test("schema migration expands an existing sheet before adding a new field", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const decoded = decodeURIComponent(url);
    if (decoded.includes("values:batchGet")) {
      const ranges = new URL(url).searchParams.getAll("ranges");
      return new Response(JSON.stringify({
        valueRanges: ranges.map((range) => ({
          range,
          values: [range.includes("AI_videos!1:1") ? TABLES.videos.fields.slice(0, -1) : []]
        }))
      }), { status: 200 });
    }
    if (decoded.includes("?fields=sheets.properties")) {
      return new Response(JSON.stringify({
        sheets: Object.values(TABLES).map((table, index) => ({
          properties: {
            sheetId: index + 1,
            title: table.sheet,
            gridProperties: { columnCount: table.sheet === "AI_videos" ? 23 : table.fields.length }
          }
        }))
      }), { status: 200 });
    }
    if (decoded.includes("AI_videos!1:1")) {
      return new Response(JSON.stringify({ values: [TABLES.videos.fields.slice(0, -1)] }), { status: 200 });
    }
    if (decoded.includes("!1:1")) return new Response(JSON.stringify({ values: [[]] }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const repository = new GoogleSheetsRepository({ spreadsheetId: "test", accessToken: "test", fetchImpl });
  await repository.ensureSchema();
  const batchUpdate = calls.find((call) => call.url.includes(":batchUpdate") && JSON.parse(call.options.body).requests[0].updateSheetProperties);
  assert.equal(JSON.parse(batchUpdate.options.body).requests[0].updateSheetProperties.properties.gridProperties.columnCount, TABLES.videos.fields.length);
  assert.equal(calls.some((call) => decodeURIComponent(call.url).includes("AI_videos!X1")), true);
});

test("repository batches table reads into one Sheets request", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const decoded = decodeURIComponent(url);
    if (decoded.includes("?fields=sheets.properties")) {
      return new Response(JSON.stringify({
        sheets: Object.values(TABLES).map((table, index) => ({
          properties: { sheetId: index + 1, title: table.sheet, gridProperties: { columnCount: table.fields.length } }
        }))
      }), { status: 200 });
    }
    if (decoded.includes("values:batchGet")) {
      const ranges = new URL(url).searchParams.getAll("ranges");
      return new Response(JSON.stringify({
        valueRanges: ranges.map((range) => {
          const table = Object.values(TABLES).find((item) => range.startsWith(`${item.sheet}!`));
          return { range, values: [table?.fields || []] };
        })
      }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const repository = new GoogleSheetsRepository({ spreadsheetId: "test", accessToken: "test", fetchImpl });
  const state = await repository.read();
  const batchReads = calls.filter((call) => decodeURIComponent(call.url).includes("values:batchGet"));
  assert.equal(batchReads.length, 2);
  assert.equal(new URL(batchReads[1].url).searchParams.getAll("ranges").length, Object.keys(TABLES).length);
  assert.equal(state.imports.length, 0);
});

test("repository retries Sheets quota errors with exponential backoff", async () => {
  let requestCount = 0;
  const delays = [];
  const repository = new GoogleSheetsRepository({
    spreadsheetId: "test",
    accessToken: "test",
    sleep: async (milliseconds) => delays.push(milliseconds),
    random: () => 0,
    fetchImpl: async () => {
      requestCount += 1;
      if (requestCount < 3) {
        return new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), {
          status: 429,
          headers: { "retry-after": "0" }
        });
      }
      return new Response(JSON.stringify({ values: [["ok"]] }), { status: 200 });
    }
  });
  const result = await repository.readRange("Test!A1");
  assert.deepEqual(result.values, [["ok"]]);
  assert.equal(requestCount, 3);
  assert.deepEqual(delays, [60000, 60000]);
  assert.equal(retryAfterMs("3"), 3000);
  assert.equal(retryDelayMs(3, 10_000), 10_000);
  assert.equal(retryDelayMs(0, 0, 429, () => 0), 60000);
});

test("concurrent reads share one batch request and use the short cache", async () => {
  let batchReadCount = 0;
  const repository = new GoogleSheetsRepository({ spreadsheetId: "test", accessToken: "test" });
  repository.ensureSchema = async () => undefined;
  repository.readRanges = async (ranges) => {
    batchReadCount += 1;
    await Promise.resolve();
    return ranges.map(() => ({ values: [[]] }));
  };
  const [first, second] = await Promise.all([repository.read(), repository.read()]);
  await repository.read();
  assert.equal(batchReadCount, 1);
  assert.deepEqual(first, second);
});

test("append requests are not blindly retried after a transport failure", async () => {
  let requestCount = 0;
  const repository = new GoogleSheetsRepository({
    spreadsheetId: "test",
    accessToken: "test",
    sleep: async () => { throw new Error("should not wait"); },
    fetchImpl: async () => {
      requestCount += 1;
      throw new Error("connection closed after request");
    }
  });
  await assert.rejects(repository.appendRows("AI_videos", [["video_1"]]), /connection closed/);
  assert.equal(requestCount, 1);
});

test("a Sheets write stages imports as processing before completion", async () => {
  const repository = new GoogleSheetsRepository({ spreadsheetId: "test", accessToken: "test" });
  const state = emptyState();
  repository.read = async () => state;
  repository.rowIndexes = Object.fromEntries(Object.keys(TABLES).map((name) => [name, new Map()]));
  const writes = [];
  repository.batchWriteRanges = async (data) => {
    writes.push(data);
    if (writes.length === 2) throw new Error("finalize failed");
  };
  await assert.rejects(repository.mutate((draft) => {
    draft.imports.push({ id: "import_1", status: "completed" });
  }), /途中で中断/);
  const statusColumn = TABLES.imports.fields.indexOf("status");
  assert.equal(writes[0][0].values[0][statusColumn], "processing");
});
