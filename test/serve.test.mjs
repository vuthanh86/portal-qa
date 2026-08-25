/**
 * test/serve.test.mjs — boots `qa serve` on an ephemeral port and exercises the HTTP API.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { once as onceEvent } from "node:events";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const bin = join(packageRoot, "bin", "qa.mjs");

async function startServer(extraArgs = [], extraEnv = {}) {
	const port = 40000 + Math.floor(Math.random() * 5000);
	const child = spawn(process.execPath, [bin, "serve", "--port", String(port), "--host", "127.0.0.1"], {
		stdio: ["ignore", "pipe", "pipe"],
		cwd: packageRoot,
		env: { ...process.env, ...extraEnv }
	});
	// Wait for the "qa serve: http://..." line on stdout.
	await new Promise((resolve, reject) => {
		let buf = "";
		const t = setTimeout(() => reject(new Error("server did not start in 5s: " + buf)), 5000);
		child.stdout.on("data", (chunk) => {
			buf += chunk.toString();
			if (buf.includes("qa serve:")) { clearTimeout(t); resolve(); }
		});
		child.stderr.on("data", (c) => (buf += c.toString()));
		child.once("exit", (code) => reject(new Error(`server exited early code=${code}: ${buf}`)));
	});
	return { child, port, stop: () => new Promise((r) => { child.once("exit", () => r()); child.kill("SIGTERM"); }) };
}

test("GET /health returns { ok: true, version }", async (t) => {
	const s = await startServer();
	t.after(() => s.stop());
	const res = await fetch(`http://127.0.0.1:${s.port}/health`);
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.equal(body.ok, true);
	assert.match(body.version, /^\d+\.\d+\.\d+$/);
});

test("POST /render with runDir returns totals and writes summary.html", async (t) => {
	// runDir must resolve inside DSH_RUNS_DIR now that /render rejects paths outside it.
	const s = await startServer([], { DSH_RUNS_DIR: packageRoot });
	t.after(() => s.stop());
	const res = await fetch(`http://127.0.0.1:${s.port}/render`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ runDir: join(packageRoot, "demo") })
	});
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.equal(body.ok, true);
	assert.match(body.summaryPath, /summary\.html$/);
});

test("POST /render with runDir outside DSH_RUNS_DIR is rejected", async (t) => {
	const s = await startServer([], { DSH_RUNS_DIR: join(packageRoot, "demo") });
	t.after(() => s.stop());
	const res = await fetch(`http://127.0.0.1:${s.port}/render`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ runDir: packageRoot })
	});
	assert.equal(res.status, 400);
	const body = await res.json();
	assert.equal(body.ok, false);
});

test("GET /render with missing runDir returns 400", async (t) => {
	const s = await startServer();
	t.after(() => s.stop());
	const res = await fetch(`http://127.0.0.1:${s.port}/render`);
	assert.equal(res.status, 400);
	const body = await res.json();
	assert.equal(body.ok, false);
});