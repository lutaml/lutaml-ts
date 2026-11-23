// Handwritten implementations of the ONE hook in the real UnitsML graph (unitsml-ruby ee09d6d7, Units::Symbol):
// the content rule {to: content_to_xml, from: content_from_xml}. The Ruby bodies never travel in the bundle; these are
// written by hand against the typed interface the generator emits and installed per operation with withHooks().
import type { CodecHooks, UnitsmlModelUnitsSymbolHooks } from "./xml/index.js";

export const symbolHooks: UnitsmlModelUnitsSymbolHooks<null> = {
  // Source Symbol#content_to_xml(model, parent, doc): the content is RAW markup appended to the parent through the
  // document, never escaped; no content writes nothing.
  content_to_xml: async (model, parent, builder) => {
    const content = model.content;
    if (typeof content === "string" && content !== "") await builder.markup(parent, content);
  },
  // Source Symbol#content_from_xml(**) is an explicit no-op: raw input is not stored, so the declared content stays unset.
  content_from_xml: () => undefined,
};

export const unitHooks: CodecHooks<null> = { "Unitsml::Model::Units::Symbol@default": symbolHooks };
