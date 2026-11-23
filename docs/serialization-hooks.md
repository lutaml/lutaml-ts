# Handwritten serialization hooks (key-value and XML)

A rule carries only hook NAMES (`custom: {to?, from?}`); bodies never travel in a bundle, nothing is evaluated or
transpiled, and the generator emits a typed interface per hooked model that the consumer implements by hand.

## Contract (shared with the Ruby producer)
- `custom` is valid on key-value rules and on XML `content`, `element` and `attribute` rules; not on `any_attribute`,
  `sequence` or `choice` (`unsupported_mapping`). A rule with `custom` may omit `to` (hook-only rule).
- Strict shape: non-empty object, keys `to`/`from` only, names `[A-Za-z_][A-Za-z0-9_]*`, `to != from` (`invalid_document`).
- One hook name = one direction and one signature kind (key-value or xml) per model.
- A hook cannot drive an ordered or mixed XML mapping (`imperative_element_order`).
- Shared fixture: `test/fixtures/ts_generated/xml_hooks_bundle.json`, checksum
  `sha256:a8521cab2de342127d6e109d21b6ad531cd946893133afc4710666f27756d613` (asserted in `test/xml/hooks.test.ts`).

## XML (`xml/index.ts`)
- Write hook `(model, parent, builder, state) => void | Promise<void>` writes the rule's WHOLE output; the generated
  writer never also writes the ordinary value. `builder` is `XmlWriteBuilder`: `element`, `text`, `attribute`, and
  `markup(parent, text)`, which parses well-formed markup in no namespace and appends its nodes through moxml-ts document
  operations (no escaping, no string substitution; malformed markup is refused, not repaired).
- Read hook, rule with a declared target: `(value: string, state, context) => declared value | undefined`. It runs BEFORE
  construction and its result is a typed patch the model constructor validates (required included). `undefined` leaves the
  attribute unset. A hook-only rule: `(model, value, state, context) => void`, after construction; its output is the state.
- `withHooks(hooks, state)` returns every codec BOUND to the hooks and state; each operation carries them itself (also
  `parse(text, {hooks, state})`, `encode`, `stringify`). There is no ambient scope, so concurrent operations never share
  hooks or state; the XML writer is therefore asynchronous end to end.
- A rule reached without an installed handler fails `custom_serialization` (model, rule); read and write are independent.
  Content rules with a declared target are reached on every read; attribute/element rules when present; hook-only content
  when the element has text.

## Key-value (`json/`, `yaml/`)
- Hook-only rules keep `(model, value, state)` after construction. A rule with a declared target AND `from` now returns the
  declared value BEFORE construction: `(value, state) => Init[to] | undefined` (previously the hook ran after construction,
  so a required declared attribute failed validation before the hook could supply it; reproduced old-red).
- `withHooks(hooks, state, fn)` is an ambient SYNCHRONOUS scope for the synchronous codecs; a Promise-returning `fn` is
  refused by name rather than silently losing the scope.

## Real consumers
`test/pilots/unit` (UnitsML: generated 11-model graph, handwritten `Symbol` content hooks, 13 Ruby-recorded cases) and
`test/pilots/uncertainty` (25 key-value hooks). Tree, data and bytes are reported separately; bytes are not claimed equal.

## Defaults, scalar content and CDATA (generated models and XML/JSON writers)
- **Default provenance.** A member the constructor filled from its declared default is "applied"; the constructor records
  that in a nonserialized weak side table (`rt.markApplied` / `rt.wasApplied`), not in a field, so it cannot collide with a
  member and does not show in `Object.keys`, dumps or equality. `render.default: false` (also when the key is absent, as in
  Ruby) skips an applied default on JSON and XML write; `render.default: true` writes it. An explicit value equal to the
  default (`false`, `0`, the default text) is NOT applied and is written; `null` follows the nil policy. Decode follows the
  same rule (a missing member is applied, a present one is explicit). Nested models carry their own provenance. API effect:
  `new Model()` and `new Model({x: undefined})` apply defaults; a copy built from field values is explicit.
- **Scalar content.** A single-valued `content` joins its text pieces around UNMAPPED children. Around a DECLARED child (and
  for `cdata: true`, around any other node) Ruby keeps a list that a single-valued attribute cannot hold, so TS refuses the
  document by name (`invalid_document`, attribute `content`) instead of flattening it.
- **CDATA output.** `cdata: true` on a content or scalar element rule writes the value as a CDATA section through the
  document's `createCData` (literal entities and Unicode as written; empty values omitted); parsed CDATA tokens of ordered
  or mixed models are written back. A value containing `]]>` is refused (`not_serializable`) because splitting it would
  not read back as one value; `cdata` on a model-valued element rule is refused at generation.
