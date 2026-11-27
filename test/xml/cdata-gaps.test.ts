import { describe, expect, it } from "vitest";
import type { Bundle } from "../../src/contracts.js";
import { generateInto, infoOf, load } from "./harness.js";

// XML reads where canonical Ruby (lutaml-model e4439b37, Nokogiri adapter) holds a shape a typed string cannot, or reads a
// cdata: true collection differently from the first-group rule. Every expectation is a Ruby answer measured in the
// 2026-11-23 gap table (502 rows), not a self-authored one. Rows where TS intentionally differs are not asserted here.
const str = (name: string, many: boolean): unknown => ({
  name, type: { kind: "builtin", name: "string" }, required: false, collection: many ? { min: 0, max: null } : false,
  default: { present: false }, initialize_empty: false,
});
const render = { default: false, empty: "omit", nil: "omit" };
const ns = { mode: "inherit" };
const model = (id: string, root: string, attributes: unknown[], rules: unknown[]): unknown => ({
  lml: 2, model: id, register: "default", attributes, mappings: { xml: { root: { element: root }, rules } },
});
const el = (to: string, cdata: boolean): unknown => ({ kind: "element", name: [to], to, cdata, namespace: ns, render });
const bundle = { lml_bundle: 1, roots: [], capabilities: ["xml"], value_types: {}, models: {
  "CoElemP@default": model("CoElemP", "p", [str("v", true)], [el("v", false)]),
  "CoElemC@default": model("CoElemC", "p", [str("v", true)], [el("v", true)]),
  "ScElemC@default": model("ScElemC", "p", [str("v", false)], [el("v", true)]),
  "ScElemP@default": model("ScElemP", "p", [str("v", false)], [el("v", false)]),
  "ScContentC@default": model("ScContentC", "r", [str("text", false)], [{ kind: "content", to: "text", cdata: true, render }]),
  "ScContentChildC@default": model("ScContentChildC", "r", [str("text", false), str("c", false)], [
    { kind: "content", to: "text", cdata: true, render }, el("c", false),
  ]),
} } as unknown as Bundle;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = Record<string, any>;
describe("CDATA read gaps against canonical Ruby", () => {
  let codecs: Any; let absent: unknown;
  const setup = async (): Promise<void> => {
    if (codecs !== undefined) return;
    const dir = generateInto(bundle);
    codecs = (await load(dir, "xml/index.ts"))["CODECS"];
    absent = (await load(dir))["ABSENT"]; // the generated copy, not the repo's symbol
  };
  const read = async (m: string, xml: string): Promise<Any> => codecs[`${m}@default`].parse(xml);
  const refusal = async (m: string, xml: string): Promise<unknown> => infoOf(() => read(m, xml));

  // Ruby: [nil, "z"] (or ["z", nil]). A typed string[] cannot hold nil and dropping it shifts every later index.
  const NIL_ITEM = [
    "<p><v>a<![CDATA[b]]></v><v>z</v></p>",
    "<p><v><![CDATA[a]]>b</v><v>z</v></p>",
    "<p><v>a<![CDATA[b]]>c</v><v>z</v></p>",
    "<p><v>a<u>z</u><![CDATA[b]]></v><v>z</v></p>",
    "<p><v><![CDATA[a]]>x<![CDATA[b]]></v><v>z</v></p>",
    "<p><v><![CDATA[a]]><?p q?><![CDATA[b]]></v><v>z</v></p>",
    "<p><v>a<!--c-->b</v><v>z</v></p>",
    "<p><v>a<?p q?>b</v><v>z</v></p>",
    "<p><v>z</v><v>a<![CDATA[b]]></v></p>",
    "<p><v>z</v><v><![CDATA[a]]><?p q?><![CDATA[b]]></v></p>",
  ];
  for (const xml of NIL_ITEM) {
    it(`refuses the nil collection item in ${xml}`, async () => {
      await setup();
      expect(await refusal("CoElemP", xml)).toMatchObject({ reason: "invalid_document", model_id: "CoElemP@default", attribute: "v" });
    });
  }

  it("keeps a lone multi-node item as no item, as Ruby does ([] for one matching element)", async () => {
    await setup();
    expect((await read("CoElemP", "<p><v>a<![CDATA[b]]></v></p>")).v).toBe(absent);
    expect((await read("CoElemP", "<p><v>a<!--c-->b</v></p>")).v).toBe(absent);
  });

  it("keeps ordinary collections of single-node items unchanged", async () => {
    await setup();
    expect((await read("CoElemP", "<p><v>a</v><v>z</v></p>")).v).toEqual(["a", "z"]);
  });

  // Ruby: every CDATA group is an item once more than one <v> matches; with one <v> only the first group is read.
  const GROUPS: [string, string[]][] = [
    ["<p><v><![CDATA[a]]>x<![CDATA[b]]></v><v>z</v></p>", ["a", "b"]],
    ["<p><v>z</v><v><![CDATA[a]]><!--c--><![CDATA[b]]></v></p>", ["a", "b"]],
    ["<p><v><![CDATA[a]]> <![CDATA[b]]></v><v>z</v></p>", ["a", "b"]],
    ["<p><v><![CDATA[a]]><?p q?><![CDATA[b]]></v><v>z</v></p>", ["a", "b"]],
    ["<p><v><![CDATA[a]]>x<![CDATA[b]]></v><v><![CDATA[c]]></v></p>", ["a", "b", "c"]],
    ["<p><v><![CDATA[c]]></v><v><![CDATA[a]]>x<![CDATA[b]]></v></p>", ["c", "a", "b"]],
    ["<p><v><![CDATA[a]]>x<![CDATA[b]]></v><v><![CDATA[c]]>y<![CDATA[d]]></v></p>", ["a", "b", "c", "d"]],
    ["<p><v><![CDATA[a]]>x<![CDATA[b]]>y<![CDATA[c]]></v><v>z</v></p>", ["a", "b", "c"]],
  ];
  for (const [xml, want] of GROUPS) {
    it(`reads every CDATA group of ${xml}`, async () => {
      await setup();
      expect((await read("CoElemC", xml)).v).toEqual(want);
    });
  }

  it("reads one CDATA group when a single element matches, and merges adjacent sections", async () => {
    await setup();
    expect((await read("CoElemC", "<p><v><![CDATA[a]]>x<![CDATA[b]]></v></p>")).v).toEqual(["a"]);
    expect((await read("CoElemC", "<p><v><![CDATA[a]]><?p q?><![CDATA[b]]></v></p>")).v).toEqual(["a"]);
    expect((await read("CoElemC", "<p><v><![CDATA[a]]><![CDATA[b]]></v><v>z</v></p>")).v).toEqual(["ab"]);
  });

  // Ruby: a list on a single-valued string attribute; a typed string cannot represent it.
  it("refuses a processing instruction between CDATA groups of single-valued content", async () => {
    await setup();
    expect(await refusal("ScContentC", "<r><![CDATA[a]]><?p q?><![CDATA[b]]></r>")).toMatchObject({
      reason: "invalid_document", model_id: "ScContentC@default", attribute: "text",
    });
  });

  it("reads a lone CDATA section, or one before a processing instruction, as one string", async () => {
    await setup();
    expect((await read("ScContentC", "<r><![CDATA[ab]]></r>")).text).toBe("ab");
    expect((await read("ScContentC", "<r><![CDATA[a]]><?p q?></r>")).text).toBe("a");
    expect((await read("ScContentChildC", "<r><?p q?><c>k</c></r>")).c).toBe("k");
  });

  it("reads the first CDATA group of a single-valued element, as Ruby does (a processing instruction splits groups)", async () => {
    await setup();
    expect((await read("ScElemC", "<p><v><![CDATA[a]]><?p q?><![CDATA[b]]></v></p>")).v).toBe("a");
    expect((await read("ScElemC", "<p><v><![CDATA[a]]><![CDATA[b]]></v></p>")).v).toBe("ab");
  });

  // Ruby holds [] (and its own validate reports CollectionTrueMissingError) for repeated <v> on a cdata: true single-valued
  // rule; ScElemP refuses the same repetition, so the refusal is the consistent answer and is kept.
  it("keeps refusing a repeated element on a single-valued cdata: true rule", async () => {
    await setup();
    expect(await refusal("ScElemC", "<p><v>a</v><v>z</v></p>")).toMatchObject({ reason: "invalid_document", model_id: "ScElemC@default", attribute: "v" });
    expect(await refusal("ScElemP", "<p><v>a</v><v>z</v></p>")).toMatchObject({ reason: "invalid_document", model_id: "ScElemP@default", attribute: "v" });
  });
});
