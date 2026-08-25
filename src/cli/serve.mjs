/**
 * src/cli/serve.mjs — `qa serve [--port 4173] [--host 127.0.0.1]` subcommand.
 *
 * Zero-dep HTTP server for in-pipeline inspection.
 *
 *   GET  /health                  → { ok, version }
 *   GET  /render?runDir=<path>    → renders <runDir>/summary.html, returns totals
 *   POST /render  { runDir }      → same, body-driven
 *   GET  /                        → lists run dirs under DSH_RUNS_DIR
 */
import { createServer } from "node:http";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..", "..");
const rendererPath = join(packageRoot, "src", "renderer", "render-qa-summary.mjs");
const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

function parseArgs(args) {
	const out = { port: 4173, host: "127.0.0.1" };
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--port" || a === "-p") out.port = Number(args[++i]) || out.port;
		else if (a === "--host" || a === "-H") out.host = String(args[++i] || out.host);
		else if (a === "--help" || a === "-h") {
			process.stdout.write("qa serve [--port 4173] [--host 127.0.0.1]\n");
			process.exit(0);
		}
	}
	return out;
}

function send(res, status, body, contentType = "application/json") {
	res.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
	res.end(typeof body === "string" ? body : JSON.stringify(body, null, 2));
}

function runsRoot() {
	return process.env.DSH_RUNS_DIR || join(process.env.HOME || process.env.USERPROFILE || ".", ".dsh", "runs");
}

function resolveRunDir(runDir) {
	const root = resolve(runsRoot());
	const resolved = resolve(root, runDir);
	if (resolved !== root && !resolved.startsWith(root + sep)) return null;
	return resolved;
}

function renderSummary(runDir) {
	if (!runDir) return { ok: false, error: "missing runDir" };
	const safeDir = resolveRunDir(runDir);
	if (!safeDir) return { ok: false, error: "runDir must be inside DSH_RUNS_DIR" };
	const r = spawnSync(process.execPath, [rendererPath, safeDir], { encoding: "utf8" });
	if (r.status !== 0) return { ok: false, error: (r.stderr || r.stdout || "").trim() };
	const last = (r.stdout || "").trim().split("\n").pop();
	return { ok: true, runDir: safeDir, summaryPath: join(safeDir, "summary.html"), log: last };
}

function listRunDirs() {
	const root = runsRoot();
	if (!existsSync(root)) return [];
	try {
		return readdirSync(root)
			.map((name) => ({ name, path: join(root, name) }))
			.filter((d) => { try { return statSync(d.path).isDirectory(); } catch { return false; } });
	} catch { return []; }
}

function indexHtml() {
	const dirs = listRunDirs();
	const list = dirs.map((d) => `<li><a href="/render?runDir=${encodeURIComponent(d.path)}">${d.name}</a></li>`).join("");
	return `<!doctype html><html><head><meta charset="utf-8"><title>qa serve</title></head>
<body style="font:14px -apple-system,Segoe UI,Roboto,sans-serif;margin:24px">
<h1>qa serve — ${pkg.name}@${pkg.version}</h1>
<p>GET <code>/health</code> · GET/POST <code>/render</code></p>
<h2>Run dirs (DSH_RUNS_DIR)</h2>
<ul>${list || "<li><i>none — set DSH_RUNS_DIR or create ~/.dsh/runs/</i></li>"}</ul>
</body></html>`;
}

export function run(args) {
	const opts = parseArgs(args);
	const server = createServer((req, res) => {
		const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

		if (req.method === "GET" && url.pathname === "/health") {
			return send(res, 200, { ok: true, version: pkg.version, name: pkg.name });
		}

		if (req.method === "GET" && url.pathname === "/") {
			return send(res, 200, indexHtml(), "text/html; charset=utf-8");
		}

		if (url.pathname === "/render") {
			if (req.method === "GET") {
				const out = renderSummary(url.searchParams.get("runDir"));
				return send(res, out.ok ? 200 : 400, out);
			}
			if (req.method === "POST") {
				let body = "";
				req.on("data", (c) => (body += c));
				req.on("end", () => {
					let payload = {};
					try { payload = body ? JSON.parse(body) : {}; } catch { return send(res, 400, { ok: false, error: "invalid JSON body" }); }
					const out = renderSummary(payload.runDir);
					return send(res, out.ok ? 200 : 400, out);
				});
				return;
			}
			res.writeHead(405, { allow: "GET, POST" });
			return res.end();
		}

		send(res, 404, { ok: false, error: "not found", path: url.pathname });
	});

	server.listen(opts.port, opts.host, () => {
		process.stdout.write(`qa serve: http://${opts.host}:${opts.port}  (${pkg.name}@${pkg.version})\n`);
	});

	const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1000).unref(); };
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
	// Run-forever until killed. The dispatcher will not call process.exit here.
	return undefined;
}