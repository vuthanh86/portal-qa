/**
 * src/cli/render.mjs — `qa render <run-dir>` subcommand.
 *
 * Spawns the renderer as a child Node process so the renderer stays a
 * self-contained script (no API surface change).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const rendererPath = join(here, "..", "renderer", "render-qa-summary.mjs");

export function run(args) {
	const runDir = args[0];
	if (!runDir) {
		process.stderr.write("qa render: missing <run-dir>\n");
		return 1;
	}
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [rendererPath, runDir], { stdio: "inherit" });
		child.on("error", (err) => { process.stderr.write(`qa render: ${err.message}\n`); resolve(1); });
		child.on("exit", (code) => resolve(code ?? 1));
	});
}