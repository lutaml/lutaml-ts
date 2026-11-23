// Dependency-free aggregation of saved, per-case run.mjs results. No fresh run is implied.
const SUITES = ["mml2-testsuite", "mml3-testsuite", "mmlcore-testsuite"];
const OUTCOMES = ["pass", "refused", "refused_by_ts_only", "both_refuse", "mismatch"];
const CHECKS = ["treeExact", "treeWs", "dataExact", "dataNorm", "bytes"];
const key = (...values) => JSON.stringify(values);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function requireValid(ok, message) {
  if (!ok) throw new Error(`Invalid MathML results: ${message}`);
}

function summarize(rows) {
  const outcomes = Object.fromEntries(OUTCOMES.map((name) => [name, 0]));
  const equality = Object.fromEntries(CHECKS.map((name) => [name, { equal: 0, different: 0, unavailable: 0 }]));
  for (const row of rows) {
    outcomes[row.outcome]++;
    for (const name of CHECKS) {
      equality[name][row.checks === undefined ? "unavailable" : row.checks[name] ? "equal" : "different"]++;
    }
  }
  return { cases: rows.length, outcomes, equality };
}

export function buildReport(parts) {
  requireValid(Array.isArray(parts) && parts.length > 0, "no result parts");
  const profiles = parts.map((part) => part.oracle_profile ?? null);
  for (const profile of profiles) {
    requireValid(profile === null || (typeof profile.escape_entities === "boolean" && ["bundler", "installed-gems"].includes(profile.dependency_mode)), "invalid oracle profile");
  }
  const profileKey = (p) => p === null ? "legacy-unrecorded" : key(p.escape_entities, p.dependency_mode);
  requireValid(new Set(profiles.map(profileKey)).size === 1, "mixed Ruby oracle profiles");
  const identities = new Set();
  const rows = [];
  for (const part of parts) {
    requireValid(part?.mml_version === "2.4.7", "expected mml_version 2.4.7");
    requireValid(part.suite === "all" || SUITES.includes(part.suite), "unknown part suite");
    requireValid(Array.isArray(part.results) && part.results.length > 0, "empty or missing results");
    const originals = new Set(), injected = new Set();
    for (const row of part.results) {
      requireValid(row && SUITES.includes(row.suite), "unknown case suite");
      requireValid(part.suite === "all" || part.suite === row.suite, "case outside part suite");
      requireValid(["3", "4"].includes(row.version), "unknown version");
      requireValid(["as-is", "ns-injected"].includes(row.variant), "unknown variant");
      requireValid(typeof row.file === "string" && row.file.length > 0, "missing case file");
      const id = key(row.suite, row.version, row.variant, row.file);
      requireValid(!identities.has(id), `duplicate case ${id}; use all-suite OR per-suite results, not overlapping runs`);
      identities.add(id);
      requireValid(OUTCOMES.includes(row.outcome), `unknown outcome for ${id}`);
      requireValid(typeof row.cls === "string" && row.cls.length > 0, `missing classification for ${id}`);
      if (row.checks !== undefined) {
        requireValid(row.checks && CHECKS.every((name) => typeof row.checks[name] === "boolean"), `incomplete equality checks for ${id}`);
        requireValid(["pass", "mismatch"].includes(row.outcome), `refusal has equality checks for ${id}`);
        requireValid((!row.checks.treeExact || row.checks.treeWs) && (!row.checks.dataExact || row.checks.dataNorm), `inconsistent exact/normalized checks for ${id}`);
        requireValid(!row.checks.bytes || row.checks.treeExact, `byte equality without exact tree equality for ${id}`);
        requireValid((row.outcome === "pass") === (row.checks.treeWs && row.checks.dataNorm), `outcome disagrees with equality checks for ${id}`);
      } else requireValid(row.outcome !== "pass", `pass missing equality checks for ${id}`);
      const original = key(row.suite, row.file);
      (row.variant === "as-is" ? originals : injected).add(original);
      rows.push(row);
    }
    requireValid([...injected].every((id) => originals.has(id)), "injected file has no as-is case");
    requireValid(Number.isSafeInteger(part.files) && part.files === originals.size, `files metadata ${part.files} differs from ${originals.size} unique as-is files`);
    requireValid(Number.isSafeInteger(part.hasNs) && part.hasNs === originals.size - injected.size, `hasNs metadata ${part.hasNs} disagrees with variant membership`);
    // Every version of an injected file must have its corresponding untouched case.
    for (const row of part.results.filter((r) => r.variant === "ns-injected")) {
      requireValid(identities.has(key(row.suite, row.version, "as-is", row.file)), "injected case has no as-is version");
    }
  }
  rows.sort((a, b) => compare(key(a.suite, a.version, a.variant, a.file), key(b.suite, b.version, b.variant, b.file)));
  const groups = [];
  for (const suite of SUITES) for (const version of ["3", "4"]) for (const variant of ["as-is", "ns-injected"]) {
    const subset = rows.filter((row) => row.suite === suite && row.version === version && row.variant === variant);
    if (subset.length) groups.push({ suite, version, variant, ...summarize(subset) });
  }
  const classes = new Map();
  for (const row of rows.filter((r) => r.outcome !== "pass")) {
    const id = key(row.outcome, row.cls);
    if (!classes.has(id)) classes.set(id, { outcome: row.outcome, classification: row.cls, cases: 0, example: { suite: row.suite, version: row.version, variant: row.variant, file: row.file, ...(typeof row.detail === "string" ? { detail: row.detail } : {}) } });
    classes.get(id).cases++;
  }
  const uniqueFiles = new Set(rows.map((r) => key(r.suite, r.file))).size;
  const injectedFiles = new Set(rows.filter((r) => r.variant === "ns-injected").map((r) => key(r.suite, r.file))).size;
  return {
    schema_version: 1,
    mml_version: "2.4.7",
    oracle_profile: profiles[0],
    population: { uniqueFiles, unmodifiedFiles: uniqueFiles - injectedFiles, injectedFiles },
    // totals count executions, including overlapping variants/versions, never unique documents.
    totals: summarize(rows),
    groups,
    classes: [...classes.values()].sort((a, b) => b.cases - a.cases || compare(key(a.outcome, a.classification), key(b.outcome, b.classification))),
  };
}

