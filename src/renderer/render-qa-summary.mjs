#!/usr/bin/env node
/**
 * render-qa-summary.mjs — Playwright-HTML-report-style summary page for a QA run.
 *
 * Usage: node ~/.dsh/scripts/render-qa-summary.mjs <run-dir>
 *
 * Reads <run-dir>/results.json (structured output written by the qa-report skill)
 * and the <run-dir>/evidence/ folder, then writes <run-dir>/summary.html —
 * a self-contained page (inline CSS/JS, no external assets) with:
 *   • header + counts bar      (Total / OK / FAIL / SKIP / Flaky / a11y / Weak / Duration / pass-rate)
 *   • pass-rate trend sparkline (read from ~/.dsh/qa-memory/trend.json if present)
 *   • status filters           (All / OK / FAIL / SKIP)
 *   • per-test rows grouped by priority (P0 → P3)
 *   • per-test rows with badges (OK/FAIL/SKIP, flaky, REGRESSION, healed, visual, a11y, weak/strong assert, slow) + expandable detail
 *   • per-FAIL "likely root cause" line + evidence signals
 *   • per-case self-eval (mutation-kill) and axe-core a11y audit detail
 *   • per-case action trace (playwright-style step timeline with screenshots)
 *   • per-case visual-regression result (diff-pixel count + diff image)
 *   • Copy-defect button on FAIL rows
 *   • Screenshot lightbox overlay for evidence links
 *   • REGRESSION section       (failed cases that passed on the previous run)
 *   • WEAK-ASSERT section      (PASS cases whose assertion would not catch a regression)
 *   • slowest-tests list       (top 5 by duration, excluding SKIP)
 *   • defects ledger + recommendation + learn summary
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const [, , runDir] = process.argv;
if (!runDir) {
	console.error("usage: node render-qa-summary.mjs <run-dir>");
	process.exit(1);
}

const jsonPath = join(runDir, "results.json");
let data;
try {
	data = JSON.parse(await readFile(jsonPath, "utf8"));
} catch (error) {
	console.error(`cannot read ${jsonPath}: ${error.message}`);
	process.exit(1);
}

// ----- evidence listing -----
let evidenceFiles = [];
try {
	evidenceFiles = (await readdir(join(runDir, "evidence"))).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f)).sort();
} catch {
	/* no evidence dir */
}

// ----- normalize cases -----
const cases = Array.isArray(data.cases) ? data.cases : [];
const normStatus = (s) => {
	const up = String(s ?? "").toUpperCase();
	if (["PASS", "OK", "PASSED"].includes(up)) return "OK";
	if (["FAIL", "FAILED", "BLOCKED", "ERROR"].includes(up)) return "FAIL";
	return "SKIP";
};
const normRootCause = (rc) => {
	if (!rc || typeof rc !== "object") return null;
	const hypothesis = String(rc.hypothesis ?? "").trim();
	const signals = Array.isArray(rc.signals) ? rc.signals.map((s) => String(s ?? "")).filter(Boolean) : [];
	return hypothesis || signals.length ? { hypothesis, signals } : null;
};
const normSelfEval = (se) => {
	if (!se || typeof se !== "object") return null;
	const assertion = String(se.assertion ?? "").trim();
	const mutation = String(se.mutation ?? "").trim();
	const result = String(se.result ?? (assertion ? (se.killed === true ? "STRONG" : "WEAK") : "NOT-EVALUATED")).toUpperCase();
	return {
		assertion,
		mutation,
		killed: se.killed === true,
		result: ["STRONG", "WEAK", "NOT-EVALUATED"].includes(result) ? result : "NOT-EVALUATED",
		note: String(se.note ?? "").trim()
	};
};
const normA11yAudit = (aa) => {
	if (!aa || typeof aa !== "object") return null;
	const violations = Array.isArray(aa.violations)
		? aa.violations
				.map((v) => ({
					impact: String(v?.impact ?? "unknown"),
					id: String(v?.id ?? "?"),
					description: String(v?.description ?? ""),
					nodes: Number.isFinite(Number(v?.nodes)) ? Number(v.nodes) : Array.isArray(v?.nodes) ? v.nodes.length : 1
				}))
				.filter((v) => v.id !== "?")
		: [];
	return { tool: String(aa.tool ?? "axe-core"), note: String(aa.note ?? "").trim(), violations };
};
const normTrace = (t) =>
	Array.isArray(t)
		? t
				.filter((s) => s && typeof s === "object")
				.map((s) => ({
					ts: String(s.ts ?? "").trim(),
					action: String(s.action ?? "").trim(),
					target: String(s.target ?? "").trim(),
					note: String(s.note ?? "").trim(),
					shot: String(s.shot ?? "").trim()
				}))
				.filter((s) => s.action)
		: [];
