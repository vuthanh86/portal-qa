/**
 * test/memory.test.mjs — exercises the trend + learn memory modules.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTrend, appendTrend } from "../src/memory/trend.mjs";
import { mergeLearn, readLearn } from "../src/memory/learn.mjs";

test("readTrend returns [] when no file", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "qa-trend-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const pts = await readTrend(dir);
	assert.deepEqual(pts, []);
});

test("appendTrend creates a file and is idempotent per date", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "qa-trend-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	await appendTrend({ date: "2026-08-19", passRate: 80 }, dir);
	await appendTrend({ date: "2026-08-20", passRate: 90 }, dir);
	await appendTrend({ date: "2026-08-20", passRate: 95 }, dir); // overwrite
	const pts = await readTrend(dir);
	assert.equal(pts.length, 2);
	assert.equal(pts.find((p) => p.date === "2026-08-20").passRate, 95);
});

test("mergeLearn dedups by defect id and counts occurrences", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "qa-learn-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const runDir = mkdtempSync(join(tmpdir(), "qa-run-"));
	t.after(() => rmSync(runDir, { recursive: true, force: true }));
	mkdirSync(join(runDir, "evidence"), { recursive: true });
	writeFileSync(join(runDir, "results.json"), JSON.stringify({
		runId: "test-run",
		cases: [
			{ id: "TC-1", title: "broken grid", status: "FAIL", defectRef: "DEF-100" },
			{ id: "TC-2", title: "no defect ref", status: "FAIL" },
			{ id: "TC-3", title: "ok", status: "PASS" }
		]
	}));
	const r1 = await mergeLearn(runDir, { memoryDir: dir });
	assert.equal(r1.updated, 2);
	assert.equal(r1.items, 2);
	const r2 = await mergeLearn(runDir, { memoryDir: dir });
	assert.equal(r2.updated, 2);
	assert.equal(r2.items, 2); // deduped — same run repeated
	const items = await readLearn(dir);
	const def = items.find((i) => i.id === "DEF-100");
	assert.equal(def.occurrences, 2);
});