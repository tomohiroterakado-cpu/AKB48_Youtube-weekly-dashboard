const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const { JsonRepository } = require("./lib/repository");
const { GoogleSheetsRepository } = require("./lib/sheets-repository");
const { commitImport, commitWeeklyImport, previewImport, previewWeeklyImport } = require("./lib/import-service");
const { buildDirectorReport } = require("./lib/analysis");
const { buildWeeklyDashboardData } = require("./lib/weekly-dashboard-report");
const { syncLegacyWeeklyReport } = require("./lib/legacy-sheet-sync");
const { confirmVideos, reclassifyUnconfirmedVideos, updateVideoAttributes } = require("./lib/review-service");

const root = __dirname;
const port = Number(process.env.PORT || 8080);
const isProduction = process.env.NODE_ENV === "production";
const adminToken = process.env.ADMIN_ACCESS_TOKEN || "";
const dataBackend = process.env.DATA_BACKEND || (process.env.GOOGLE_SPREADSHEET_ID ? "sheets" : "json");
const repository = dataBackend === "sheets"
  ? new GoogleSheetsRepository({ spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID, accessToken: process.env.GOOGLE_ACCESS_TOKEN })
  : new JsonRepository(process.env.DATA_FILE || path.join(root, ".data", "director.json"));

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function resolvePath(urlPath) {
  const safePath = path.normalize(decodeURIComponent(urlPath.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const requested = safePath === "/" ? "/index.html" : safePath;
  return path.join(root, requested);
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) throw Object.assign(new Error("アップロード上限は12MBです。"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("リクエスト形式が正しくありません。"), { status: 400 }); }
}

function authorizeWrite(req) {
  if (!adminToken) throw Object.assign(new Error("管理用トークンが未設定のため、書込機能は停止中です。"), { status: 503 });
  if (req.headers["x-admin-token"] !== adminToken) throw Object.assign(new Error("管理用トークンが正しくありません。"), { status: 401 });
}

function latestClassification(state, videoId) {
  return state.classifications
    .filter((item) => item.videoId === videoId && !item.superseded)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") {
    return json(res, 200, { ok: true, backend: dataBackend, writeEnabled: Boolean(adminToken), version: "phase-1" });
  }
  if (req.method === "GET" && pathname === "/api/home") {
    const state = await repository.read();
    const latestImport = [...state.imports]
      .filter((item) => item.status !== "error" && item.status !== "processing")
      .sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))[0] || null;
    const latestDailyImport = [...(state.dailyImports || [])].sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))[0] || null;
    const unconfirmed = state.videos.filter((video) => video.status === "unconfirmed");
    return json(res, 200, {
      latestImport,
      latestDailyImport,
      importCount: state.imports.length,
      videoCount: state.videos.length,
      unconfirmedVideoCount: unconfirmed.length,
      lowConfidenceCount: unconfirmed.filter((video) => {
        const item = latestClassification(state, video.videoId);
        return item && Object.values(item.values || {}).some((value) => value && value.confidence !== undefined && value.confidence < 70);
      }).length,
      aiReportStatus: state.imports.length < 2 ? "データ不足のため判定不可" : "生成準備完了",
      warnings: state.imports.length < 4 ? ["現時点では統計的な信頼性が低い", "4週移動平均は十分な履歴が蓄積された後に利用可能"] : []
    });
  }
  if (req.method === "GET" && pathname === "/api/imports") {
    const state = await repository.read();
    return json(res, 200, { imports: [...state.imports].sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt))) });
  }
  if (req.method === "GET" && pathname === "/api/ai-director") {
    return json(res, 200, buildDirectorReport(await repository.read()));
  }
  if (req.method === "GET" && pathname === "/api/weekly-dashboard") {
    return json(res, 200, buildWeeklyDashboardData(await repository.read()));
  }
  if (req.method === "POST" && pathname === "/api/admin/session") {
    authorizeWrite(req);
    return json(res, 200, { ok: true, message: "管理モードを開始しました。" });
  }
  if (req.method === "POST" && pathname === "/api/imports/preview") {
    authorizeWrite(req);
    return json(res, 200, await previewImport(repository, await readJson(req)));
  }
  if (req.method === "POST" && pathname === "/api/imports/commit") {
    authorizeWrite(req);
    const body = await readJson(req);
    return json(res, 200, await commitImport(repository, body, { conflictPolicy: body.conflictPolicy || "version" }));
  }
  if (req.method === "POST" && pathname === "/api/weekly-imports/preview") {
    authorizeWrite(req);
    return json(res, 200, await previewWeeklyImport(repository, await readJson(req)));
  }
  if (req.method === "POST" && pathname === "/api/weekly-imports/commit") {
    authorizeWrite(req);
    const body = await readJson(req);
    const result = await commitWeeklyImport(repository, body, { conflictPolicy: body.conflictPolicy || "version" });
    try { result.legacySync = await syncLegacyWeeklyReport(repository, body); }
    catch (error) { result.legacySync = { error: error.message }; }
    return json(res, 200, result);
  }
  if (req.method === "POST" && pathname === "/api/weekly-imports/sync-legacy") {
    authorizeWrite(req);
    return json(res, 200, await syncLegacyWeeklyReport(repository, await readJson(req)));
  }
  if (req.method === "GET" && pathname === "/api/videos") {
    const state = await repository.read();
    const status = new URL(req.url, "http://localhost").searchParams.get("status");
    const videos = state.videos
      .filter((video) => !status || video.status === status)
      .map((video) => ({ ...video, classification: latestClassification(state, video.videoId)?.values || null }));
    return json(res, 200, { videos, members: state.members, categories: state.categories });
  }
  if (req.method === "POST" && pathname === "/api/videos/confirm") {
    authorizeWrite(req);
    const body = await readJson(req);
    const result = await repository.mutate((state) => confirmVideos(state, body));
    return json(res, 200, result);
  }
  if (req.method === "POST" && pathname === "/api/videos/reclassify") {
    authorizeWrite(req);
    const body = await readJson(req);
    const result = await repository.mutate((state) => reclassifyUnconfirmedVideos(state, body.videoIds));
    return json(res, 200, result);
  }
  if (req.method === "POST" && pathname === "/api/videos/attributes") {
    authorizeWrite(req);
    const body = await readJson(req);
    const result = await repository.mutate((state) => updateVideoAttributes(state, body));
    return json(res, 200, result);
  }
  if (req.method === "POST" && (pathname === "/api/members" || pathname === "/api/categories")) {
    authorizeWrite(req);
    const body = await readJson(req);
    const target = pathname === "/api/members" ? "members" : "categories";
    const now = new Date().toISOString();
    const result = await repository.mutate((state) => {
      const name = String(body.name || "").trim();
      if (!name) throw Object.assign(new Error("名前を入力してください。"), { status: 400 });
      if (state[target].some((item) => item.name === name)) return { status: "exists" };
      const item = { id: `${target.slice(0, -1)}_${Date.now()}`, name, active: true, createdAt: now, updatedAt: now };
      if (target === "members") item.aliases = body.aliases || [];
      else item.parentId = body.parentId || "";
      state[target].push(item);
      return { status: "created", item };
    });
    return json(res, 201, result);
  }
  return json(res, 404, { error: "APIが見つかりません。" });
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname);
    const filePath = resolvePath(req.url || "/");

    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }

      const ext = path.extname(filePath);
      // 管理画面のJS/CSSが古いまま残ると、CSV取込画面の更新を誤認しやすい。
      const cacheControl = [".html", ".css", ".js"].includes(ext)
        ? "no-cache"
        : "public, max-age=300";

      res.writeHead(200, {
        "Content-Type": types[ext] || "application/octet-stream",
        "Cache-Control": cacheControl,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Security-Policy": "default-src 'self'; img-src 'self' https://img.youtube.com data:; script-src 'self' https://script.google.com https://script.googleusercontent.com; connect-src 'self' https://script.google.com https://script.googleusercontent.com; style-src 'self'; frame-ancestors 'self'"
      });
      res.end(content);
    });
  } catch (error) {
    console.error(error);
    json(res, error.status || 500, { error: error.message || "サーバーエラーが発生しました。" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`AKB weekly dashboard listening on ${port}`);
});
