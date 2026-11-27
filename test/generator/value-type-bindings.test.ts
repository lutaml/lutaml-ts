import { describe, expect, it } from "vitest";
import { generateModels } from "../../src/generator/index.js";
import { LmlError } from "../../src/contracts.js";
import type { Bindings, Bundle, ErrorDetail } from "../../src/contracts.js";
import { attr, bundleOf } from "./support.js";

const valueAttr = (id: string): Record<string, unknown> => ({ name: "x", type: { kind: "value", id }, required: false });
const NO_BINDINGS: Bindings = { types: {} };
const BOUND: Bindings = { types: { T: { module: "./values.js", export: "T" } } as Bindings["types"] };

/** The full error detail a generation call raises; undefined when it succeeds. */
function errorOf(run: () => unknown): ErrorDetail | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof LmlError) return error.info;
    throw error;
  }
  return undefined;
}

describe("referenced named value types need a trusted binding", () => {
  it.each(["string", "token", "integer"])("a facet-free %s alias without a binding is refused", (base) => {
    const bundle = bundleOf([valueAttr("T")], { T: { base, facets: {} } });
    const info = errorOf(() => generateModels(bundle, NO_BINDINGS));
    expect(info?.reason).toBe("missing_type_binding");
    expect(info?.detail).toContain("T");
    expect(info?.model_id).toBe("A@default");
    expect(info?.attribute).toBe("x");
  });

  it("the refusal is the same when the alias is the only value type in a larger bundle", () => {
    const bundle: Bundle = bundleOf(
      [attr("name", "string"), valueAttr("xml_id")],
      { xml_id: { base: "string", facets: {} } },
    );
    expect(errorOf(() => generateModels(bundle, NO_BINDINGS))?.reason).toBe("missing_type_binding");
  });

  it("a facet the generator cannot express without a binding is still refused", () => {
    const bundle = bundleOf([valueAttr("T")], { T: { base: "string", facets: { total_digits: 3 } } });
    expect(errorOf(() => generateModels(bundle, NO_BINDINGS))?.reason).toBe("missing_type_binding");
  });

  it("an unknown base is still reported as unknown_type, not as a missing binding", () => {
    const bundle = bundleOf([valueAttr("T")], { T: { base: "no_such_type", facets: {} } });
    expect(errorOf(() => generateModels(bundle, NO_BINDINGS))?.reason).toBe("unknown_type");
  });
});

describe("preserved generation paths", () => {
  it("an explicitly bound facet-free alias generates", () => {
    const bundle = bundleOf([valueAttr("T")], { T: { base: "string", facets: {} } });
    expect(errorOf(() => generateModels(bundle, BOUND))).toBeUndefined();
    expect(generateModels(bundle, BOUND).size).toBeGreaterThan(0);
  });

  it("a builtin attribute with no value type generates without bindings", () => {
    const bundle = bundleOf([attr("name", "string")]);
    expect(errorOf(() => generateModels(bundle, NO_BINDINGS))).toBeUndefined();
  });

  it("an unreferenced facet-free value type generates without a binding", () => {
    const bundle = bundleOf([attr("name", "string")], { T: { base: "string", facets: {} } });
    expect(errorOf(() => generateModels(bundle, NO_BINDINGS))).toBeUndefined();
  });
});
