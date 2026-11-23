import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildReport, renderReport } from "../../scripts/mml/report.mjs";

// Synthetic case results exercise the report, never presented as a corpus run.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/report-results.json", import.meta.url), "utf8"));
const copy = () => structuredClone(fixture);

test("counts executions separately from documents, variants, outcomes and equality", () => {
  const report = buildReport([copy()]);
  assert.deepEqual(report.population, { uniqueFiles: 5, unmodifiedFiles: 3, injectedFiles: 2 });
  assert.equal(report.totals.cases, 7);
  assert.equal(report.classes.find((c) => c.classification === "different tree").example.detail, "/children/0: ruby=mi ts=mo");
  assert.deepEqual(report.totals.outcomes, { pass: 2, refused: 1, refused_by_ts_only: 1, both_refuse: 1, mismatch: 2 });
  assert.deepEqual(report.totals.equality.bytes, { equal: 1, different: 2, unavailable: 4 });
  assert.deepEqual(report.totals.equality.treeWs, { equal: 2, different: 1, unavailable: 4 });
  assert.deepEqual(report.totals.equality.treeExact, { equal: 1, different: 2, unavailable: 4 });
  assert.deepEqual(report.totals.equality.dataNorm, { equal: 3, different: 0, unavailable: 4 });
  assert.equal(report.groups.find((g) => g.suite === "mml2-testsuite" && g.variant === "as-is").cases, 2);
  assert.equal(report.groups.find((g) => g.suite === "mml2-testsuite" && g.variant === "ns-injected").cases, 1);
  for (const group of [...report.groups, report.totals]) {
    assert.equal(Object.values(group.outcomes).reduce((a, b) => a + b, 0), group.cases);
    for (const counts of Object.values(group.equality)) assert.equal(counts.equal + counts.different + counts.unavailable, group.cases);
  }
});

test("both-version runs count one original document and distinct executions", () => {
  const part = copy();
  part.results.push(...part.results.filter((r) => r.file.endsWith("/a.mml")).map((r) => ({ ...r, version: "4" })));
  const report = buildReport([part]);
  assert.equal(report.population.uniqueFiles, 5);
  assert.equal(report.totals.cases, 9);
  assert.equal(report.groups.filter((g) => g.suite === "mml2-testsuite" && g.version === "4").length, 2);
});

test("report is stable across input ordering and all-suite/per-suite partitioning", () => {
  const part = copy();
  const expected = buildReport([part]);
  const parts = ["mmlcore-testsuite", "mml3-testsuite", "mml2-testsuite"].map((suite) => {
    const results = part.results.filter((r) => r.suite === suite).reverse();
    const files = results.filter((r) => r.variant === "as-is").length;
    return { ...part, suite, results, files, hasNs: files - results.filter((r) => r.variant === "ns-injected").length };
  });
  assert.deepEqual(buildReport(parts), expected);
  part.results.reverse();
  assert.equal(renderReport(buildReport([part])), renderReport(expected));
});

test("rejects overlapping all-suite/per-suite runs and duplicate rows", () => {
  assert.throws(() => buildReport([copy(), copy()]), /duplicate case/);
  const part = copy();
  part.results.push(part.results[0]);
  assert.throws(() => buildReport([part]), /duplicate case/);
});

for (const [name, mutate, message] of [
  ["stale file total", (p) => p.files++, /files metadata/],
  ["stale namespace total", (p) => p.hasNs++, /hasNs metadata/],
  ["unknown outcome", (p) => p.results[0].outcome = "accepted", /unknown outcome/],
  ["missing pass checks", (p) => delete p.results[0].checks, /pass missing equality/],
  ["false pass", (p) => p.results[0].checks.treeWs = false, /outcome disagrees/],
  ["partial checks", (p) => delete p.results[0].checks.bytes, /incomplete equality/],
  ["impossible bytes", (p) => p.results[0].checks.bytes = true, /byte equality/],
  ["refusal compared", (p) => p.results[2].checks = p.results[0].checks, /refusal has equality/],
  ["orphan variant", (p) => p.results[1].file = "orphan.mml", /injected file/],
  ["missing version", (p) => p.results[1].version = "4", /no as-is version/],
]) test(`rejects ${name}`, () => {
  const part = copy();
  mutate(part);
  assert.throws(() => buildReport([part]), message);
});

test("rejects missing inputs instead of reporting a successful zero population", () => {
  assert.throws(() => buildReport([]), /no result parts/);
  assert.throws(() => buildReport([{ ...copy(), results: [] }]), /empty or missing/);
});

test("report-only CLI needs no generated codecs, corpus, Ruby or XML dependency", () => {
  const dir = mkdtempSync(join(tmpdir(), "mml-report-"));
  try {
    writeFileSync(join(dir, "results-all.json"), JSON.stringify(copy()));
    const args = ["scripts/mml/run.mjs", "--report-only", "--out", dir, "--gen", join(dir, "missing")];
    const first = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    const json = readFileSync(join(dir, "report.json"), "utf8");
    assert.deepEqual(JSON.parse(json), buildReport([copy()]));
    assert.equal(readFileSync(join(dir, "report.md"), "utf8"), renderReport(JSON.parse(json)));
    const second = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readFileSync(join(dir, "report.json"), "utf8"), json);
    writeFileSync(join(dir, "results-duplicate.json"), JSON.stringify(copy()));
    const duplicate = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /duplicate case/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
