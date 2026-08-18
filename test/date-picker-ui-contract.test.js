const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const director = fs.readFileSync(path.join(root, "director.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");

test("CSV upload period dates provide explicit calendar controls", () => {
  ["periodStart", "periodEnd"].forEach((id) => {
    assert.match(index, new RegExp(`<input id="${id}" type="date" required>`));
    assert.match(index, new RegExp(`data-date-picker-for="${id}"`));
  });

  assert.match(director, /function openNativeDatePicker\(input\)/);
  assert.match(director, /input\.showPicker\(\)/);
  assert.match(director, /function setUpDatePickers\(\)/);
  assert.match(director, /setUpDatePickers\(\);/);
  assert.match(styles, /\.dateInputControl/);
});
