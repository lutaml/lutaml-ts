import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Bindings, Bundle } from "../../../src/contracts.js";
import { bundleChecksum, loadBundle } from "../../../src/lml/index.js";
import type { Tree } from "../../../scripts/mml/lib.mjs";
import { canonicalTree, dump, firstDiff, stripWs } from "../../../scripts/mml/lib.mjs";
import { generateInto, infoOf, load, tscCheck } from "../../xml/harness.js";

// Real UnitsML (Unit + Conversions + Symbol) replay: the actual unitsml-ruby graph with its ONE handwritten hook
// (Units::Symbol content), generated into strict typed XML codecs, with the handwritten Symbol handlers installed per
// operation. Expected values come from evidence/f15-unit-cases.json (recorded from real Ruby runs, never hand-written).
const HERE = import.meta.dirname;
const fixtureBytes = readFileSync(join(HERE, "fixtures/real-unit.json"));
const provenance = JSON.parse(readFileSync(join(HERE, "fixtures/provenance.json"), "utf8")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Case {
  id: string;
  model: string;
  ruby_xml?: string;
  input_xml?: string;
  portable_json?: Record<string, unknown>;
  parsed_portable_json: Record<string, unknown>;
  reserialized_xml: string;
  content_stored?: boolean;
}
const cases = (JSON.parse(readFileSync(join(HERE, "fixtures/unit-cases.json"), "utf8")) as { cases: Case[]; symbol_raw_markup_checks: Record<string, boolean> });
const BINDINGS: Bindings = {
  types: {
    "xml:id": { module: "./xml-id.js", export: "XmlId" },
    "xml:lang": { module: "./xml-lang.js", export: "XmlLang" },
  },
};
const SYMBOL = "Unitsml::Model::Units::Symbol@default";
const UNITSML_NS = "https://schema.unitsml.org/unitsml/1.0";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = Record<string, any>;

const bundle = (): Bundle => loadBundle(fixtureBytes, "json");

/** The generated model as the Ruby portable-JSON shape: absent members dropped, integers as strings. */
function neutral(value: unknown): unknown {
  if (value === null || value === undefined || typeof value === "symbol") return undefined;
  if (typeof value === "bigint" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? undefined : value.map(neutral);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "__lml_model") continue;
      const n = neutral(v);
      if (n !== undefined) out[k] = n;
    }
    return out;
  }
  return value;
}
function rubyNeutral(value: unknown): unknown {
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(rubyNeutral);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rubyNeutral(v)]));
  return value;
}

/** Builds a generated model from Ruby portable JSON using the bundle's declared attribute types. */
function construct(models: Any, b: Bundle, id: string, data: Record<string, unknown>): unknown {
  const doc = b.models[id] as unknown as { attributes: { name: string; type: { kind: string; name?: string; id?: string }; collection: unknown }[] };
  const init: Record<string, unknown> = {};
  for (const attr of doc.attributes) {
    if (!Object.hasOwn(data, attr.name)) continue;
    const raw = data[attr.name];
    const one = (item: unknown): unknown => {
      if (attr.type.kind === "model") return construct(models, b, attr.type.id as string, item as Record<string, unknown>);
      if (attr.type.kind === "builtin" && attr.type.name === "integer") return BigInt(String(item));
      return item;
    };
    init[attr.name] = attr.collection === false ? one(raw) : (raw as unknown[]).map(one);
  }
  const cls = Object.values(models).find((v) => typeof v === "function" && (v as { modelId?: string }).modelId === id) as new (i: unknown) => unknown;
  return new cls(init);
}

const attributeNames = (tree: Tree): string[] => {
  const [, attrs, kids] = tree;
  return [...attrs.map(([[ns, local]]) => `${ns}|${local}`), ...kids.flatMap((k) => (typeof k === "string" ? [] : attributeNames(k)))];
};

