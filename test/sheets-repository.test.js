const test = require("node:test");
const assert = require("node:assert/strict");
const { cellValue, GoogleSheetsRepository, parseValue, spreadsheetColumn, TABLES } = require("../lib/sheets-repository");
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
});

test("schema migration expands an existing sheet before adding a new field", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const decoded = decodeURIComponent(url);
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
