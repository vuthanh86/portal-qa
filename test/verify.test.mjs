/**
 * test/verify.test.mjs — `qa verify` self-test suite.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const bin = join(packageRoot, "bin", "qa.mjs");

test("qa verify passes against the bundled demo", () => {
	const r = spawnSync(process.execPath, [bin, "verify"], { encoding: "utf8", cwd: packageRoot });
	assert.equal(r.status, 0, r.stderr || r.stdout);
	assert.match(r.stdout, /all checks passed/);
});

test("qa verify --node-check passes renderer syntax check", () => {
	const r = spawnSync(process.execPath, [bin, "verify", "--node-check"], { encoding: "utf8", cwd: packageRoot });
	assert.equal(r.status, 0, r.stderr || r.stdout);
});