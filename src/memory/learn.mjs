/**
 * src/memory/learn.mjs — merge a completed run into the shared QA memory store.
 *
 * Storage: <memoryDir>/learn.json — shape:
 *   {
 *     "items": [
 *       { "id": "DEF-001", "title": "...", "firstSeen": "2026-08-10", "lastSeen": "2026-08-20",
 *         "status": "open", "verified": false, "occurrences": 3 }
 *     ]
 *   }
 *
 * Dedup key: defect id (or `<runId>:<caseId>` fallback).
 * Verified-vs-observed: only flip verified→true if the source run is marked verified.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const defaultDir = () => process.env.DSH_MEMORY_DIR || join(process.env.HOME || process.env.USERPROFILE || ".", ".dsh", "qa-memory");
const filePath = (memoryDir) => join(memoryDir || defaultDir(), "learn.json");

const today = () => new Date().toISOString().slice(0, 10);

async function load(memoryDir) {
	try {
		const raw = await readFile(filePath(memoryDir), "utf8");
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed.items) ? parsed : { items: [] };
	} catch {
		return { items: [] };
	}
}

export async function mergeLearn(runDir, opts = {}) {
	const memoryDir = opts.memoryDir;
	const dir = memoryDir || defaultDir();
	await mkdir(dir, { recursive: true });
	const store = await load(dir);
	const idx = new Map(store.items.map((it, i) => [it.id, i]));

	const resultsPath = join(runDir, "results.json");
	const data = JSON.parse(await readFile(resultsPath, "utf8"));
	const verified = opts.verified === true;
	const date = today();

	const updates = [];
	for (const c of data.cases || []) {
		if (!c || c.status !== "FAIL") continue;
		const id = c.defectRef || `${data.runId || "run"}:${c.id}`;
		const existing = idx.has(id) ? store.items[idx.get(id)] : null;
		const next = {
			id,
			title: c.title || existing?.title || "",
			firstSeen: existing?.firstSeen || date,
			lastSeen: date,
			status: "open",
			verified,
			occurrences: (existing?.occurrences || 0) + 1
		};
		if (existing) store.items[idx.get(id)] = next;
		else { store.items.push(next); idx.set(id, store.items.length - 1); }
		updates.push(next);
	}

	await writeFile(filePath(dir), JSON.stringify(store, null, 2) + "\n", "utf8");
	return { updated: updates.length, items: store.items.length };
}

export async function readLearn(memoryDir) {
	const store = await load(memoryDir);
	return store.items;
}