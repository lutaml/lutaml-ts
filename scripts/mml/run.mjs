#!/usr/bin/env node
// Runs real MathML documents through Ruby (Mml::V3/V4) and generated mml-ts and
// reports pass / refused-by-name / mismatch counts per suite. See docs/mml-pilot.md.
//
//   node scripts/mml/generate.mjs                       # once: generated mml-ts
//   node scripts/mml/run.mjs [--corpora DIR] [--out DIR] [--wave1 DIR] [--mml-root DIR]
//                            [--limit N] [--reuse] [--report-only]
//
// Corpora (clone read-only, never committed): DIR/{mml2,mml3,mmlcore}-testsuite
// from github.com/plurimath. Ruby runs in --wave1 (a lutaml-model checkout with
// the LML work) with `bundle exec ruby -Ilib`, against the mml 2.4.7 gem in
// --mml-root (default $LML_MML_ROOT). Nothing is stripped or rewritten except
// in the explicitly labelled "ns-injected" variant. Exit 0 = report written.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const corpora = resolve(arg("--corpora", join(REPO, "test/mml/.tmp/corpora")));
const outDir = resolve(arg("--out", join(REPO, "test/mml/.tmp/mml-run")));
const wave1 = resolve(arg("--wave1", "/Users/umerhassan/lutaml/lutaml-model-1033-worktrees/wave1"));
const mmlRoot = arg("--mml-root", process.env.LML_MML_ROOT ?? "/Users/umerhassan/.rvm/gems/ruby-3.4.8/gems/mml-2.4.7");
const genDir = resolve(arg("--gen", join(REPO, "test/mml/.tmp/mml-gen")));
const limit = Number(arg("--limit", "0"));
const reuse = process.argv.includes("--reuse");
const ALL_SUITES = ["mml2-testsuite", "mml3-testsuite", "mmlcore-testsuite"];
const onlySuite = arg("--suite", undefined);
const reportOnly = process.argv.includes("--report-only"); // re-render report.md from results-*.json
const SUITES = reportOnly ? [] : onlySuite === undefined ? ALL_SUITES : [onlySuite];
// MathML 2 and 3 suites run against Mml::V3, MathML Core against Mml::V4, unless --both-versions.
const PRIMARY = { "mml2-testsuite": "3", "mml3-testsuite": "3", "mmlcore-testsuite": "4" };
const bothVersions = process.argv.includes("--both-versions");
const VERSIONS = ["3", "4"];
const NS = "http://www.w3.org/1998/Math/MathML";

import { buildReport, renderReport } from "./report.mjs";

// Reporting saved results needs neither generated codecs nor the XML dependency.
if (reportOnly) {
  writeReport();
  process.exit(0);
}
const { canonicalTree, causeOf, squeezeWs, dump, emptyNormal, firstDiff, refusalClass, rubyClass, stable, stripWs } = await import("./lib.mjs");

function walk(dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (name.endsWith(".mml")) acc.push(path);
  }
  return acc;
}

function runRuby(version, files, tag) {
  const jsonl = join(outDir, `ruby-v${version}-${tag}.jsonl`);
  if (!(reuse && existsSync(jsonl))) {
    const list = join(outDir, `files-${tag}.txt`);
    writeFileSync(list, files.join("\n") + "\n");
    // LML_RUBY_DIRECT=1 skips Bundler and uses the installed gems of the active Ruby
    // (GEM_HOME); the report is then not Bundler-resolved parity.
    const rubyArgs = ["-Ilib", join(REPO, "scripts/mml/ruby_oracle.rb"), version, list, jsonl];
    const [cmd, args] = process.env.LML_RUBY_DIRECT === "1" ? ["ruby", rubyArgs] : ["bundle", ["exec", "ruby", ...rubyArgs]];
    const r = spawnSync(cmd, args, {
      cwd: wave1, env: { ...process.env, LML_MML_ROOT: mmlRoot }, encoding: "utf8", maxBuffer: 1 << 28,
    });
    if (r.status !== 0) throw new Error(`ruby oracle failed (v${version} ${tag}):\n${r.stderr}`);
  }
  return new Map(readFileSync(jsonl, "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((r) => [r.file, r]));
}

mkdirSync(outDir, { recursive: true });
const suiteOf = new Map();
let all = [];
for (const suite of SUITES) {
  const dir = join(corpora, suite);
  if (!existsSync(dir)) throw new Error(`missing corpus ${dir} (git clone --depth 1 https://github.com/plurimath/${suite})`);
  let files = walk(dir);
  if (limit > 0) files = files.slice(0, limit);
  for (const f of files) suiteOf.set(f, suite);
  all = all.concat(files);
}

// Variant "as-is" runs files untouched. Variant "ns-injected" adds the MathML
// namespace to a root <math> that has none (the only rewrite; written to outDir).
const injectedDir = join(outDir, "injected");
const variants = { "as-is": new Map(all.map((f) => [f, f])), "ns-injected": new Map() };
let hasNs = 0;
for (const f of all) {
  const text = readFileSync(f, "utf8");
  const root = text.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[^>]*(\[[\s\S]*?\])?\s*>/i, "").match(/<math\b[^>]*>/);
  if (root && !/\sxmlns\s*=/.test(root[0])) {
    const target = join(injectedDir, relative(corpora, f));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text.replace(/<math\b/, `<math xmlns="${NS}"`));
    variants["ns-injected"].set(f, target);
  } else hasNs++;
}