const normVisual = (v) => {
	if (!v || typeof v !== "object") return null;
	const changed = v.changed === true;
	const diffPixels = Number.isFinite(Number(v.diffPixels)) ? Number(v.diffPixels) : null;
	const baseline = String(v.baseline ?? "").trim();
	const diffImage = String(v.diffImage ?? "").trim();
	const note = String(v.note ?? "").trim();
	if (!baseline && !changed && diffPixels == null && !diffImage && !note) return null;
	return { baseline, changed, diffPixels, diffImage, note };
};
const rows = cases.map((c, i) => ({
	id: c.id ?? `C-${i + 1}`,
	title: c.title ?? "(untitled case)",
	priority: c.priority ?? "P3",
	status: normStatus(c.status),
	flaky: c.flaky === true,
	regression: c.regression === true,
	healed: c.healed === true,
	healNote: c.healNote ?? "",
	reason: c.reason ?? "",
	durationMs: Number.isFinite(Number(c.durationMs)) ? Number(c.durationMs) : null,
	expected: c.expected ?? "",
	actual: c.actual ?? "",
	repro: Array.isArray(c.repro) ? c.repro : [],
	evidence: Array.isArray(c.evidence) ? c.evidence : [],
	defectRef: c.defectRef ?? "",
	a11yIssues: Array.isArray(c.a11yIssues) ? c.a11yIssues.filter(Boolean) : [],
	a11yAudit: normA11yAudit(c.a11yAudit),
	rootCause: normRootCause(c.rootCause),
	selfEval: normSelfEval(c.selfEval),
	trace: normTrace(c.trace),
	visual: normVisual(c.visual),
	pageLoadMs: Number.isFinite(Number(c.pageLoadMs)) ? Number(c.pageLoadMs) : null
}));

const summary = data.summary ?? {};
const total = rows.length;
const passed = rows.filter((r) => r.status === "OK").length;
const failed = rows.filter((r) => r.status === "FAIL").length;
const skipped = rows.filter((r) => r.status === "SKIP").length;
const flaky = rows.filter((r) => r.flaky).length;
const regressions = rows.filter((r) => r.regression && r.status === "FAIL");
const weakAsserts = rows.filter((r) => r.selfEval && r.selfEval.result === "WEAK");
const weakCount = weakAsserts.length;
const a11yCount = rows.reduce((n, r) => n + (r.a11yAudit ? r.a11yAudit.violations.length : 0) + r.a11yIssues.length, 0);
const visualChanged = rows.filter((r) => r.visual && r.visual.changed).length;
const totalMs = summary.durationMs ?? rows.reduce((a, r) => a + (r.durationMs ?? 0), 0);
const fmtMs = (ms) =>
	!ms ? "—" : ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
const passRate = total === 0 ? "—" : `${Math.round((passed / total) * 100)}%`;

const esc = (s) =>
	String(s ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

// ----- trend sparkline (optional) -----
let trendPoints = [];
try {
	const trendRaw = await readFile(join(homedir(), ".dsh", "qa-memory", "trend.json"), "utf8");
	const parsed = JSON.parse(trendRaw);
	if (Array.isArray(parsed.points)) {
		trendPoints = parsed.points
			.filter((p) => p && Number.isFinite(Number(p.passRate)))
			.map((p) => ({ date: String(p.date ?? ""), passRate: Number(p.passRate) }));
	}
} catch {
	/* trend file missing or malformed — silently omit sparkline */
}
const sparklineHtml = (() => {
	if (trendPoints.length < 2) return "";
	const w = 120;
	const h = 28;
	const pad = 2;
	const innerW = w - pad * 2;
	const innerH = h - pad * 2;
	const stepX = trendPoints.length === 1 ? 0 : innerW / (trendPoints.length - 1);
	const pts = trendPoints.map((p, i) => {
		const x = pad + i * stepX;
		const norm = Math.max(0, Math.min(100, p.passRate)) / 100;
		const y = pad + innerH - norm * innerH;
		return [x, y];
	});
	const polyline = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
	const last = pts[pts.length - 1];
	const dots = pts
		.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i === pts.length - 1 ? 2 : 1.2}" fill="#fff" opacity="${i === pts.length - 1 ? 0.95 : 0.6}"/>`)
		.join("");
	const lastLabel = trendPoints[trendPoints.length - 1];
	return `<span class="spark" title="Pass-rate trend — last: ${esc(lastLabel.date)} ${Math.round(lastLabel.passRate)}%">
	  <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-label="Pass-rate trend sparkline">
		<polyline points="${polyline}" fill="none" stroke="#9a6700" stroke-width="1.5"/>
		${dots}
	  </svg>
	</span>`;
})();

