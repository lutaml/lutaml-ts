# lutaml-ts

## Explicit model choices

The optional v2 `choices` declaration uses version 1, validation `explicit`,
and ordered groups (`min`, `max`, `format`, `members`). A null maximum is
unbounded. Members name one declared `attribute` or carry one nested `choice`.
Bundles must advertise `model.choices.v1`. Generated models expose explicit
validation; constructors and codecs defer group checks. Existing field/type
validation remains independent. Nested alternatives, false values, finite
collection batches, optional empty collections and XML render policies follow
the Ruby source algorithm. Unsupported metadata is refused.

The source-produced fixture records each construction, JSON read/write and
XML read/write phase separately. Passing this fixture establishes those
cases, not full OMML or arbitrary custom-value-type compatibility.

## Custom serialization hooks (key-value rules)

A json/yaml rule may carry `custom: {to?, from?}` (names only, never bodies). `to` is the WRITE hook
`(model, document, state)`, `from` the READ hook `(model, value, state)`; a rule with `custom` may omit `to`.
For a mapping with hooks the generated `<format>/codecs.ts` exports `<Class>Hooks<S>`, `CodecHooks<S>` and
`withHooks(hooks, state, fn)`. Hooks are trusted handwritten code installed per call; `state` is the explicit
store for values that exist only in hooks (they are not model attributes). A direction that is attempted but
not implemented (or not declared on a hook-only rule) fails with `custom_serialization`; a read never runs a
write hook and vice versa. Declared data decoding is unchanged. XML rules refuse `custom` (`unsupported_mapping`).