const results = [];
for (const version of VERSIONS) {
  const mod = await import(pathToFileURL(join(genDir, `v${version}`, "js/ts/index.js")).href);
  const codec = mod.xml.CODECS[`Mml::V${version}::Math@mml_v${version}`];
  for (const [variant, map] of Object.entries(variants)) {
    const wanted = new Map([...map].filter(([orig]) => bothVersions || PRIMARY[suiteOf.get(orig)] === version));
    if (wanted.size === 0) continue;
    const ruby = runRuby(version, [...wanted.values()], `${onlySuite ?? "all"}-${variant}`);
    for (const [orig, file] of wanted) {
      const r = ruby.get(file);
      const text = readFileSync(file, "utf8");
      const rec = { suite: suiteOf.get(orig), version, variant, file: relative(corpora, orig), comments: /<!--/.test(text) };
      let ts, tsErr;
      const started = performance.now();
      try {
        ts = await codec.parse(text);
      } catch (e) {
        tsErr = e?.info ?? { reason: "crash", detail: `${e?.name}: ${e?.message}` };
      }
      if (!r.ok && tsErr) { rec.outcome = "both_refuse"; rec.cls = `ruby ${rubyClass(r)} | ts ${refusalClass(tsErr)}`; }
      else if (!r.ok) { rec.outcome = "mismatch"; rec.cls = `ruby refuses, ts accepts: ${rubyClass(r)}`; }
      else if (tsErr) { rec.outcome = /DOCTYPE/i.test(tsErr.detail ?? "") ? "refused" : "refused_by_ts_only"; rec.cls = refusalClass(tsErr); rec.detail = tsErr.detail; }
      else {
        try {
          const tsXml = await codec.stringify(ts);
          const rt = await canonicalTree(r.output), tt = await canonicalTree(tsXml);
          const treeExact = stable(rt) === stable(tt);
          const treeWs = treeExact || stable(stripWs(rt)) === stable(stripWs(tt));
          const rd = r.data, td = dump(ts);
          const dataExact = stable(rd) === stable(td);
          const dataNorm = dataExact || stable(emptyNormal(rd)) === stable(emptyNormal(td));
          rec.checks = { treeExact, treeWs, dataExact, dataNorm, bytes: r.output === tsXml };
          if (treeWs && dataNorm) { rec.outcome = "pass"; rec.cls = dataExact ? "pass" : "pass (data equal after empty/absent/null collapse)"; }
          else {
            rec.outcome = "mismatch";
            const dData = dataNorm ? null : firstDiff(emptyNormal(rd), emptyNormal(td));
            const dTree = treeWs ? null : firstDiff(stripWs(rt), stripWs(tt));
            const squeezed = !treeWs && stable(squeezeWs(stripWs(rt))) === stable(squeezeWs(stripWs(tt)));
            rec.cls = causeOf(dData, dTree, squeezed);
            rec.detail = dData ?? dTree;
            if (dData && dTree) rec.detail += ` || tree ${dTree}`;
          }
        } catch (e) {
          rec.outcome = "mismatch"; rec.cls = "ts write/compare failed"; rec.detail = `${e?.info?.detail ?? e?.message}`;
        }
      }
      rec.ms = Math.round(performance.now() - started);
      results.push(rec);
      if (results.length % 250 === 0) console.error(`${results.length} compared (v${version} ${variant})`);
    }
  }
}

if (!reportOnly) writeFileSync(join(outDir, `results-${onlySuite ?? "all"}.json`), JSON.stringify({ mml_version: "2.4.7", suite: onlySuite ?? "all", files: all.length, hasNs, results }, null, 1));
if (process.argv.includes("--no-report")) process.exit(0);

// ---- report: reject overlapping or inconsistent saved runs before writing totals.
writeReport();
function writeReport() {
  const names = readdirSync(outDir).filter((n) => /^results-.*\.json$/.test(n)).sort();
  const parts = names.map((n) => JSON.parse(readFileSync(join(outDir, n), "utf8")));
  const report = buildReport(parts);
  const markdown = renderReport(report);
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(outDir, "report.md"), markdown);
  console.log(markdown);
}