const badge = (status) => {
	const cls = status === "OK" ? "ok" : status === "FAIL" ? "fail" : "skip";
	return `<span class="badge ${cls}">${status}</span>`;
};
const evidenceRefs = (list, fallback) => {
	const files = (list.length ? list : fallback).filter(Boolean);
	if (!files.length) return "";
	return files
		.map((f) => `<a class="ev" href="evidence/${esc(basename(String(f)))}" target="_blank">🖼 ${esc(basename(String(f)))}</a>`)
		.join(" ");
};

// Index every row once so onclick toggle handlers resolve the right element even
// when the rows are rendered under multiple priority group headers.
let rowCounter = 0;
const rowIndex = new WeakMap();
rows.forEach((r) => { rowIndex.set(r, rowCounter++); });

const priorityOrder = ["P0", "P1", "P2", "P3"];
const grouped = new Map();
for (const p of priorityOrder) grouped.set(p, []);
for (const r of rows) {
	const key = priorityOrder.includes(r.priority) ? r.priority : "P3";
	grouped.get(key).push(r);
}

const renderRow = (r) => {
	const i = rowIndex.get(r);
	const repro = Array.isArray(r.repro) && r.repro.length ? `<ol>${r.repro.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : "";
	const ev = evidenceRefs(r.evidence, []);
	const tags = [];
	if (r.regression && r.status === "FAIL") tags.push('<span class="chip reg">REGRESSION</span>');
	if (r.flaky) tags.push('<span class="chip flaky">flaky</span>');
	if (r.healed) tags.push(`<span class="chip healed" title="${esc(r.healNote)}">🩹 healed</span>`);
	if (r.visual && r.visual.changed) tags.push(`<span class="chip visual" title="visual diff ${r.visual.diffPixels != null ? r.visual.diffPixels + " px" : ""}">🔍 Δ${r.visual.diffPixels != null ? r.visual.diffPixels : "?"}</span>`);
	else if (r.visual && r.visual.baseline === "compared") tags.push('<span class="chip visual">🔍 visual ok</span>');
	else if (r.visual && r.visual.baseline === "established") tags.push('<span class="chip visual">🔍 baseline</span>');
	const a11yTotal = (r.a11yAudit ? r.a11yAudit.violations.length : 0) + r.a11yIssues.length;
	if (a11yTotal) tags.push(`<span class="chip a11y" title="${esc(r.a11yIssues.join(" • "))}">a11y ×${a11yTotal}</span>`);
	if (r.selfEval && r.selfEval.result === "WEAK") tags.push('<span class="chip weak">⚠ weak assert</span>');
	else if (r.selfEval && r.selfEval.result === "STRONG") tags.push('<span class="chip strong">✓ strong assert</span>');
	if (r.pageLoadMs != null && r.pageLoadMs > 5000) tags.push('<span class="chip slow">⚡ slow</span>');
	const axeViolations = r.a11yAudit ? r.a11yAudit.violations : [];
	const trace = r.trace ?? [];
	const traceHtml = trace.length
		? `<p class="trace-head"><b>Trace (${trace.length} steps):</b></p><ol class="trace-list">${trace.map((t) => `<li><span class="t-ts">${esc(t.ts)}</span> <span class="t-action">${esc(t.action)}</span>${t.target ? ` <code>${esc(t.target)}</code>` : ""}${t.note ? ` <span class="t-note">— ${esc(t.note)}</span>` : ""}${t.shot ? ` <a class="ev" href="evidence/${esc(basename(t.shot))}" target="_blank">🖼</a>` : ""}</li>`).join("")}</ol>`
		: "";
	const visualHtml = r.visual
		? `<p><b>Visual regression:</b> ${r.visual.changed ? '<span class="chip visual">changed</span>' : `<span class="chip">${esc(r.visual.baseline || "?")}</span>`}${r.visual.diffPixels != null ? ` — ${r.visual.diffPixels} differing pixels` : ""}${r.visual.diffImage ? ` <a class="ev" href="evidence/${esc(basename(r.visual.diffImage))}" target="_blank">🖼 diff</a>` : ""}${r.visual.note ? ` <span class="t-note">${esc(r.visual.note)}</span>` : ""}</p>`
		: "";
	const hasDetail = r.expected || r.actual || repro || ev || r.reason || axeViolations.length || r.a11yIssues.length || r.pageLoadMs != null || r.rootCause || r.selfEval || r.healed || trace.length || r.visual;
	const a11yDetail = (axeViolations.length || r.a11yIssues.length)
		? `<p><b>a11y audit:</b>${axeViolations.length ? `<ul class="a11y-list">${axeViolations.map((v) => `<li><span class="chip">${esc(v.impact)}</span> <code>${esc(v.id)}</code> — ${esc(v.description)} (${v.nodes} node${v.nodes === 1 ? "" : "s"})</li>`).join("")}</ul>` : ""}${r.a11yIssues.length ? `<ul class="a11y-list">${r.a11yIssues.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}</p>`
		: "";
	const rootCauseHtml = r.rootCause
		? `<p><b>Likely root cause:</b> ${esc(r.rootCause.hypothesis)}${r.rootCause.signals.length ? `<ul class="a11y-list">${r.rootCause.signals.map((s) => `<li><code>${esc(s)}</code></li>`).join("")}</ul>` : ""}</p>`
		: "";
	const selfEvalHtml = r.selfEval
		? `<p><b>Self-eval (mutation-kill):</b> <span class="chip ${r.selfEval.result === "WEAK" ? "weak" : r.selfEval.result === "STRONG" ? "strong" : ""}">${esc(r.selfEval.result)}</span>${r.selfEval.assertion ? ` asserted <i>“${esc(r.selfEval.assertion)}”</i>` : ""}${r.selfEval.mutation ? `; mutation <i>“${esc(r.selfEval.mutation)}”</i> was ${r.selfEval.killed ? "killed (caught)" : "NOT killed (slipped through)"}` : ""}${r.selfEval.note ? ` — ${esc(r.selfEval.note)}` : ""}</p>`
		: "";
	const healedLine = r.healed ? `<p><b>Healed locator:</b> ${esc(r.healNote)}</p>` : "";
	const pageLoadLine = r.pageLoadMs != null ? `<p><b>Page load:</b> ${fmtMs(r.pageLoadMs)}${r.pageLoadMs > 5000 ? " <span class=\"chip slow\">⚡ slow</span>" : ""}</p>` : "";
	const copyBtn = r.status === "FAIL"
		? `<button type="button" class="copy-defect" data-row="${i}" onclick="copyDefect(event, ${i})">📋 Copy defect</button>`
		: "";
	const detail = hasDetail
		? `<div class="detail">
			${r.expected ? `<p><b>Expected:</b> ${esc(r.expected)}</p>` : ""}
			${r.actual ? `<p><b>Actual:</b> ${esc(r.actual)}</p>` : ""}
			${rootCauseHtml}
			${repro ? `<p><b>Repro steps:</b>${repro}</p>` : ""}
			${r.reason ? `<p><b>Reason:</b> ${esc(r.reason)}</p>` : ""}
			${r.defectRef ? `<p><b>Defect:</b> ${esc(r.defectRef)}</p>` : ""}
			${healedLine}
			${pageLoadLine}
			${selfEvalHtml}
			${visualHtml}
			${a11yDetail}
			${traceHtml}
			${ev ? `<p class="evs">${ev}</p>` : ""}
			${copyBtn ? `<p class="copy-row">${copyBtn}</p>` : ""}
		  </div>`
		: copyBtn ? `<div class="detail"><p class="copy-row">${copyBtn}</p></div>` : "";
	return `<div class="case${r.regression && r.status === "FAIL" ? " reg" : ""}" data-status="${r.status}">
	  <div class="case-head" onclick="toggle(${i})">
		${badge(r.status)}
		${tags.join("")}
		<span class="case-id">${esc(r.id)}</span>
		<span class="case-title">${esc(r.title)}</span>
		<span class="chip">${esc(r.priority)}</span>
		<span class="dur">${fmtMs(r.durationMs)}</span>
		<span class="chev">▸</span>
	  </div>
	  ${detail}
	</div>`;
};

const rowHtml = priorityOrder
	.filter((p) => grouped.get(p).length)
	.map((p) => {
		const inner = grouped.get(p).map(renderRow).join("\n");
		const groupStatuses = grouped.get(p).map((r) => r.status);
		const allStatuses = Array.from(new Set(groupStatuses)).sort().join(",");
		return `<section class="prio-group" data-priority="${esc(p)}" data-statuses="${esc(allStatuses)}">
		  <div class="prio-h-row"><h2 class="prio-h">${esc(p)}</h2><span class="prio-count">(${grouped.get(p).length})</span></div>
		  <div class="prio-rows">${inner}</div>
		</section>`;
	})
	.join("\n");

const regressionsHtml = regressions.length
	? regressions
			.map(
				(r) => `<div class="case reg"><div class="case-head">
			<span class="badge fail">REGRESSION</span>
			<span class="case-id">${esc(r.id)}</span>
			<span class="case-title">${esc(r.title)}</span>
			<span class="chip">${esc(r.priority)}</span>
			<span class="dur">${fmtMs(r.durationMs)}</span>
			${r.actual ? `<p class="actual">${esc(r.actual)}</p>` : ""}
		  </div></div>`
			)
			.join("\n")
	: "<p class='muted'>No regressions — every failure is new or previously blocked.</p>";

const weakAssertsHtml = weakAsserts.length
	? weakAsserts
			.map(
				(r) => `<div class="case"><div class="case-head">
			<span class="badge skip">WEAK</span>
			<span class="case-id">${esc(r.id)}</span>
			<span class="case-title">${esc(r.title)}</span>
			<span class="chip">${esc(r.priority)}</span>
			${r.selfEval.assertion ? `<p class="actual">asserted <i>“${esc(r.selfEval.assertion)}”</i> — mutation <i>“${esc(r.selfEval.mutation)}”</i> slipped through</p>` : ""}
		  </div></div>`
			)
			.join("\n")
	: "<p class='muted'>No weak assertions — every PASS assertion pins its behavior.</p>";

const slowest = rows
	.filter((r) => r.durationMs != null && r.status !== "SKIP")
	.sort((a, b) => b.durationMs - a.durationMs)
	.slice(0, 5);
const slowestHtml = slowest.length
	? `<ol class="slow">${slowest.map((r) => `<li><span class="case-id">${esc(r.id)}</span> ${esc(r.title)} — <b>${fmtMs(r.durationMs)}</b></li>`).join("")}</ol>`
	: "<p class='muted'>No durations recorded.</p>";

const defects = Array.isArray(data.defects) ? data.defects : [];
const defectsHtml = defects.length
	? defects
			.map(
				(d) => `<div class="defect"><span class="badge ${String(d.severity ?? "").startsWith("S1") ? "fail" : "skip"}">${esc(d.severity ?? "S?")}</span>
			<span class="case-title">${esc(d.title ?? d.id ?? "(defect)")}</span>
			<span class="chip">${esc(d.status ?? "")}</span>
			${d.evidence ? `<span class="evs">${evidenceRefs([d.evidence], [])}</span>` : ""}</div>`
			)
			.join("\n")
	: "<p class='muted'>No defects recorded.</p>";

const rec = data.recommendation ? `<div class="rec"><b>Recommendation:</b> ${esc(data.recommendation)}</div>` : "";
const learn = data.learnSummary ? `<div class="rec learn"><b>Learned:</b> ${esc(data.learnSummary)}</div>` : "";

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>QA Summary — ${esc(data.runId ?? basename(runDir))}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; background: #f6f7f9; color: #1f2328; }
  header { background: #24292f; color: #fff; padding: 18px 24px; }
  header h1 { margin: 0 0 6px; font-size: 18px; }
  header .meta { color: #b8c0cc; font-size: 12.5px; }
  .counts { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 12px; align-items: center; }
  .count { background: rgba(255,255,255,.08); border-radius: 8px; padding: 8px 16px; min-width: 96px; }
  .count b { display: block; font-size: 22px; }
  .count .lbl { font-size: 11px; color: #b8c0cc; text-transform: uppercase; letter-spacing: .04em; }
  .count.ok b { color: #57ab5a; } .count.fail b { color: #f47067; } .count.skip b { color: #d4a72c; }
  .count.flaky b { color: #e3b341; } .count.weak b { color: #e3b341; }
  .spark { display: inline-flex; align-items: center; margin-left: auto; background: rgba(255,255,255,.08); border-radius: 8px; padding: 4px 10px; }
  .spark svg { display: block; }
  main { max-width: 1080px; margin: 20px auto; padding: 0 20px 60px; }
  .filters { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
  .filters button { border: 1px solid #d0d7de; background: #fff; border-radius: 20px; padding: 5px 14px; cursor: pointer; font-size: 12.5px; }
  .filters button.active { background: #24292f; color: #fff; border-color: #24292f; }
  h2 { font-size: 15px; margin: 26px 0 10px; }
  .case { background: #fff; border: 1px solid #e1e4e8; border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
  .case.reg { border-left: 4px solid #cf222e; }
  .case-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; flex-wrap: wrap; }
  .case-head:hover { background: #f6f8fa; }
  .badge { display: inline-block; padding: 2px 9px; border-radius: 12px; font-size: 11px; font-weight: 600; letter-spacing: .03em; }
  .badge.ok { background: #dafbe1; color: #1a7f37; }
  .badge.fail { background: #ffebe9; color: #cf222e; }
  .badge.skip { background: #fff8c5; color: #9a6700; }
  .case-id { font-family: ui-monospace, Consolas, monospace; color: #57606a; font-size: 12.5px; }
  .case-title { flex: 1; }
  .chip { border: 1px solid #d0d7de; border-radius: 10px; padding: 1px 8px; font-size: 11px; color: #57606a; white-space: nowrap; }
  .chip.flaky { background: #fff8c5; border-color: #e3b341; color: #9a6700; }
  .chip.reg { background: #ffebe9; border-color: #cf222e; color: #cf222e; font-weight: 700; }
  .chip.a11y { background: #f3e8ff; border-color: #a371f7; color: #6b21a8; font-weight: 600; }
  .chip.slow { background: #ffeef0; border-color: #f47067; color: #b1102a; font-weight: 600; }
  .chip.healed { background: #ddf4ff; border-color: #b6e3ff; color: #0969da; }
  .chip.visual { background: #ddf4ff; border-color: #b6e3ff; color: #0969da; }
  .chip.weak { background: #fff8c5; border-color: #e3b341; color: #9a6700; font-weight: 700; }
  .chip.strong { background: #dafbe1; border-color: #57ab5a; color: #1a7f37; }
  .prio-group { margin-bottom: 18px; }
  .prio-h-row { display: flex; align-items: center; gap: 8px; margin: 14px 0 8px; padding: 4px 10px; background: #eaeef2; border-radius: 6px; }
  .prio-h { font-size: 13px; margin: 0; color: #24292f; font-weight: 600; }
  .prio-count { color: #57606a; font-size: 11.5px; }
  .a11y-list { margin: 4px 0 4px 20px; }
  .a11y-list code { font-family: ui-monospace, Consolas, monospace; font-size: 12px; background: #eaeef2; padding: 0 4px; border-radius: 4px; }
  .trace-head { margin: 8px 0 2px; }
  .trace-list { margin: 2px 0 6px 18px; padding: 0; list-style: none; border-left: 2px solid #d0d7de; }
  .trace-list li { margin: 2px 0 2px 10px; position: relative; }
  .trace-list li::before { content: ""; position: absolute; left: -15px; top: 7px; width: 8px; height: 8px; border-radius: 50%; background: #57606a; }
  .t-ts { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: #8b949e; margin-right: 6px; }
  .t-action { font-weight: 600; font-size: 12px; }
  .t-note { color: #57606a; font-size: 12px; }
  .trace-list code { font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; background: #eaeef2; padding: 0 4px; border-radius: 4px; }
  .copy-row { margin-top: 10px; }
  .copy-defect { background: #fff; border: 1px solid #d0d7de; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; color: #24292f; }
  .copy-defect:hover { background: #f6f8fa; }
  .copy-defect.copied { background: #dafbe1; border-color: #57ab5a; color: #1a7f37; }
  #lightbox { position: fixed; inset: 0; background: rgba(0,0,0,.82); display: none; align-items: center; justify-content: center; z-index: 9999; padding: 24px; cursor: zoom-out; }
  #lightbox.open { display: flex; }
  #lightbox img { max-width: 100%; max-height: 100%; box-shadow: 0 8px 32px rgba(0,0,0,.5); border-radius: 4px; background: #fff; }
  #lightbox .close-hint { position: absolute; top: 12px; right: 16px; color: #fff; font-size: 12px; opacity: .75; }
  .dur { color: #57606a; font-size: 12px; white-space: nowrap; }
  .chev { color: #8b949e; }
  .detail { display: none; border-top: 1px solid #e1e4e8; padding: 12px 14px; background: #f6f8fa; }
  .detail.open { display: block; }
  .detail p { margin: 6px 0; }
  .detail ol { margin: 4px 0 4px 20px; }
  .evs { display: flex; gap: 8px; flex-wrap: wrap; }
  .ev { display: inline-block; border: 1px solid #d0d7de; border-radius: 6px; padding: 2px 8px; background: #fff; font-size: 12px; color: #0969da; text-decoration: none; }
  .ev:hover { background: #ddf4ff; }
  .actual { flex-basis: 100%; color: #57606a; font-size: 12.5px; margin: 0; }
  .slow { background: #fff; border: 1px solid #e1e4e8; border-radius: 8px; padding: 12px 14px 12px 34px; }
  .slow li { margin: 4px 0; }
  .defect { background: #fff; border: 1px solid #e1e4e8; border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .rec { background: #dafbe1; border: 1px solid #aceebb; border-radius: 8px; padding: 10px 14px; margin-top: 14px; }
  .rec.learn { background: #ddf4ff; border-color: #b6e3ff; }
  .muted { color: #57606a; }
  footer { color: #8b949e; font-size: 12px; text-align: center; padding: 20px; }
</style>
</head>
<body>
<header>
  <h1>QA Summary — ${esc(data.runId ?? basename(runDir))}</h1>
  <div class="meta">
    ${esc(data.scope ?? "")} · ${esc(data.env ?? "")} · ${esc(data.depth ?? "")} depth ·
    ${esc(data.date ?? "")}
  </div>
  <div class="counts">
    <div class="count"><b>${total}</b><span class="lbl">Total</span></div>
    <div class="count ok"><b>${passed}</b><span class="lbl">OK</span></div>
    <div class="count fail"><b>${failed}</b><span class="lbl">FAIL</span></div>
    <div class="count skip"><b>${skipped}</b><span class="lbl">SKIP</span></div>
    <div class="count flaky"><b>${flaky}</b><span class="lbl">Flaky</span></div>
    <div class="count"><b>${a11yCount}</b><span class="lbl">a11y</span></div>
    <div class="count weak"><b>${weakCount}</b><span class="lbl">Weak</span></div>
    <div class="count"><b>${visualChanged}</b><span class="lbl">Visual Δ</span></div>
    <div class="count"><b>${fmtMs(totalMs)}</b><span class="lbl">Duration</span></div>
    <div class="count"><b>${passRate}</b><span class="lbl">Pass rate</span></div>
    ${sparklineHtml}
  </div>
</header>
<main>
  <div class="filters">
    <button class="active" data-f="all" onclick="filter('all')">All (${total})</button>
    <button data-f="OK" onclick="filter('OK')">OK (${passed})</button>
    <button data-f="FAIL" onclick="filter('FAIL')">FAIL (${failed})</button>
    <button data-f="SKIP" onclick="filter('SKIP')">SKIP (${skipped})</button>
  </div>

  ${regressions.length ? `<h2>⚠ Regressions (passed previously)</h2><div id="regressions">${regressionsHtml}</div>` : ""}
  ${weakAsserts.length ? `<h2>⚠ Weak assertions (would not catch a regression)</h2><div id="weak">${weakAssertsHtml}</div>` : ""}

  <h2>Test cases</h2>
  <div id="cases">${rowHtml}</div>

  <h2>Slowest tests</h2>
  <div id="slow">${slowestHtml}</div>

  <h2>Defects</h2>
  <div id="defects">${defectsHtml}</div>

  ${rec}
  ${learn}
</main>
<div id="lightbox" role="dialog" aria-modal="true" aria-label="Screenshot preview"></div>
<footer>Generated by ~/.dsh/scripts/render-qa-summary.mjs · evidence: ${evidenceFiles.length} file(s)</footer>
<script>
  // Expose the per-row payload for the Copy-defect button.
  window.__cases = ${JSON.stringify(
		rows.map((r) => ({
			id: r.id,
			title: r.title,
			priority: r.priority,
			status: r.status,
			expected: r.expected,
			actual: r.actual,
			repro: r.repro,
			evidence: r.evidence,
			defectRef: r.defectRef,
			rootCause: r.rootCause ? r.rootCause.hypothesis : "",
			selfEval: r.selfEval ? `${r.selfEval.result}${r.selfEval.assertion ? " — asserted: " + r.selfEval.assertion : ""}` : "",
			healed: r.healed ? r.healNote : "",
			visual: r.visual ? (r.visual.changed ? "visual changed (" + (r.visual.diffPixels != null ? r.visual.diffPixels : "?") + "px)" : r.visual.baseline || "") : "",
			traceSteps: r.trace.length
		}))
	)};

  function toggle(i) {
    const rows = document.querySelectorAll(".case .detail");
    const detail = rows[i];
    if (!detail) return;
    detail.classList.toggle("open");
    const chev = document.querySelectorAll(".case .chev")[i];
    if (chev) chev.textContent = detail.classList.contains("open") ? "▾" : "▸";
  }
  function filter(f) {
    document.querySelectorAll(".filters button").forEach((b) => b.classList.toggle("active", b.dataset.f === f));
    document.querySelectorAll("#cases .case").forEach((c) => {
      c.style.display = f === "all" || c.dataset.status === f ? "" : "none";
    });
    // Hide a priority group when every row inside it is filtered out, so the
    // group header does not dangle above an empty section.
    document.querySelectorAll("#cases .prio-group").forEach((g) => {
      const anyVisible = Array.from(g.querySelectorAll(".case")).some((c) => c.style.display !== "none");
      g.style.display = anyVisible ? "" : "none";
    });
  }

  // --- Screenshot lightbox ---
  document.addEventListener("click", (ev) => {
    const a = ev.target.closest("a.ev");
    if (!a) return;
    // Let modifier-clicks (cmd/ctrl/shift/middle) behave as plain opens.
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return;
    ev.preventDefault();
    openLightbox(a.href, a.textContent.trim());
  });
  function openLightbox(src, alt) {
    const lb = document.getElementById("lightbox");
    if (!lb) return;
    lb.innerHTML = '<span class="close-hint">Click anywhere or press Esc to close</span><img alt="' + escAttr(alt || "") + '" src="' + escAttr(src) + '"/>';
    lb.classList.add("open");
  }
  function closeLightbox() {
    const lb = document.getElementById("lightbox");
    if (!lb) return;
    lb.classList.remove("open");
    lb.innerHTML = "";
  }
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeLightbox();
  });
  document.addEventListener("click", (ev) => {
    const lb = document.getElementById("lightbox");
    if (lb && lb.classList.contains("open") && ev.target === lb) closeLightbox();
  });
  function escAttr(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // --- Copy defect ---
  window.copyDefect = async function (ev, i) {
    ev.stopPropagation();
    const c = (window.__cases || [])[i];
    if (!c) return;
    const lines = [
      "ID:          " + (c.id || ""),
      "Title:       " + (c.title || ""),
      "Priority:    " + (c.priority || ""),
      "Status:      " + (c.status || ""),
      "Expected:    " + (c.expected || ""),
      "Actual:      " + (c.actual || ""),
      "Defect ref:  " + (c.defectRef || "")
    ];
    if (c.rootCause) lines.push("Root cause:  " + c.rootCause);
    if (c.selfEval) lines.push("Self-eval:   " + c.selfEval);
    if (c.healed) lines.push("Healed:      " + c.healed);
    if (c.visual) lines.push("Visual:      " + c.visual);
    if (Array.isArray(c.repro) && c.repro.length) {
      lines.push("Repro steps:");
      c.repro.forEach((s, idx) => lines.push("  " + (idx + 1) + ". " + s));
    }
    if (Array.isArray(c.evidence) && c.evidence.length) {
      lines.push("Evidence:");
      c.evidence.forEach((e) => lines.push("  - " + e));
    }
    const text = lines.join("\n");
    const btn = ev.currentTarget;
    try {
      await navigator.clipboard.writeText(text);
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = "✓ Copied";
        btn.classList.add("copied");
        setTimeout(() => { btn.textContent = orig; btn.classList.remove("copied"); }, 1500);
      }
    } catch (err) {
      // Fallback: temporary textarea + execCommand for older browsers / blocked permissions.
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        if (btn) {
          const orig = btn.textContent;
          btn.textContent = "✓ Copied";
          btn.classList.add("copied");
          setTimeout(() => { btn.textContent = orig; btn.classList.remove("copied"); }, 1500);
        }
      } catch (err2) {
        if (btn) {
          const orig = btn.textContent;
          btn.textContent = "Copy failed";
          setTimeout(() => { btn.textContent = orig; }, 1500);
        }
      }
    }
  };
</script>
</body>
</html>
`;

await writeFile(join(runDir, "summary.html"), html, "utf8");
console.log(`wrote ${join(runDir, "summary.html")} — ${total} cases (${passed} OK, ${failed} FAIL, ${skipped} SKIP, ${flaky} flaky, ${regressions.length} regressions, ${weakCount} weak asserts, ${a11yCount} a11y findings, ${visualChanged} visual changes)`);
