/**
 * src/cli/learn.mjs — `qa learn <run-dir>` subcommand.
 */
import { mergeLearn } from "../memory/learn.mjs";

function parseArgs(args) {
	const out = { runDir: null, verified: false };
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--verified") out.verified = true;
		else if (!out.runDir) out.runDir = a;
	}
	return out;
}

export async function run(args) {
	const opts = parseArgs(args);
	if (!opts.runDir) {
		process.stderr.write("qa learn: missing <run-dir>\n");
		return 1;
	}
	const result = await mergeLearn(opts.runDir, { verified: opts.verified });
	process.stdout.write(`qa learn: updated ${result.updated} entries (store size: ${result.items})\n`);
	return 0;
}