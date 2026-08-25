/**
 * src/cli/verify.mjs — `qa verify [--dir <demo-dir>]` subcommand.
 *
 * Self-test that the renderer produces every required marker.
 * Used by `npm test`, the release workflow, and the Azure DevOps wrapper.
 *
 * Default demo dir: <package>/demo (resolved relative to package.json).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..", "..");
const rendererPath = join(packageRoot, "src", "renderer", "render-qa-summary.mjs");
const defaultDemoDir = join(packageRoot, "demo");

function parseArgs(args) {
	const out = { dir: defaultDemoDir, nodeCheck: false };
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--dir" || a === "-d") out.dir = args[++i] || out.dir;
		else if (a === "--node-check") out.nodeCheck = true;
		else if (a === "--help" || a === "-h") {
			process.stdout.write("qa verify [--dir <demo-dir>] [--node-check]\n");
			process.exit(0);
		}
	}
	return out;
}

function render(dir) {
	const r = spawnSync(process.execPath, [rendererPath, dir], { encoding: "utf8" });
	if (r.status !== 0) {
		process.stderr.write(r.stderr || r.stdout || "");
		throw new Error(`renderer exited ${r.status}`);
	}
}

function grepAll(html, needles) {
	const results = {};
	for (const [name, needle] of Object.entries(needles)) results[name] = html.includes(needle);
	return results;
}

export function run(args) {
	const opts = parseArgs(args);
	const summaryPath = join(opts.dir, "summary.html");

	if (opts.nodeCheck) {
		const r = spawnSync(process.execPath, ["--check", rendererPath], { encoding: "utf8" });
		if (r.status !== 0) { process.stderr.write(r.stderr); return r.status || 1; }
	}

	// 1. Render without trend.json → sparkline must be absent.
	if (existsSync(summaryPath)) rmSync(summaryPath);
	render(opts.dir);
	if (!existsSync(summaryPath)) throw new Error(`renderer did not write ${summaryPath}`);
	let html = readFileSync(summaryPath, "utf8");

	const baseline = grepAll(html, {
		"P0</h2>":             "P0</h2>",
		"a11y_chip":           "chip a11y",
		"slow_chip":           "chip slow",
		"Copy_defect":         "Copy defect",
		"lightbox_id":         'id="lightbox"',
		"page_load_line":      "Page load:",
		"a11y_audit_line":     "a11y audit:",
		"sparkline_absent":    '<svg width="120"'
	});

	// 2. With temp trend.json (3 points) → sparkline present.
	//    The renderer reads <homedir>/.dsh/qa-memory/trend.json — write there
	//    and clean up so we don't pollute real memory.
	const home = process.env.HOME || process.env.USERPROFILE || ".";
	const mem = join(home, ".dsh", "qa-memory");
	const trendPath = join(mem, "trend.json");
	const hadTrend = existsSync(trendPath);
	const backup = hadTrend ? readFileSync(trendPath, "utf8") : null;
	mkdirSync(mem, { recursive: true });
	writeFileSync(trendPath, JSON.stringify({
		points: [
			{ date: "2026-08-18", passRate: 70 },
			{ date: "2026-08-19", passRate: 83 },
			{ date: "2026-08-20", passRate: 60 }
		]
	}));
	try {
		render(opts.dir);
	} finally {
		if (hadTrend) writeFileSync(trendPath, backup, "utf8");
		else rmSync(trendPath, { force: true });
	}
	html = readFileSync(summaryPath, "utf8");
	const withTrend = grepAll(html, { "sparkline_present": '<svg width="120"', "polyline": "<polyline" });

	// 3. Re-render with no trend.json → sparkline gone again.
	render(opts.dir);
	html = readFileSync(summaryPath, "utf8");
	const afterDelete = grepAll(html, { "sparkline_absent_again": '<svg width="120"' });

	// Report
	const rows = [
		["baseline   P0</h2>           ", baseline["P0</h2>"],           true],
		["baseline   a11y_chip          ", baseline["a11y_chip"],          true],
		["baseline   slow_chip          ", baseline["slow_chip"],          true],
		["baseline   Copy_defect        ", baseline["Copy_defect"],        true],
		["baseline   lightbox_id        ", baseline["lightbox_id"],        true],
		["baseline   page_load_line     ", baseline["page_load_line"],     true],
		["baseline   a11y_audit_line      ", baseline["a11y_audit_line"],     true],
		["baseline   sparkline_absent   ", baseline["sparkline_absent"],   false],
		["with-trend sparkline_present  ", withTrend["sparkline_present"], true],
		["with-trend polyline           ", withTrend["polyline"],           true],
		["no-trend   sparkline_absent   ", afterDelete["sparkline_absent_again"], false]
	];
	let ok = true;
	for (const [label, got, want] of rows) {
		const pass = got === want;
		if (!pass) ok = false;
		process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${label} = ${got}\n`);
	}
	process.stdout.write(ok ? "\nqa verify: all checks passed\n" : "\nqa verify: FAILED\n");
	return ok ? 0 : 1;
}