#!/usr/bin/env node
/**
 * bin/qa.mjs — CLI dispatcher for @vttech/portal-qa.
 *
 *   qa render <run-dir>             render summary.html
 *   qa verify [--dir <demo-dir>]    self-test the renderer
 *   qa learn  <run-dir>             merge run into ~/.dsh/qa-memory/learn.json
 *   qa serve  [--port 4173]         tiny HTTP server
 *   qa --version | --help
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));

const USAGE = `qa — @vttech/portal-qa v${pkg.version}

Usage:
  qa render <run-dir>             render results.json + evidence/ → summary.html
  qa verify [--dir <demo-dir>]    self-test renderer (default demo: ./demo)
  qa learn  <run-dir>             merge a run into the qa-memory store
  qa serve  [--port 4173]         start HTTP server
  qa --version
  qa --help
`;

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
	process.stdout.write(USAGE);
	process.exit(0);
}
if (args.includes("--version") || args.includes("-v")) {
	process.stdout.write(`${pkg.name} v${pkg.version}\n`);
	process.exit(0);
}

const sub = args[0];
const rest = args.slice(1);

const dispatch = {
	render: () => import("../src/cli/render.mjs").then((m) => m.run(rest)),
	verify: () => import("../src/cli/verify.mjs").then((m) => m.run(rest)),
	learn: () => import("../src/cli/learn.mjs").then((m) => m.run(rest)),
	serve: () => import("../src/cli/serve.mjs").then((m) => m.run(rest))
};

if (!dispatch[sub]) {
	process.stderr.write(`qa: unknown subcommand '${sub}'\n\n${USAGE}`);
	process.exit(2);
}

try {
	const code = await dispatch[sub]();
	if (typeof code === "number") process.exit(code);
	// undefined → long-running command (serve); keep process alive.
} catch (err) {
	process.stderr.write(`qa: ${sub} failed: ${err && err.stack ? err.stack : err}\n`);
	process.exit(1);
}