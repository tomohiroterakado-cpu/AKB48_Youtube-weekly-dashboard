const test = require("node:test");
const assert = require("node:assert/strict");
const { cellValue, parseValue } = require("../lib/sheets-repository");

test("nested values round-trip through a sheet cell", () => {
  const source = { views: 1200, tags: ["対決", "長尺"] };
  const stored = cellValue(source, "values");
  assert.equal(typeof stored, "string");
  assert.deepEqual(parseValue(stored, "values"), source);
});

test("missing arrays and objects keep their expected shape", () => {
  assert.deepEqual(parseValue("", "members"), []);
  assert.deepEqual(parseValue("", "summary"), {});
});
