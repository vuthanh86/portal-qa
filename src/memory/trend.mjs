/**
 * src/memory/trend.mjs — read / append pass-rate trend points.
 *
 * Storage: <memoryDir>/trend.json — shape:
 *   { "points": [ { "date": "2026-08-20", "passRate": 83 }, ... ] }
 *
 * Defaults to ~/.dsh/qa-memory/ — override with:
 *   - explicit memoryDir argument
 *   - DSH_MEMORY_DIR env var (used by CI / sandboxed runners)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const defaultDir = () => process.env.DSH_MEMORY_DIR || join(process.env.HOME || process.env.USERPROFILE || ".", ".dsh", "qa-memory");

const filePath = (memoryDir) => join(memoryDir || defaultDir(), "trend.json");

export async function readTrend(memoryDir) {
	try {
		const raw = await readFile(filePath(memoryDir), "utf8");
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed.points) ? parsed.points : [];
	} catch {
		return [];
	}
}

export async function appendTrend(point, memoryDir) {
	const dir = memoryDir || defaultDir();
	await mkdir(dir, { recursive: true });
	const points = await readTrend(dir);
	const idx = points.findIndex((p) => p && p.date === point.date);
	if (idx >= 0) points[idx] = point;
	else points.push(point);
	points.sort((a, b) => String(a.date).localeCompare(String(b.date)));
	await writeFile(filePath(dir), JSON.stringify({ points }, null, 2) + "\n", "utf8");
	return points;
}