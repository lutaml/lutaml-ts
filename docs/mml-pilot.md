# mml-ts pilot: generated TypeScript vs Ruby mml on real MathML

Historical first-slice pilot for lutaml-model#1033 (card 07c). TypeScript models and XML
codecs are generated from the real mml LML package (graphs `v3-math-nested`,
`v4-math-nested`, exported from Ruby mml 2.4.7) and checked against Ruby
`Mml::V3` / `Mml::V4` on real MathML. The historical observations below span
several implementation stages; they are not a conformance result for the current revision. The report tooling changes
no XML runtime behavior.

## Reproduce

```sh
npm ci && npm run build
node scripts/mml/generate.mjs        # models + xml codecs for v3 (194 models) and v4 (195), strict-tsc compiled
for name in mml2-testsuite mml3-testsuite mmlcore-testsuite; do
  git clone --depth 1 "https://github.com/plurimath/$name" "test/mml/.tmp/corpora/$name"
done
LML_MML_ROOT=<mml-2.4.7 gem root> node scripts/mml/run.mjs --suite <name> --no-report   # one per suite
node scripts/mml/run.mjs --report-only                                                    # report.json + report.md
node --test test/mml/report.node.mjs                                                      # dependency-free report regressions
npm test -- --run test/mml
```

`run.mjs` runs Ruby (`scripts/mml/ruby_oracle.rb`, `bundle exec ruby -Ilib` in a
lutaml-model checkout with the LML work, `--wave1`) and the generated TS on the
same file, then compares. `test/mml/.tmp/` is git-ignored (`test/mml/.gitignore`).
Graph source: `$LML_MML_FIXTURES` or the wave1 worktree `spec/fixtures/lml_mml`.
Use a separate `--out DIR` for each corpus selection, limit and configuration.
Record the corpus commit IDs, graph sources, TS revision and Ruby oracle
checkout/configuration alongside the results when producing new evidence.
Within that directory keep either `results-all.json` or disjoint per-suite
`results-<suite>.json`, never overlapping saved runs. `--reuse` reuses the Ruby
oracle cache; it does not verify that corpus contents or oracle configuration
are unchanged. Use a new output directory when either changes.

`--report-only --out DIR` reads saved per-case results without loading generated
models, moxml-ts, corpora or Ruby. It writes deterministic `report.json` (schema
version 1) and `report.md`; it performs no new comparisons. Invalid input exits
nonzero before writing reports. Remove stale reports after a failed invocation.
The reporter rejects duplicate suite/version/variant/file identities, unknown
outcomes, missing pass checks, contradictory equality checks, and metadata that
disagrees with the unique files and variant membership in the saved results.

`report.json` separates `population.uniqueFiles` (original documents) from
`totals.cases` (executions across overlapping variants and versions). Each
`groups` entry has its suite, version, variant, outcome counts and equality
counters. The five mutually exclusive outcomes retain the raw runner names:
`pass`, `refused` (DOCTYPE), `refused_by_ts_only`, `both_refuse`, `mismatch`.
Each equality check (`treeExact`, `treeWs`, `dataExact`, `dataNorm`, `bytes`)
counts `equal`, `different`, and `unavailable` separately; unavailable includes
refusals and write/compare exceptions. Equality is counted across all cases,
including mismatches where only some checks succeed. Refusal never counts as a
pass. `population.unmodifiedFiles` corresponds to legacy `hasNs` metadata: files
not namespace-injected, including inputs without a recognized `<math>` root.
Timings are omitted from reports so reordering identical results cannot change
the output. Raw result files retain per-case details and timings.

The committed `test/mml/fixtures/report-results.json` is a synthetic seven-case
reporting fixture, **not** a new corpus result. Its tests cover every outcome,
variant overlap, cross-version sampling, equality availability, inconsistent
metadata, duplicate input parts and the dependency-free report-only CLI.

The historical inventory selected `*.mml` only (4470 files): mml2 (712, run on V3), mml3 (1675, V3),
mmlcore (2083, V4). `.xml`/`.xhtml` pages in the suites are not MathML documents and are not run.

## What is compared

