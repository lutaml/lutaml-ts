import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Bundle } from "../../src/contracts.js";
import { bundleChecksum, loadBundle } from "../../src/lml/index.js";
import { generateInto, infoOf, load, tscCheck } from "./harness.js";

const REPO = resolve(import.meta.dirname, "../..");
const FIXTURE = join(REPO, "test/fixtures/ts_generated/xml_hooks_bundle.json");
const bytes = readFileSync(FIXTURE);
// Shared with the Ruby producer (evidence/serialization-hooks-xml/bundle.json; verify_materialization reproduces it).
const SHARED_CHECKSUM = "sha256:a8521cab2de342127d6e109d21b6ad531cd946893133afc4710666f27756d613";
const bundle = (): Bundle => loadBundle(bytes, "json");
const SYMBOL = "LmlXmlHookFixtures::SymbolLike@default";
const MIXED = "LmlXmlHookFixtures::Mixed@default";
const NS = "urn:lml:xmlhooks";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edit = (change: (tree: any) => void): { reason?: string; location?: string | undefined } => {
  const tree = JSON.parse(bytes.toString("utf8"));
  change(tree);
  try {
    loadBundle(Buffer.from(JSON.stringify(tree)), "json");
  } catch (error) {
    const info = (error as { info: { reason: string; location?: string } }).info;
    return { reason: info.reason, location: info.location };
  }
  return {};
};
const RULES = (id: string) => `/models/${id}/mappings/xml/rules`;

describe("XML custom hooks: contract", () => {
  it("loads the shared fixture byte-identically and reproduces its checksum", () => {
    expect(bundleChecksum(bundle())).toBe(SHARED_CHECKSUM);
  });

  const cases: [string, (t: any) => void, string, string][] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
    ["custom on any_attribute", (t) => { t.models[MIXED].mappings.xml.rules.push({ kind: "any_attribute", to: "title", custom: { to: "h" } }); }, "unsupported_mapping", `${RULES(MIXED)}/2/custom`],
    ["custom on a sequence", (t) => { t.models[MIXED].mappings.xml.rules.push({ kind: "sequence", members: [], custom: { to: "h" } }); }, "unsupported_mapping", `${RULES(MIXED)}/2/custom`],
    ["custom on a choice", (t) => { t.models[MIXED].mappings.xml.rules.push({ kind: "choice", members: [], custom: { to: "h" } }); }, "unsupported_mapping", `${RULES(MIXED)}/2/custom`],
    ["custom is not an object", (t) => { t.models[SYMBOL].mappings.xml.rules[1].custom = "x"; }, "invalid_document", `${RULES(SYMBOL)}/1/custom`],
    ["empty custom", (t) => { t.models[SYMBOL].mappings.xml.rules[1].custom = {}; }, "invalid_document", `${RULES(SYMBOL)}/1/custom`],
    ["unknown custom key", (t) => { t.models[SYMBOL].mappings.xml.rules[1].custom.body = "x"; }, "invalid_document", `${RULES(SYMBOL)}/1/custom/body`],
    ["bad hook name", (t) => { t.models[SYMBOL].mappings.xml.rules[1].custom.to = "a-b"; }, "invalid_document", `${RULES(SYMBOL)}/1/custom/to`],
    ["to equals from", (t) => { t.models[SYMBOL].mappings.xml.rules[1].custom = { to: "same", from: "same" }; }, "invalid_document", `${RULES(SYMBOL)}/1/custom`],
    ["one name in both directions", (t) => { t.models[MIXED].mappings.xml.rules[1].custom = { to: "title_from_xml", from: "x_from" }; }, "invalid_document", `${RULES(MIXED)}/1/custom/to`],
    ["executable key next to custom", (t) => { t.models[SYMBOL].mappings.xml.rules[1].with = { to: "x" }; }, "unsupported_mapping", `${RULES(SYMBOL)}/1/with`],
  ];
  it.each(cases)("refuses %s", (_name, change, reason, location) => {
    expect(edit(change)).toEqual({ reason, location });
  });

  it("refuses one hook name used as both a key-value and an xml hook of one model", () => {
    const result = edit((t) => {
      const model = t.models[SYMBOL];
      model.capabilities = ["json", "xml"];
      model.mappings.json = { rules: [{ key: ["content"], custom: { from: "content_from_xml" } }] };
      t.capabilities = ["json", "xml"];
    });
    expect(result.reason).toBe("invalid_document");
  });

  it("a hook-only rule needs no declared attribute", () => {
    expect(edit((t) => { delete t.models[MIXED].mappings.xml.rules[1].to; })).toEqual({});
  });
});

