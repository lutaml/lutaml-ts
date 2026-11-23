import { describe, expect, it } from "vitest";
import type { Bundle } from "../../src/contracts.js";
import { LmlError } from "../../src/contracts.js";
import { generateInto, infoOf, load } from "./harness.js";
import { createXmlEmitter } from "../../src/xml/index.js";

// CDATA output (cdata: true on content and element rules) goes through the document's createCData constructor: literal
// entities and Unicode are kept as written, and the order of siblings is preserved. A section cannot contain "]]>":
// splitting it would not read back as one value (Ruby reads adjacent sections as a list), so that value is refused by name.
const attr = (name: string, collection: unknown = false): unknown => ({
  name, type: { kind: "builtin", name: "string" }, required: false, collection, default: { present: false }, initialize_empty: false,
});
const MANY = { min: 0, max: null };
const render = { default: false, empty: "omit", nil: "omit" };
const SCALAR = "Scalar@default";
const ELEMS = "Elems@default";
const bundle = { lml_bundle: 1, roots: [SCALAR, ELEMS], capabilities: ["xml"], value_types: {}, models: {
  [SCALAR]: { lml: 2, model: "Scalar", register: "default", attributes: [attr("id"), attr("content")],
    mappings: { xml: { root: { element: "s" }, rules: [
      { kind: "attribute", name: ["id"], to: "id", namespace: { mode: "inherit" }, render },
      { kind: "content", to: "content", cdata: true, render },
    ] } } },
  [ELEMS]: { lml: 2, model: "Elems", register: "default", attributes: [attr("a"), attr("plain"), attr("b", MANY)],
    mappings: { xml: { root: { element: "e" }, rules: [
      { kind: "element", name: ["a"], to: "a", cdata: true, namespace: { mode: "inherit" }, render },
      { kind: "element", name: ["plain"], to: "plain", namespace: { mode: "inherit" }, render },
      { kind: "element", name: ["b"], to: "b", cdata: true, namespace: { mode: "inherit" }, render },
    ] } } },
} } as unknown as Bundle;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = Record<string, any>;
describe("CDATA output", () => {
  let codecs: Any; let models: Any;
  const setup = async (): Promise<void> => {
    if (codecs !== undefined) return;
    const dir = generateInto(bundle);
    codecs = (await load(dir, "xml/index.ts"))["CODECS"];
    models = await load(dir, "models.ts");
  };

  it("writes single-valued content as one CDATA section, keeping literal entities and Unicode as written", async () => {
    await setup();
    const c = codecs[SCALAR];
    const text = '&amp; <tag> "q" \'a\' é 日本 😀 &#10; ]] >';
    const out = await c.stringify(new models["Scalar"]({ id: "1", content: text }));
    expect(out).toBe(`<s id="1"><![CDATA[${text}]]></s>`);
    const back = await c.parse(out);
    expect([back.id, back.content]).toEqual(["1", text]);
  });

  it("an empty value is omitted by the empty policy, not written as an empty section", async () => {
    await setup();
    expect(await codecs[SCALAR].stringify(new models["Scalar"]({ id: "1", content: "" }))).toBe('<s id="1"/>');
  });

  it("writes cdata element rules (single and collection) in rule order next to plain elements", async () => {
    await setup();
    const c = codecs[ELEMS];
    const value = new models["Elems"]({ a: "x<y&amp;", plain: "p<&", b: ["1", "é<2>"] });
    const out = await c.stringify(value);
    expect(out).toBe("<e><a><![CDATA[x<y&amp;]]></a><plain>p&lt;&amp;</plain><b><![CDATA[1]]></b><b><![CDATA[é<2>]]></b></e>");
    const back = await c.parse(out);
    expect([back.a, back.plain, [...back.b]]).toEqual(["x<y&amp;", "p<&", ["1", "é<2>"]]);
  });

  it("a cdata: true element reads CDATA only (canonical Ruby: plain text is dropped) and writes it back as CDATA", async () => {
    await setup();
    const c = codecs[ELEMS];
    expect(await c.stringify(await c.parse("<e><a><![CDATA[t<1]]></a><plain>t&lt;1</plain></e>"))).toBe("<e><a><![CDATA[t<1]]></a><plain>t&lt;1</plain></e>");
    expect(await c.stringify(await c.parse("<e><a>t&lt;1</a><plain>t&lt;1</plain></e>"))).toBe("<e><plain>t&lt;1</plain></e>");
  });

  it("splits the CDATA terminator across sections exactly as Ruby does, and reads the sections back as one value", async () => {
    await setup();
    const out = await codecs[SCALAR].stringify(new models["Scalar"]({ content: "a]]>b" }));
    expect(out).toBe("<s><![CDATA[a]]]]><![CDATA[>b]]></s>");
    expect((await codecs[SCALAR].parse(out)).content).toBe("a]]>b");
    expect(await codecs[ELEMS].stringify(new models["Elems"]({ b: ["ok", "x]]>y"] }))).toBe("<e><b><![CDATA[ok]]></b><b><![CDATA[x]]]]><![CDATA[>y]]></b></e>");
    // the same text is fine in a plain rule (escaped)
    expect(await codecs[ELEMS].stringify(new models["Elems"]({ plain: "a]]>b" }))).toBe("<e><plain>a]]&gt;b</plain></e>");
  });

  it("refuses cdata on a model-valued element rule at generation (no meaning)", () => {
    const bad = structuredClone(bundle) as unknown as { models: Record<string, { attributes: unknown[]; mappings: { xml: { rules: Record<string, unknown>[] } } }> };
    bad.models[ELEMS]!.attributes.push({ name: "kid", type: { kind: "model", id: SCALAR }, required: false, collection: false, default: { present: false }, initialize_empty: false });
    bad.models[ELEMS]!.mappings.xml.rules.push({ kind: "element", name: ["kid"], to: "kid", cdata: true, namespace: { mode: "inherit" } });
    let info: LmlError["info"] | undefined;
    try { createXmlEmitter().emit(bad as unknown as Bundle, { types: {} }); } catch (error) { info = (error as LmlError).info; }
    expect(info).toMatchObject({ reason: "unsupported_mapping", model_id: ELEMS });
  });
});