For each file Ruby `from_xml` then `to_xml`, TS `parse` then `stringify`.

- **tree**: both serialized outputs parsed by moxml-ts into a canonical tree
  (element name+namespace, sorted attributes, text; prefixes ignored). Ruby always
  pretty-prints (`pretty: false` is ignored by mml 2.4.7), so whitespace-only text
  between elements is dropped on both sides; text is never trimmed.
- **data**: Ruby's neutral model dump (the 05a oracle form) vs the TS model dump.
  Ruby reads an absent collection as `[]` and TS as `null`; the comparison treats
  `null`, `[]` and `{"state":"absent"}` as the same (historical reports used this normalization; see the snapshot caveat below).
- `pass` = tree equal and data equal under those two rules. This does not establish byte equality. The historical prose reported 0 byte-equal outputs among 4019 passes (its relation to the table below is unverified); no saved per-case evidence is committed here to reproduce that sample.
- Two variants: **as-is** (file untouched) and **ns-injected** (only for files whose root `<math>` has no `xmlns`, one attribute is added; written to `.tmp`, the corpus is untouched). This variant was introduced when Ruby accepted namespace-less `<math>` and TS refused it; the earlier snapshot attributed 2625 namespace refusals to that behavior.
- Nothing else is stripped or rewritten. DOCTYPE files go to TS as they are.

## Historical snapshots (mml 2.4.7; not current-run evidence)

The following table was recorded as "after T4 namespace-less roots, T6
any_attribute". The accompanying headline was **5717 of 6217** comparisons
passing. That headline conflicts with the three as-is rows, whose arithmetic
sum is **4250 of 4470**; neither is a freshly verified corpus result. The
namespace-injected rows overlap the original documents and cannot resolve the
headline discrepancy by addition. Saved raw results and corpus revisions for
these historical figures are absent from this checkout. Keep the discrepancy
explicit until original results are recovered or a pinned run is performed.
Use the generated report from that run for exact counts and sample sizes.

| suite | ruby | variant | files | pass | refused by name | mismatch |
|---|---|---|---|---|---|---|
| mml2 | V3 | as-is | 712 | 690 | 15 (11 TS only, 4 both) | 7 |
| mml2 | V3 | ns-injected | 712 | 690 | 15 | 7 |
| mml3 | V3 | as-is | 1675 | 1644 | 30 (DOCTYPE) | 1 |
| mmlcore | V4 | as-is | 2083 | 1916 | 115 (2 TS only, 113 both) | 52 |
| mmlcore | V4 | ns-injected | 2035 | 1871 | 113 (1 TS only, 112 both) | 51 |

These are historical row counts, not a current pass-rate claim. Compare suite/version/variant groups separately.
The later snapshot listed these remaining mismatch classes: attribute-value whitespace (TS follows the XML spec, libxml2 keeps literal LF/TAB), undefined entity references (input not well-formed), whitespace-only text and empty-text tokens in a few element-only cases. Both sides refuse comments/PIs in ordered content.
First run (before T4/T6), for comparison: mml2 as-is 0/712, mml3 1638/1675, mmlcore as-is 44/2083; 185 mismatches were catch-all attributes, reported as 0 in the later snapshot.

## Pinned run at the delivered head (installed-gem Ruby, not Bundler-resolved)

Corpora: plurimath mml2-testsuite c87d85ee, mml3-testsuite e8d57c5, mmlcore-testsuite 4e00baa9 (shallow clones). Ruby 3.4.8 with
`LML_RUBY_DIRECT=1` (installed gems, mml 2.4.7, moxml 0.6.16; Bundler dependencies were incomplete, so this is not
Bundler-resolved parity). 4470 files, 7217 case executions; pass 6810 (mml2 as-is 690, ns-injected 690, mml3 1645,
mmlcore as-is 1915, ns-injected 1870), unchanged except mml3 (1644 to 1645) after the `xml:lang` fix. Bytes equal: 0 (tree and data
equality are separate counters in report.json). The 4250/4470 and 5717/6217 historical figures above are superseded by this run.

## F2 residual classes after the text, whitespace and attribute fixes

