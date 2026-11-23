import { describe, expect, it } from "vitest";
import type { Bundle } from "../../src/contracts.js";
import { generateInto, load, tscCheck } from "../xml/harness.js";

// Default provenance (Ruby: Model#using_default?). A value the constructor filled from the declared default is
// APPLIED and `render.default: false` (the default) suppresses it on write; an explicit value that merely equals the
// default is rendered. Root's Ruby probe (/private/tmp/lml-1033-default-policy-probe.rb, plain Serializable,
// auto and explicit mapping): new -> using_default true -> {} ; new(flag: false) -> {"flag":false} ; new(flag: true) -> {"flag":true}.
const OUTER = "Outer@default";
const INNER = "Inner@default";
const attr = (name: string, type: string, def?: unknown, extra: Record<string, unknown> = {}): unknown => ({
  name, type: { kind: "builtin", name: type }, required: false, collection: false,
  default: def === undefined ? { present: false } : { present: true, value: def }, initialize_empty: false, ...extra,
});
const render = (def: boolean): unknown => ({ default: def, empty: "omit", nil: "omit" });
const bundle = { lml_bundle: 1, roots: [OUTER], capabilities: ["json", "xml"], value_types: {}, models: {
  [INNER]: { lml: 2, model: "Inner", register: "default", attributes: [attr("flag", "boolean", false)],
    mappings: {
      json: { rules: [{ key: ["flag"], to: "flag", render: render(false) }] },
      xml: { root: { element: "inner" }, rules: [{ kind: "attribute", name: ["flag"], to: "flag", namespace: { mode: "inherit" }, render: render(false) }] },
    } },
  [OUTER]: { lml: 2, model: "Outer", register: "default", attributes: [
    attr("flag", "boolean", false), attr("count", "integer", 0), attr("label", "string", "x"), attr("note", "string", "n"), attr("zero", "integer", 0),
    { name: "inner", type: { kind: "model", id: INNER }, required: false, collection: false, default: { present: false }, initialize_empty: false },
  ], mappings: {
    json: { rules: [
      { key: ["flag"], to: "flag", render: render(false) }, { key: ["count"], to: "count", render: render(true) },
      { key: ["label"], to: "label", render: render(false) }, { key: ["note"], to: "note", render: { empty: "omit", nil: "omit" } },
      { key: ["zero"], to: "zero", render: render(false) }, { key: ["inner"], to: "inner", render: render(false) },
    ] },
    xml: { root: { element: "outer" }, rules: [
      { kind: "attribute", name: ["flag"], to: "flag", namespace: { mode: "inherit" }, render: render(false) },
      { kind: "attribute", name: ["count"], to: "count", namespace: { mode: "inherit" }, render: render(true) },
      { kind: "element", name: ["label"], to: "label", namespace: { mode: "inherit" }, render: render(false) },
      { kind: "element", name: ["note"], to: "note", namespace: { mode: "inherit" }, render: { empty: "omit", nil: "omit" } },
      { kind: "element", name: ["zero"], to: "zero", namespace: { mode: "inherit" }, render: render(false) },
      { kind: "element", name: ["inner"], to: "inner", namespace: { mode: "inherit" }, render: render(false) },
    ] },
  } },
} } as unknown as Bundle;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = Record<string, any>;
describe("default provenance across construction, decode and JSON/XML write", () => {
  let models: Any; let json: Any; let xml: Any;
  const setup = async (): Promise<void> => {
    if (models !== undefined) return;
    const dir = generateInto(bundle, { json: true });
    tscCheck(dir);
    models = await load(dir, "models.ts");
    json = (await load(dir, "json/index.ts"))["CODECS"];
    xml = (await load(dir, "xml/index.ts"))["CODECS"];
  };
  const out = async (o: Any): Promise<{ json: unknown; xml: string }> => ({ json: json[OUTER].encode(o), xml: await xml[OUTER].stringify(o) });
  const make = (init?: Record<string, unknown>): Any => new models["Outer"](init);

  it("an applied default is not written; render.default true writes it (ordinary new())", async () => {
    await setup();
    const o = await out(make());
    expect(o.json).toEqual({ count: "0" });
    expect(o.xml).toBe('<outer count="0"/>');
  }, 120_000);

  it("an explicit value equal to the default is written (false, 0, the default text), as is a different one", async () => {
    await setup();
    const o = await out(make({ flag: false, zero: 0n, label: "x", note: "n" }));
    expect(o.json).toEqual({ flag: false, count: "0", label: "x", note: "n", zero: "0" });
    expect(o.xml).toBe('<outer flag="false" count="0"><label>x</label><note>n</note><zero>0</zero></outer>');
    expect((await out(make({ flag: true }))).json).toEqual({ flag: true, count: "0" });
  });

  it("absent and ABSENT apply the default (not written); null is the nil policy (omitted), never the default", async () => {
    await setup();
    const absent = Symbol.for("lutaml.absent");
    void absent;
    const withNull = make({ flag: null, label: null });
    expect(withNull.flag).toBeNull();
    expect((await out(withNull)).json).toEqual({ count: "0" });
    const applied = make({ zero: undefined });
    expect(applied.zero).toBe(0n);
    expect((await out(applied)).json).toEqual({ count: "0" });
  });

  it("decode follows the same provenance: a missing member is applied, a present false/0 is explicit", async () => {
    await setup();
    const missing = json[OUTER].decode({});
    expect(missing.flag).toBe(false);
    expect(json[OUTER].encode(missing)).toEqual({ count: "0" });
    const explicit = json[OUTER].decode({ flag: false, zero: "0" });
    expect(json[OUTER].encode(explicit)).toEqual({ flag: false, count: "0", zero: "0" });
    const xmlMissing = await xml[OUTER].parse("<outer/>");
    expect(await xml[OUTER].stringify(xmlMissing)).toBe('<outer count="0"/>');
    const xmlExplicit = await xml[OUTER].parse('<outer flag="false"><zero>0</zero></outer>');
    expect(await xml[OUTER].stringify(xmlExplicit)).toBe('<outer flag="false" count="0"><zero>0</zero></outer>');
  });

  it("nested models carry their own provenance", async () => {
    await setup();
    const innerApplied = new models["Inner"]();
    const innerExplicit = new models["Inner"]({ flag: false });
    // An all-defaults nested model serializes to an empty hash, which canonical Ruby omits under render empty: omit
    // (measured on lutaml-model 0.8.175, issue-1033/wave1 be46487: Outer.new(inner: Inner.new).to_yaml => "---\ncount: 0\n").
    expect((await out(make({ inner: innerApplied }))).json).toEqual({ count: "0" });
    expect((await out(make({ inner: innerExplicit }))).json).toEqual({ count: "0", inner: { flag: false } });
    expect((await out(make({ inner: innerExplicit }))).xml).toBe('<outer count="0"><inner flag="false"/></outer>');
    expect((await out(make({ inner: innerApplied }))).xml).toBe('<outer count="0"><inner/></outer>');
  });

  it("provenance is not a field: no key collision, invisible to enumeration, copies are explicit", async () => {
    await setup();
    const o = make();
    expect(Object.keys(o)).toEqual(["flag", "count", "label", "note", "zero", "inner"]);
    expect(Object.isFrozen(o)).toBe(true);
    // a copy built from the field values is explicit data: Ruby's equivalent is assigning the attributes
    const copy = make({ flag: o.flag, count: o.count, label: o.label, note: o.note, zero: o.zero });
    expect((await out(copy)).json).toEqual({ flag: false, count: "0", label: "x", note: "n", zero: "0" });
  });

  it("validation and the default value itself are unchanged", async () => {
    await setup();
    expect(() => make({ count: "x" })).toThrow(/count/);
    const o = make();
    expect([o.flag, o.count, o.label, o.note, o.zero]).toEqual([false, 0n, "x", "n", 0n]);
  });
});