describe("XML custom hooks: generated code", () => {
  const CONSUMER = [
    'import { CODECS, withHooks } from "./xml/index.js";',
    'import type { CodecHooks, LmlXmlHookFixturesMixedHooks, LmlXmlHookFixturesSymbolLikeHooks, XmlWriteBuilder } from "./xml/index.js";',
    "export interface State { seen: string[]; extra?: string; title?: string }",
    "export const symbol: LmlXmlHookFixturesSymbolLikeHooks<State> = {",
    "  content_to_xml: async (model, parent, builder) => { if (typeof model.content === 'string') await builder.markup(parent, model.content); },",
    "  content_from_xml: (value, state, context) => { state.seen.push(context.rule + ':' + value); return value === '' ? undefined : value; },",
    "};",
    "export const mixed: LmlXmlHookFixturesMixedHooks<State> = {",
    "  title_to_xml: (model, parent, builder: XmlWriteBuilder) => { if (typeof model.title === 'string') builder.text(builder.element(parent, 'title'), model.title.toUpperCase()); },",
    "  title_from_xml: (value) => value.toLowerCase(),",
    "  extra_to_xml: (_model, parent, builder, state) => { if (state.extra !== undefined) builder.text(builder.element(parent, 'extra', { uri: 'urn:lml:xmlhooks', prefix: 'h' }), state.extra); },",
    "  extra_from_xml: (_model, value, state) => { state.extra = value; },",
    "};",
    "export const hooks: CodecHooks<State> = { 'LmlXmlHookFixtures::SymbolLike@default': symbol, 'LmlXmlHookFixtures::Mixed@default': mixed };",
    "export const bound = (state: State): typeof CODECS => withHooks(hooks, state);",
    "// @ts-expect-error a write hook has the (model, parent, builder, state) shape",
    "export const bad: LmlXmlHookFixturesMixedHooks<State> = { title_to_xml: (_m: unknown, _p: number) => undefined };",
    "// @ts-expect-error a read hook for a declared attribute returns the declared value, not a number",
    "export const bad2: LmlXmlHookFixturesSymbolLikeHooks<State> = { content_from_xml: () => 5 };",
  ].join("\n");

  it("generates, compiles under strict tsc with a typed consumer, and leaves unhooked codecs alone", () => {
    const dir = generateInto(bundle(), { extra: { "consumer.ts": CONSUMER } });
    tscCheck(dir);
  }, 120_000);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = Record<string, any>;
  const setup = async (): Promise<{ xml: Any; models: Any; consumer: Any }> => {
    const dir = generateInto(bundle(), { extra: { "consumer.ts": CONSUMER } });
    return { xml: await load(dir, "xml/index.ts"), models: await load(dir, "models.ts"), consumer: await load(dir, "consumer.ts") };
  };
  const doc = (inner: string, type = "HTML") => `<h:UnitSymbol xmlns:h="${NS}" type="${type}">${inner}</h:UnitSymbol>`;

  it("without installed hooks a reached rule fails by name, in the attempted direction only", async () => {
    const { xml, models } = await setup();
    const codec = xml["CODECS"][SYMBOL];
    expect(await infoOf(() => codec.parse(doc("m")))).toMatchObject({ reason: "custom_serialization", model_id: SYMBOL, rule: "content" });
    // read installed, write not installed: the write fails by name, independently of the read
    const readOnly = codec.bind({ [SYMBOL]: { content_from_xml: () => undefined } }, {});
    const model = await readOnly.parse(doc("m"));
    expect(model.type).toBe("HTML");
    expect(await infoOf(() => readOnly.stringify(model))).toMatchObject({ reason: "custom_serialization", model_id: SYMBOL, rule: "content" });
    // write installed, read not installed
    const writeOnly = codec.bind({ [SYMBOL]: { content_to_xml: () => undefined } }, {});
    expect(await infoOf(() => writeOnly.parse(doc("m")))).toMatchObject({ reason: "custom_serialization", rule: "content" });
    expect(await writeOnly.stringify(new models["LmlXmlHookFixturesSymbolLike"]({ type: "HTML" }))).toBe(`<h:UnitSymbol xmlns:h="${NS}" type="HTML"/>`);
    // a hook-only element is reached only when the element is present
    const mixed = xml["CODECS"][MIXED];
    expect(await infoOf(() => mixed.parse(`<h:mixedHooks xmlns:h="${NS}"><title>x</title></h:mixedHooks>`))).toMatchObject({ reason: "custom_serialization", rule: "title" });
  });

  // Under a prefixed root the fragment elements need no xmlns=""; under a default namespace they get it (real Unit test).
  it("explicit hooks write raw markup through document operations, never escaped text", async () => {
    const { models, consumer } = await setup();
    const state = { seen: [] as string[] };
    const codec = consumer["bound"](state)[SYMBOL];
    const Symbol_ = models["LmlXmlHookFixturesSymbolLike"];
    const raw = await codec.stringify(new Symbol_({ type: "HTML", content: "<i>m</i>&amp;<b a=\"1\">x</b>" }));
    expect(raw).toBe(`<h:UnitSymbol xmlns:h="${NS}" type="HTML"><i>m</i>&amp;<b a="1">x</b></h:UnitSymbol>`);
    expect(raw).not.toContain("&lt;");
    // markup that is not well-formed is refused by the facade, not repaired
    expect(await infoOf(() => codec.stringify(new Symbol_({ content: "<i>m" })))).toMatchObject({ reason: "invalid_document" });
  });

  it("a declared required field is supplied by the read hook and validated afterwards", async () => {
    const { models, consumer } = await setup();
    const state = { seen: [] as string[] };
    const codec = consumer["bound"](state)[SYMBOL];
    const read = await codec.parse(doc("meter"));
    expect(read.content).toBe("meter");
    expect(state.seen).toEqual(["content:meter"]);
    const empty = await codec.parse(doc(""));
    expect(typeof empty.content).toBe("symbol"); // the hook returned undefined: the declared field stays unset
    expect(models["LmlXmlHookFixturesSymbolLike"].modelId).toBe(SYMBOL);
  });

  it("reads and writes hooked elements and hook-only rules with explicit state", async () => {
    const { consumer } = await setup();
    const state: { seen: string[]; extra?: string } = { seen: [], extra: "kept" };
    const codec = consumer["bound"](state)[MIXED];
    const text = `<h:mixedHooks xmlns:h="${NS}"><title>Hello</title><h:extra>side</h:extra></h:mixedHooks>`;
    const model = await codec.parse(text);
    expect(model.title).toBe("hello"); // the declared title is the hook's lower-cased value
    expect(state.extra).toBe("side"); // the hook-only value lives in the explicit state
    expect(await codec.stringify(model)).toBe(`<h:mixedHooks xmlns:h="${NS}"><title>HELLO</title><h:extra>side</h:extra></h:mixedHooks>`);
  });

  it("concurrent operations never share hooks or state, and a missing hook corrupts nothing else", async () => {
    const { xml, models, consumer } = await setup();
    const Symbol_ = models["LmlXmlHookFixturesSymbolLike"];
    const states = Array.from({ length: 24 }, (_v, i) => ({ seen: [] as string[], i }));
    const results = await Promise.all(
      states.map(async (state, i) => {
        if (i % 6 === 5) return { i, failed: await infoOf(() => xml["CODECS"][SYMBOL].parse(doc("x"))) };
        const codec = consumer["bound"](state)[SYMBOL];
        const read = await codec.parse(doc(`v${i}`));
        const out = await codec.stringify(new Symbol_({ type: "T" + i, content: `<i>${i}</i>` }));
        return { i, content: read.content, out };
      }),
    );
    for (const r of results) {
      if ("failed" in r) {
        expect(r.failed).toMatchObject({ reason: "custom_serialization", model_id: SYMBOL });
        continue;
      }
      expect(r.content).toBe(`v${r.i}`);
      expect(r.out).toBe(`<h:UnitSymbol xmlns:h="${NS}" type="T${r.i}"><i>${r.i}</i></h:UnitSymbol>`);
      expect(states[r.i]?.seen).toEqual([`content:v${r.i}`]);
    }
  });
});