Measured by re-comparing the saved Ruby output of the pinned run above against the fixed TS (same comparator, no new Ruby run);
the final full run supersedes these counts. Per-case rows are in the F2 evidence, not here.

| family | rows | cause (checked against the raw inputs) | state |
|---|---|---|---|
| empty text token, lone child element (`<mi><span/></mi>`, `<ms><mfrac/></ms>`) | 23 | Ruby `XmlElement#text` joins text nodes into one string for at most one child node | fixed |
| whitespace-only literal text in mixed models without a content rule (`<set> </set>`) | 22 | Ruby skips whitespace-only literal tokens when writing | fixed |
| TAB/LF in attribute values (`&#10;` in `style`, `width`) | 38 | valid XML; the old moxml-ts pin dropped TAB/LF when serializing | fixed by the moxml-ts 77d01eb pin (leptris-wasm 1.9.0): cached re-comparison of these 38 rows passes |
| single-valued text content over several child nodes (mrow-like-002 `annotation`) | 2 | Ruby scalar-content extraction was corrected to preserve the declared string shape; collections keep their text pieces | TS preserves the scalar string and meaningful whitespace; focused regression passes, final corpus rerun pending |
| `&amp;name;` text (valid XML) | 28 | data equal; Ruby writes `&name;` unescaped, so its own output is not well-formed and is recovered differently when compared | unfixable in TS without writing malformed XML; stays a mismatch |
| bare `&name;` without a DTD, several roots, non-MathML root, repeated singleton `mprescripts` | 31 | invalid XML or contract refusal | refused by name by TS; Ruby recovers |

## Historical refusal classifications

These counts are from earlier snapshots, including the pre-T4 namespace
behavior, and do not share a demonstrated denominator with the table above.
Current reports count refusals separately from passes and mismatches.

| class | count | note |
|---|---|---|
| `refused: doctype` ("DOCTYPE is refused: the parser has no entity-expansion limit") | 30 | all mml3 (`Characters/EntityNames/*`). By design (07b). Nothing was stripped. |
| `refused: root/namespace` (`expected root element math in http://www.w3.org/1998/Math/MathML, found math`) | 2625 | rows of the as-is variant whose root has no `xmlns` (mml2 and mmlcore; Ruby parses them). Ruby accepts any root namespace; TS enforces it (as in the 07b `person-wrong-namespace` override). |
| `refused: malformed XML` (`leptris parse failed (status -2)`) | 18 rows (9 files) | files with several root elements, e.g. mml2 `ErrorHandling/BadChildren/emptyContent1.mml`; libxml2 recovers, the TS parser refuses. |
| both refuse: comments in ordered content | 233 rows | Ruby raises `Lml::RejectedError ... invalid_ordered_content (__lml_content: comment nodes ...)` while the oracle captures ordered content; TS raises `invalid_ordered_content: comments and processing instructions have no ordered-content token` (or the namespace refusal first, as-is). Same named reason on both sides; Ruby's plain `to_xml` for these files was not compared. 124 as-is files contain a comment. |

## Historical mismatch classes (292 rows, before the fixes noted above)

This earlier sample includes 185 catch-all attribute mismatches that the later
snapshot says were fixed. It is a taxonomy and source of candidate regressions,
not evidence that those defects remain at the current head.

