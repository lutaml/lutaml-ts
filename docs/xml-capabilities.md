# XML facade capabilities (moxml-ts probe)

Probe: `node scripts/probe-moxml.mjs` (add `--json` for machine output).
Test: `npm test -- --run test/xml_capabilities`.
Exit codes: 0 all observations match, 1 drift, 2 moxml-ts not installed
(a precise `MOXML_TS_UNAVAILABLE` error; the vitest cases then skip, never pass).

## Pin and install

- `lutaml/moxml-ts` draft PR #9 head `a78091f7b11bb350fdd18a8dc6e12b3ae39661fd` (package version 0.1.0),
  a git dependency in `package.json`; `npm ci` runs its `prepare` script (fetches the wasm bundles and builds
  `dist/`). The probe checks the version, the locked commit and a sha256 prefix of each vendored wasm bundle.
- Not on npm. When it is not installed the probe exits 2 with `MOXML_TS_UNAVAILABLE` and the vitest cases skip.
- Wasm init is lazy: `await parse(xml)` works under Node with no explicit `initEngine()`.

## Findings (31 cases; 22 supported, 3 partial, 3 absent, 3 unsafe)

Changed since the 07a pin (b0183ed): `Node` now has namespace accessors and in-scope/declared namespace lists,
`attributes()` and `getAttribute()`, `declareNamespace`, `setAttributeNS`, and `Document.createElementNS`;
`createElement` validates names (BLD-03 is now supported).

| Face | State | Detail |
|---|---|---|
| Namespace URI / prefix | supported | `namespaceUri()`, `prefix()`, `localName()`, `qualifiedName()`, `inScopeNamespaces()`, `declaredNamespaces()` on `Node` (NS-02, NS-03, NS-05). The `namespace::` axis still yields nameless nodes (NS-04, partial). |
| Attribute reads | partial | `attributes()` lists name, prefix, local name, URI and value in document order; `getAttribute(name)`; XPath attribute nodes still have empty name/text; no `removeAttribute` (ATTR-03). |
| Ordered mixed content | supported | `children()` gives text/element/CDATA/comment/PI in order, whitespace kept, adjacent CDATA separate (MIX-01). `text()` is empty for CDATA/comment/PI; data via `string(/a/node()[i])` (MIX-02). |
| CDATA | supported | Detected (kind 4); `Document.createCData` creates sections, which the writer uses for `cdata: true` rules and parsed CDATA tokens (a value containing `]]>` is refused by name). |
| Builder / serialization | partial | `createElement`/`createElementNS`/`setAttributeNS`/`addChild`/`setRoot` with escaping round-trip; `createElementNS` repeats a declaration already in scope, so the 07b writer tracks bindings and uses `createElement` for a bound prefix (BLD-05). TAB, LF and CR in attribute values are written as character references and survive a re-read (SER-04; the earlier pin dropped TAB/LF). CDATA/comment/PI creation exists and the writer uses it for `cdata: true` output; no `removeAttribute`, no `toXml` options (BLD-04, SER-03). |
| Parser policy | partial | External entities are NOT fetched (XXE-safe: POL-02/03); malformed and 20000-deep input throw a generic status -2 error (POL-01/07). No entity-expansion limit (POL-06), DOCTYPE accepted, duplicate attributes and unbound prefixes accepted (ATTR-04, POL-08), no parse options (POL-09). |

## Consequences for 07b/07c

- Reader: use `children()` for order and the `Node` namespace/attribute accessors; attribute order is available from `attributes()`.
- Writer: element/attribute/text/CDATA through the builder; pretty-printing is absent upstream (byte equality with Ruby's pretty output is not claimed).
- Guard input size and reject DOCTYPE before `parse` (no facade policy). Error context (line/column) is absent.

Upstream references: `lutaml/moxml-ts#9` (Node/Document faces), `lutaml/leptris-rs#22`. moxml-ts was not edited.

## Generated codec contract

The facade observations above describe the XML dependency. Consumers of generated
LML codecs also pass through the guards in `src/xml/runtime-source.ts`; a facade
probe alone does not establish the generated codec's accepted input or output.

- The generated parser refuses DOCTYPE before calling the dependency because its
  parser has no entity-expansion limit. It also applies document limits. The
  refusal is covered by `test/xml/xml.test.ts`; accepting a document in a direct
  facade probe does not mean the generated codec accepts it.
- CDATA is read and written (`createCData`); a value containing `]]>` is a named
  `not_serializable` refusal. Ordered-content comments and
  processing instructions are named `invalid_ordered_content` refusals.
- The pinned dependency refuses elements with more than 255 attributes before
  entering its wasm engine. The XML regression suite checks both the boundary
  and a successful parse after a refusal.
- XML tree equality, model-data equality and byte equality are separate results.
  The MathML runner writes their counters from per-case evidence; see
  [the pilot report instructions](mml-pilot.md). A successful tree comparison does
  not establish Ruby-identical prefixes, whitespace or lexical output.

For JSON interoperability, generated codecs consume Ruby's explicit
`Lml.portable_json` profile. It writes integer and decimal values as strings;
ordinary Ruby `to_json` is a different wire profile. The shared fixture and
`test/json/ruby-interop.test.ts` cover generated readers and writers, including
integers above JavaScript's safe-number range. LML carries declarations and data;
serialization and application writer behavior remain in each target.

These source contracts and test references are not a claim of a fresh facade or
full-corpus run. Report executed commands, input revisions, refusal counts and
comparison modes alongside any compatibility percentage.
