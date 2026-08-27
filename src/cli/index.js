/**
 * src/cli/index.js — Node API entry for @vttech/portal-qa.
 *
 *   import qa from "@vttech/portal-qa";
 *   qa.render("./my-run");
 *   await qa.mergeLearn("./my-run");
 *
 * Sub-paths (better for tree-shaking):
 *   import { renderSummary } from "@vttech/portal-qa/renderer";
 *   import { readTrend, appendTrend } from "@vttech/portal-qa/memory/trend";
 *   import { mergeLearn } from "@vttech/portal-qa/memory/learn";
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..", "..");
export const rendererPath = join(packageRoot, "src", "renderer", "render-qa-summary.mjs");
const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
export const version = pkg.version;
export const name = pkg.name;

/**
 * Render a run dir by spawning the renderer script. Returns the totals line.
 * @param {string} runDir
 * @param {{stdio?:"inherit"|"pipe"}} [opts]
 */
export function render(runDir, opts = {}) {
	const r = spawnSync(process.execPath, [rendererPath, runDir], { stdio: opts.stdio || "inherit", encoding: "utf8" });
	if (r.status !== 0) {
		const err = new Error(`renderer exited ${r.status}: ${(r.stderr || "").trim()}`);
		err.stdout = r.stdout; err.stderr = r.stderr; err.status = r.status;
		throw err;
	}
	return (r.stdout || "").trim();
}

import { readTrend, appendTrend } from "../memory/trend.mjs";
import { mergeLearn, readLearn } from "../memory/learn.mjs";
export { readTrend, appendTrend, mergeLearn, readLearn };

export default { render, readTrend, appendTrend, mergeLearn, readLearn, version, name, rendererPath };