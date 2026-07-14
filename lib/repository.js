const fs = require("node:fs/promises");
const path = require("node:path");

function emptyState() {
  return {
    schemaVersion: 1,
    imports: [],
    dailyImports: [],
    videos: [],
    metrics: [],
    dailyMetrics: [],
    classifications: [],
    reviews: [],
    members: [],
    categories: [],
    settings: {}
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MemoryRepository {
  constructor(initialState = emptyState()) {
    this.state = clone(initialState);
  }

  async read() {
    return clone(this.state);
  }

  async mutate(mutator) {
    const draft = clone(this.state);
    const result = await mutator(draft);
    this.state = draft;
    return result;
  }
}

class JsonRepository {
  constructor(filePath) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
  }

  async read() {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      return { ...emptyState(), ...JSON.parse(content) };
    } catch (error) {
      if (error.code === "ENOENT") return emptyState();
      throw error;
    }
  }

  async mutate(mutator) {
    const operation = this.queue.then(async () => {
      const draft = await this.read();
      const result = await mutator(draft);
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
      await fs.rename(temporary, this.filePath);
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}

module.exports = { JsonRepository, MemoryRepository, emptyState };
