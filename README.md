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