describe("fixture provenance", () => {
  it("pins the real sources, the Nokogiri oracle adapter and the explicit bindings", () => {
    expect(provenance["heads"]["unitsml"]).toBe("ee09d6d7f87bb2f76069d1cb6ced6c64cbb2ebb1");
    expect(provenance["heads"]["oracle"]).toBe("9db47641d84587df4241d9f5639a92f566f33cfa");
    expect(provenance["source_trees_clean"]).toEqual({ lutaml: true, unitsml: true });
    expect(provenance["xml_adapter"]).toBe("Lutaml::Xml::Adapter::NokogiriAdapter");
    expect(Object.keys(provenance["options"]["value_type_registrations"]).sort()).toEqual(["xml:id", "xml:lang"]);
    expect(provenance["options"]["default_bindings"]).toEqual({ "Unitsml::Model::Units::Name@default": { lang: "en" }, "Unitsml::Model::Units::System@default": { lang: "en" } });
  });

  it("the bundle is the real 11-model graph with exactly one hooked model, and its checksum is the shared one", () => {
    const loaded = bundle();
    expect(Object.keys(loaded.models)).toHaveLength(11);
    expect(bundleChecksum(loaded)).toBe("sha256:ab95bbb6b621843c834a81646378c72c2c1f2b0cd4fed9bb09ba3ea568cec9ad");
    const hooked = Object.entries(loaded.models).filter(([, m]) =>
      Object.values(m.mappings).some((mp) => (mp as { rules: { custom?: unknown }[] }).rules.some((r) => r.custom !== undefined)),
    );
    expect(hooked.map(([id]) => id)).toEqual([SYMBOL]);
  });

  it("covers every required Unit condition", () => {
    const ids = cases.cases.map((c) => c.id);
    for (const required of ["unit-name-default-language", "unit-name-explicit-language", "system-default-language", "system-explicit-language", "symbol-raw-markup",
      "symbol-raw-markup-ampersand", "symbol-parsed-read-no-op", "root-units-mapping", "conversion-exact-string-false-note", "unit-full"]) {
      expect(ids).toContain(required);
    }
    expect(ids.filter((i) => i.startsWith("conversion-frozen-"))).toHaveLength(3);
    expect(cases.symbol_raw_markup_checks).toEqual({ markup_not_escaped: true, ampersand_preserved: true });
  });
});