| class | rows | example |
|---|---|---|
| Catch-all attributes: Ruby `map_all_attributes to: :other_attributes` has no rule in the LML graph, so TS never reads them and silently drops them on write | 185 | mmlcore `crashtests/mozilla/394150-1.mml`: `<emptyset id="emptyset">`, Ruby `other_attributes={"id":"emptyset"}`, TS `null`, attribute absent from TS output |
| Empty or whitespace-only text node: Ruby records an ordered-content text token, TS records none | 59 | mml2 `Topics/WhiteSpace/invChars.mml`: `/mn_value/0/__lml_content` Ruby `[{"attribute":"value","index":0,"kind":"text"}]`, TS `null` (tree equal) |
| Whitespace in values: Ruby (libxml2) keeps literal LF/TAB/CR in attribute values, TS follows the XML spec and normalizes them to spaces | 17 | mmlcore `relations/css-styling/lengths-2.math1.mml` |
| Undefined entity reference (input not well-formed XML): parsers recover differently | 16 | mml2 `ErrorHandling/BadEntities/badEntity1.mml`: Ruby `"&foo;"`, TS `"&foo"` |
| Whitespace-only text: TS keeps it, Ruby drops it | 11 | mml2 `Content/TheoryOfSets/list/list-empty.mml`: Ruby no text, TS `" "` |
| Ordered-content token list differs | 2 | mmlcore `crashtests/mozilla/412237-1.mml` (`ms` element) |
| `xml:lang` read by Ruby into `lang`, not by TS | 1 | mml3 `General/GenAttribs/xmllang1.mml`: Ruby `lang="en-us"` |
| Text split around a comment: Ruby keeps two values, TS joins them | 1 | mmlcore `presentation-markup/mrow/legacy-mrow-like-elements-002.math0.mml` |

Top causes by weight: catch-all attributes (63%), empty-text tokens (20%).

## Historical findings for the runtime and exporter owners

The numbered observations retain the original pilot context. Reproduce a case
against the current head before treating it as an open defect. In particular,
namespace-less roots and catch-all attributes changed after the first snapshot.

1. **Exporter / graph gap (lutaml-model, `lib/lutaml/model/lml`)**: `map_all_attributes` in the mml source (`universal_presentation_attributes.rb:42`, `content/wildcard_attributes.rb:16`) is exported as a `hash` attribute `other_attributes` with no XML rule, so TS cannot reproduce it. Failing case above. Either export a catch-all rule kind or have the generator/emitter refuse it by name; at that stage TS lost data without a refusal.
2. **Reader (`src/xml/runtime-source.ts`, ordered-content capture)**: an empty element in an ordered/mixed mapping (`<mo></mo>`, `<mn> </mn>`) yields no text token in TS, one in Ruby. Case: mml3 `Characters/Blocks/00000_C0_Controls_and_Basic_Latin.mml` (`mtd/mo`).
3. **Reader performance (`src/xml/runtime-source.ts`, `kids()`/`el.node.children()` and xpath position paths)**: parse is superlinear. An 8.5 KB table (`Characters/Blocks/00080_C1_Controls_and_Latin-1_Supplement.mml`) takes 0.4-0.6 s warm; mml3 `TortureTests/Complexity/complex3.mml` took 98 s (and 122 s on an earlier run) for parse+write+compare, `TortureTests/Size/m1000.mml` 9 s. A full-corpus run needs about 25 minutes on three parallel processes.
4. **Writer**: output uses the `mml:` prefix and no whitespace; correct as a tree but not byte-identical to Ruby (0 of 4019 passes). No byte replay of Ruby output is possible without a prefix policy.
5. **Reader leniency**: Ruby accepts a root in any namespace; TS refuses (2625 files). Keep, but the corpora show that real MathML often has no `xmlns`; a decision is needed for the product.

## Not covered

Browser run (`node test/browser_mml/run.mjs`), the wasm pins, the XML writer emission (`src/xml/writer*.ts`) and the `examples/mml-ts/` package from the full card text are not part of this first slice. Cross-version runs (mml2/3 on V4, mmlcore on V3) were not run. Ruby `to_xml` output was not compared for files where the oracle refused. Real-time figures were measured on a shared machine and vary.

## Tests

`node --test test/mml/report.node.mjs` checks report aggregation without external
dependencies. It does not exercise the XML runtime or establish fresh corpus
results. `test/mml/report.test.ts` runs this same suite through Vitest, so the
existing `npm test -- --run` CI command includes it.

`test/mml/mml.test.ts`: the committed `test/mml/fixtures/{oracle.json,v3-mi-mixed.json,v4-mi-mixed.json}` generate, compile under strict tsc and replay the Ruby oracle for the mixed cases; the 4 MB nested-Math graphs are read from `$LML_MML_FIXTURES` (skipped, never passed, when absent). It also unit-tests the comparison helpers and, when a corpus run exists, checks every row has a known outcome and that no mismatch is unclassified.
