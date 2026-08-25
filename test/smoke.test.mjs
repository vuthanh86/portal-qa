/**
 * test/smoke.test.mjs — node:test smoke suite.
 *
 * Spawns the actual `bin/qa.mjs` dispatcher so this also exercises the CLI surface.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const bin = join(packageRoot, "bin", "qa.mjs");

test("--version prints package version", () => {
	const r = spawnSync(process.execPath, [bin, "--version"], { encoding: "utf8" });
	assert.equal(r.status, 0);
	assert.match(r.stdout.trim(), /^@vuthanh\/portal-qa v\d+\.\d+\.\d+$/);
});

test("--help lists subcommands", () => {
	const r = spawnSync(process.execPath, [bin, "--help"], { encoding: "utf8" });
	assert.equal(r.status, 0);
	assert.match(r.stdout, /qa render/);
	assert.match(r.stdout, /qa verify/);
	assert.match(r.stdout, /qa serve/);
});

test("unknown subcommand exits 2", () => {
	const r = spawnSync(process.execPath, [bin, "bogus"], { encoding: "utf8" });
	assert.equal(r.status, 2);
});

test("render against demo dir produces summary.html", () => {
	const r = spawnSync(process.execPath, [bin, "render", join(packageRoot, "demo")], { encoding: "utf8" });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /wrote .*summary\.html/);
});