describe("generated Unit XML codecs with handwritten Symbol hooks vs the Ruby oracle", () => {
  let dir: string;
  let xml: Any;
  let models: Any;
  let installed: Any;
  const rows: Record<string, { tree: boolean | null; data: boolean | null; bytes: boolean | null }> = {};

  it("generates, compiles under strict tsc with the typed handwritten Symbol handlers, and loads", { timeout: 180_000 }, async () => {
    dir = generateInto(bundle(), {
      bindings: BINDINGS,
      extra: {
        "xml-id.ts": readFileSync(join(HERE, "bindings/xml-id.ts"), "utf8"),
        "xml-lang.ts": readFileSync(join(HERE, "bindings/xml-lang.ts"), "utf8"),
        "unit-hooks.ts": readFileSync(join(HERE, "bindings/unit-hooks.ts"), "utf8"),
      },
    });
    tscCheck(dir);
    xml = await load(dir, "xml/index.ts");
    models = await load(dir, "models.ts");
    installed = xml["withHooks"]((await load(dir, "unit-hooks.ts"))["unitHooks"], null);
    expect(Object.keys(xml["CODECS"]).sort()).toEqual(Object.keys(bundle().models).sort());
  });

  for (const c of cases.cases) {
    describe(c.id, () => {
      const modelId = `${c.model}@default`;

      it("reads the Ruby XML into the Ruby parsed data (default language, explicit language, no-op Symbol read)", async () => {
        const value = await installed[modelId].parse(c.input_xml ?? (c.ruby_xml as string));
        const diff = firstDiff(rubyNeutral(c.parsed_portable_json), neutral(dump(value)));
        (rows[c.id] ??= { tree: null, data: null, bytes: null }).data = diff === null;
        expect(diff).toBeNull();
      });

      it("parse then serialize equals Ruby's own reserialization (tree, namespaces)", async () => {
        const codec = installed[modelId];
        const out = await codec.stringify(await codec.parse(c.input_xml ?? (c.ruby_xml as string)));
        const diff = firstDiff(stripWs(await canonicalTree(c.reserialized_xml)), stripWs(await canonicalTree(out)));
        expect(diff).toBeNull();
      });

      if (c.portable_json !== undefined) {
        it("constructed from the Ruby data, writes the Ruby XML tree (raw markup, default language, exact strings)", async () => {
          const model = construct(models, bundle(), modelId, c.portable_json as Record<string, unknown>);
          const out = await installed[modelId].stringify(model);
          const diff = firstDiff(stripWs(await canonicalTree(c.ruby_xml as string)), stripWs(await canonicalTree(out)));
          const row = (rows[c.id] ??= { tree: null, data: null, bytes: null });
          row.tree = diff === null;
          row.bytes = out === c.ruby_xml;
          expect(diff).toBeNull();
          if (out.includes("xml:lang")) expect(attributeNames(await canonicalTree(out)).some((n) => n === "http://www.w3.org/XML/1998/namespace|lang")).toBe(true);
          // namespaces are compared as namespaces (the writer uses the mapping's unitsml prefix; Ruby the default namespace)
          expect((await canonicalTree(out))[0]).toEqual([UNITSML_NS, (await canonicalTree(c.ruby_xml as string))[0][1]]);
        });
      }
    });
  }

  it("Symbol raw markup is written unescaped, in no namespace under the UnitsML parent, and keeps its ampersand", async () => {
    const markup = cases.cases.find((c) => c.id === "symbol-raw-markup") as Case;
    const amp = cases.cases.find((c) => c.id === "symbol-raw-markup-ampersand") as Case;
    const out = await installed[SYMBOL].stringify(construct(models, bundle(), SYMBOL, markup.portable_json as Record<string, unknown>));
    expect(out).toContain("<i>m</i>"); // the writer's parent is prefixed, so the fragment needs no xmlns="" (Ruby's default-namespace parent does)
    expect(out).not.toContain("&lt;");
    const tree = await canonicalTree(out);
    expect(tree[0]).toEqual([UNITSML_NS, "UnitSymbol"]);
    expect((tree[2].find((k) => typeof k !== "string") as Tree)[0]).toEqual(["", "i"]);
    const withAmp = await installed[SYMBOL].stringify(construct(models, bundle(), SYMBOL, amp.portable_json as Record<string, unknown>));
    expect(withAmp).toContain("<i>m &amp; n</i>");
  });

  it("the parsed Symbol keeps its declared type and never stores raw input (explicit read no-op)", async () => {
    const parsed = cases.cases.find((c) => c.id === "symbol-parsed-read-no-op") as Case;
    const value = await installed[SYMBOL].parse(parsed.input_xml as string);
    expect(value.type).toBe("HTML");
    expect(typeof value.content).toBe("symbol");
    expect(parsed.content_stored).toBe(false);
  });

  it("without the handwritten hooks the Symbol rule fails by name in either direction", async () => {
    const plain = xml["CODECS"][SYMBOL];
    const input = (cases.cases.find((c) => c.id === "symbol-parsed-read-no-op") as Case).input_xml as string;
    expect(await infoOf(() => plain.parse(input))).toMatchObject({ reason: "custom_serialization", model_id: SYMBOL, rule: "content" });
    const model = construct(models, bundle(), SYMBOL, { type: "HTML", content: "<i>m</i>" });
    expect(await infoOf(() => plain.stringify(model))).toMatchObject({ reason: "custom_serialization", model_id: SYMBOL, rule: "content" });
    // a Unit reaching a Symbol without the hooks fails as well; the hooked Unit parses
    const unit = cases.cases.find((c) => c.id === "unit-full") as Case;
    expect(await infoOf(() => xml["CODECS"]["Unitsml::Model::Unit@default"].parse(unit.ruby_xml as string))).toMatchObject({ reason: "custom_serialization", model_id: SYMBOL });
    expect((await installed["Unitsml::Model::Unit@default"].parse(unit.ruby_xml as string)).id).toBe("NISTu1");
  });

  it("reports tree, data and byte results separately", () => {
    const summary = { tree: 0, treeTotal: 0, data: 0, dataTotal: 0, bytes: 0, bytesTotal: 0 };
    for (const r of Object.values(rows)) {
      if (r.tree !== null) { summary.treeTotal += 1; if (r.tree) summary.tree += 1; }
      if (r.data !== null) { summary.dataTotal += 1; if (r.data) summary.data += 1; }
      if (r.bytes !== null) { summary.bytesTotal += 1; if (r.bytes) summary.bytes += 1; }
    }
    writeFileSync(join(tmpdir(), "lml-unit-hooks-results.json"), JSON.stringify({ rows, summary }, null, 2));
    expect(summary.tree).toBe(summary.treeTotal);
    expect(summary.data).toBe(summary.dataTotal);
    expect(summary.treeTotal).toBe(cases.cases.filter((c) => c.portable_json !== undefined).length);
  });
});
