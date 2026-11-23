import { describe, expect, it } from "vitest";
import type { Bundle } from "../../src/contracts.js";
import { generateInto, infoOf, load } from "./harness.js";

// Ruby (lutaml-model scalar-content fix): a single-valued content attribute joins its text pieces only around UNMAPPED
// child elements; around a DECLARED child (and, for cdata: true, around any other node) the pieces stay a list, which a
// single-valued attribute cannot hold and Ruby's own validation flags (CardinalityStrictSpec:441: a mapped collection
// `bold` plus `content: :string`, <r>one <bold>b</bold> two <bold>c</bold> three</r>). TS joins unknown children and
// refuses the invalid states by name instead of flattening them.
const attr = (name: string, collection: unknown = false): unknown => ({
  name, type: { kind: "builtin", name: "string" }, required: false, collection, default: { present: false }, initialize_empty: false,
});
const R = "R@default";
const C = "C@default";
const render = { default: false, empty: "omit", nil: "omit" };
const bundle = { lml_bundle: 1, roots: [R, C], capabilities: ["xml"], value_types: {}, models: {
  [R]: { lml: 2, model: "R", register: "default", attributes: [attr("bold", { min: 0, max: null }), attr("content")],
    mappings: { xml: { root: { element: "r" }, rules: [
      { kind: "element", name: ["bold"], to: "bold", namespace: { mode: "inherit" }, render },
      { kind: "content", to: "content", render },
    ] } } },
  [C]: { lml: 2, model: "C", register: "default", attributes: [attr("content")],
    mappings: { xml: { root: { element: "c" }, rules: [{ kind: "content", to: "content", cdata: true, render }] } } },
} } as unknown as Bundle;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = Record<string, any>;
describe("single-valued text content around child elements", () => {
  let codecs: Any;
  let absent: unknown;
  const setup = async (): Promise<Any> => {
    if (codecs === undefined) {
      const loaded = await load(generateInto(bundle));
      codecs = loaded["xml"].CODECS;
      absent = loaded["ABSENT"];
    }
    return codecs;
  };

  it("joins the pieces around unknown children and keeps one-piece, empty and element-only content", async () => {
    const c = (await setup())[R];
    expect((await c.parse("<r>one<span/> two</r>")).content).toBe("one two");
    expect((await c.parse("<r> a <span>t</span> b <i/> c </r>")).content).toBe(" a  b  c ");
    expect((await c.parse("<r>one</r>")).content).toBe("one");
    expect((await c.parse("<r/>")).content).toBe("");
    const onlyMapped = await c.parse("<r><bold>b</bold></r>");
    expect([onlyMapped.content, [...onlyMapped.bold]]).toEqual([absent, ["b"]]);
  });

  // An unset property reads as the generated models' ABSENT marker (Maybe<T>), never undefined: that is the public no-value state.
  it("reads an empty or layout-only list beside a declared child as no value, as Ruby writes nothing for it", async () => {
    const c = (await setup())[R];
    for (const xml of ["<r>\n  <bold>b</bold>\n</r>", "<r><!--x--><bold>b</bold></r>", "<r><![CDATA[a]]><bold>b</bold></r>"]) {
      const m = await c.parse(xml);
      expect([m.content, [...m.bold]], xml).toEqual([absent, ["b"]]);
    }
    const cdata = (await setup())[C];
    expect((await cdata.parse("<c>t<x/></c>")).content).toBe(absent);
  });

  it("refuses text split around a DECLARED child by name (the source counterexample)", async () => {
    const c = (await setup())[R];
    for (const xml of ["<r>one <bold>b</bold> two <bold>c</bold> three</r>", "<r>one <bold>b</bold></r>", "<r><bold>b</bold> after</r>"]) {
      expect(await infoOf(() => c.parse(xml)), xml).toMatchObject({ reason: "invalid_document", model_id: R, attribute: "content", rule: "content" });
    }
    // an unknown child next to a declared one still counts: the declared child decides
    expect(await infoOf(() => c.parse("<r>a<span/>b<bold>x</bold></r>"))).toMatchObject({ reason: "invalid_document", model_id: R });
  });

  it("a cdata: true single-valued rule joins adjacent sections and refuses a list state (full table: cdata-oracle.test.ts)", async () => {
    const c = (await setup())[C];
    expect((await c.parse("<c><![CDATA[a<b]]></c>")).content).toBe("a<b");
    expect((await c.parse("<c><![CDATA[a]]><![CDATA[b]]></c>")).content).toBe("ab"); // libxml2 merges adjacent sections
    expect(await infoOf(() => c.parse("<c>t<![CDATA[a]]></c>"))).toMatchObject({ reason: "invalid_document", model_id: C, attribute: "content" });
    expect(await infoOf(() => c.parse("<c><![CDATA[a]]><x/></c>"))).toMatchObject({ reason: "invalid_document", model_id: C });
  });
});