describe("XML custom hooks: a required declared attribute supplied by the read hook", () => {
  const ID = "Req@default";
  const required: Bundle = {
    lml_bundle: 1, roots: [ID], capabilities: ["xml"], value_types: {},
    models: {
      [ID]: {
        lml: 2, model: "Req", register: "default",
        attributes: [
          { name: "n", type: { kind: "builtin", name: "integer" }, required: true, collection: false, default: { present: false }, initialize_empty: false },
          { name: "body", type: { kind: "builtin", name: "string" }, required: true, collection: false, default: { present: false }, initialize_empty: false },
        ],
        mappings: { xml: { root: { element: "r" }, rules: [
          { kind: "attribute", name: ["n"], to: "n", custom: { from: "n_from_xml", to: "n_to_xml" }, namespace: { mode: "inherit" }, render: { default: false, empty: "omit", nil: "omit" } },
          { kind: "content", to: "body", custom: { from: "body_from_xml" }, render: { default: false, empty: "omit", nil: "omit" } },
        ] } },
      },
    },
  } as unknown as Bundle;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = Record<string, any>;
  const setup = async (): Promise<Any> => load(generateInto(required), "xml/index.ts");
  const hooks = {
    [ID]: {
      n_from_xml: (value: string) => BigInt(value) * 2n,
      body_from_xml: (value: string) => value.trim(),
      n_to_xml: (model: { n: bigint }, parent: { setAttribute(name: string, value: string): void }) => { parent.setAttribute("n", String(model.n / 2n)); },
    },
  };

  it("deserializes through explicit handwritten reads and validates the declared fields afterwards", async () => {
    const xml = await setup();
    const codec = xml["CODECS"][ID].bind(hooks, {});
    const model = await codec.parse("<r n='21'>  hello </r>");
    expect([model.n, model.body]).toEqual([42n, "hello"]);
    // n writes through its write hook; body has only a read hook, so its write is the ordinary declared value
    expect(await codec.stringify(model)).toBe('<r n="21">hello</r>');
  });

  it("applies the declared type and required validation to the supplied values", async () => {
    const xml = await setup();
    const wrong = xml["CODECS"][ID].bind({ [ID]: { ...hooks[ID], n_from_xml: () => "nope" } }, {});
    expect(await infoOf(() => wrong.parse("<r n='1'>b</r>"))).toMatchObject({ reason: "invalid_document", model_id: ID, attribute: "n" });
    const unset = xml["CODECS"][ID].bind({ [ID]: { ...hooks[ID], body_from_xml: () => undefined } }, {});
    expect(await infoOf(() => unset.parse("<r n='1'>b</r>"))).toMatchObject({ reason: "invalid_document", model_id: ID });
    // the attribute absent: its hook is not reached, and the required value is missing
    expect(await infoOf(() => xml["CODECS"][ID].bind(hooks, {}).parse("<r>b</r>"))).toMatchObject({ reason: "invalid_document", model_id: ID });
  });

  it("a missing read hook fails by name where its rule is reached, independent of the write hook", async () => {
    const xml = await setup();
    const writeOnly = xml["CODECS"][ID].bind({ [ID]: { n_to_xml: hooks[ID].n_to_xml } }, {});
    expect(await infoOf(() => writeOnly.parse("<r n='1'>b</r>"))).toMatchObject({ reason: "custom_serialization", model_id: ID, rule: "n" });
  });
});