export function renderReport(report) {
  const lines = [
    `# mml pilot: ${report.population.uniqueFiles} unique .mml files; ${report.totals.cases} case executions; mml ${report.mml_version}`,
    "",
    `Ruby oracle: ${report.oracle_profile === null ? "legacy profile not recorded" : JSON.stringify(report.oracle_profile)}.`,
    "",
    "Variants and versions overlap on original files. Totals count executions; compare each suite/version/variant separately. Refusals are separate outcomes, not passes or equality results.",
    "",
    "| suite | version | variant | cases | pass | refused: doctype | refused by ts only | both refuse | mismatch |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const group of report.groups) {
    lines.push(`| ${group.suite} | v${group.version} | ${group.variant} | ${group.cases} | ${OUTCOMES.map((name) => group.outcomes[name]).join(" | ")} |`);
  }
  lines.push("", "## Equality across case executions", "", "Unavailable includes parse refusals and write/compare failures; it is never equality.", "", "| check | equal | different | unavailable |", "|---|---|---|---|");
  for (const [name, counts] of Object.entries(report.totals.equality)) lines.push(`| ${name} | ${counts.equal} | ${counts.different} | ${counts.unavailable} |`);
  lines.push("", "TreeWs drops formatting whitespace; dataNorm collapses empty/absent/null. A pass requires both. Neither implies byte equality. report.json includes the same equality counters per suite/version/variant.", "", "## Non-pass classifications", "");
  for (const entry of report.classes) {
    const e = entry.example;
    lines.push(`- ${entry.cases}x ${entry.outcome} | ${entry.classification}; e.g. ${e.suite} v${e.version} ${e.variant} ${e.file}${e.detail ? `\n    ${e.detail.slice(0, 200)}` : ""}`);
  }
  return lines.join("\n") + "\n";
}
