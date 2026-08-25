/**
 * azdevops/index.mjs — Azure DevOps task runtime.
 *
 * Called by the agent when a pipeline references `vuthanh.portal-qa.render@1`.
 * Resolves inputs from process.argv, installs (or finds) the qa CLI, runs the
 * requested command, and writes outputs (summaryPath, totals) so downstream
 * tasks can read them via $(portal-qa.summaryPath).
 */
import { spawnSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

function arg(name, fallback = "") {
	const flag = `--${name}`;
	for (let i = 0; i < process.argv.length; i++) {
		if (process.argv[i] === flag) return process.argv[i + 1] ?? fallback;
		if (process.argv[i].startsWith(`${flag}=`)) return process.argv[i].slice(flag.length + 1);
	}
	return fallback;
}

const command = arg("command", "render");
const runDir = arg("runDir", "");
const memoryDir = arg("memoryDir", "");
const port = arg("port", "4173");
const registry = arg("registry", process.env.NPM_CONFIG_REGISTRY || "https://registry.npmjs.org/");
const cliVersion = arg("cliVersion", "latest");

// Inputs also arrive via Azure DevOps INPUT_* env vars — fall back to those too.
const envInput = (k) => process.env[`INPUT_${k.toUpperCase().replace(/ /g, "_").replace(/-/g, "_")}`];
const final = {
	command: envInput("COMMAND") || command,
	runDir: envInput("RUN_DIR") || runDir,
	memoryDir: envInput("MEMORY_DIR") || memoryDir,
	registry: envInput("REGISTRY") || registry,
	cliVersion: envInput("CLI_VERSION") || cliVersion,
	port: envInput("PORT") || port
};

const pkg = "@vttech/portal-qa";

function sh(cmd, args, opts = {}) {
	const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
	if (r.status !== 0) process.exit(r.status ?? 1);
}

// Step 1: ensure the CLI is installed. `npm exec -y qa@version` is the cleanest
// single-shot install + run. Cache aside: ADO agents cache ~/.npm by default.
function buildArgs() {
	switch (final.command) {
		case "render": return ["render", final.runDir].filter(Boolean);
		case "verify": return ["verify", "--dir", final.runDir].filter(Boolean);
		case "learn":  return ["learn", final.runDir].filter(Boolean);
		case "serve":  return ["serve", "--port", final.port];
		default: throw new Error(`unknown command: ${final.command}`);
	}
}

// Try local CLI first, then npm exec fallback.
const localQa = resolve("node_modules", ".bin", process.platform === "win32" ? "qa.cmd" : "qa");
const cli = existsSync(localQa) ? localQa : null;

if (final.memoryDir) process.env.DSH_MEMORY_DIR = final.memoryDir;
if (final.runDir) process.env.DSH_RUNS_DIR = final.runDir;

const cliArgs = [`${pkg}@${final.cliVersion}`, ...buildArgs()];
if (cli) {
	sh(cli, buildArgs());
} else {
	// npm exec -y auto-installs to a cache dir.
	const r = spawnSync("npm", ["exec", "--registry", final.registry, "--yes", ...cliArgs], { stdio: "inherit" });
	if (r.status !== 0) process.exit(r.status ?? 1);
}

// Capture totals for the `render` command (best-effort, exit-0 doesn't depend on it).
if (final.command === "render" && final.runDir) {
	const summaryPath = resolve(final.runDir, "summary.html");
	console.log(`##vso[task.setvariable variable=summaryPath;isOutput=true]${summaryPath}`);
	console.log(`##vso[task.setvariable variable=totals]${existsSync(summaryPath) ? "rendered" : "missing"}`);
}