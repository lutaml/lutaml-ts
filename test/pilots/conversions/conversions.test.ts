import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { Bindings, Bundle } from "../../../src/contracts.js";
import { generateModelsWith } from "../../../src/generator/index.js";
import { loadBundle } from "../../../src/lml/index.js";
import { createXmlEmitter } from "../../../src/xml/index.js";
import type { Tree } from "../../../scripts/mml/lib.mjs";
import { canonicalTree, dump, firstDiff, stripWs } from "../../../scripts/mml/lib.mjs";

// Conversions-only PARTIAL A6 evidence: the real UnitsML Conversions graph
// (unitsml-ruby ee09d6d7, exported by lutaml-model 8531b54d with XmlIdType
// registered explicitly) is generated into typed TS XML codecs and replayed
// against Ruby (Nokogiri adapter) oracles. Unit and Uncertainty are NOT covered.
// The fixture is committed; generate.rb needs explicit source roots and is not run here.
const probe = spawnSync(process.execPath, ["--input-type=module", "-e", 'await import("moxml-ts")'], { encoding: "utf8" });
const available = probe.status === 0;

const REPO = resolve(import.meta.dirname, "../../..");
const HERE = import.meta.dirname;
const created: string[] = [];
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

interface Case {
  id: string;
  model_id: string;
  source: string;
  input_xml?: string;
  ruby_xml: string;
  portable_json: unknown;
}
interface Fixture {
  provenance: Record<string, unknown>;
  bundle: Bundle;
  cases: Case[];
}
const fixtureText = readFileSync(join(HERE, "fixtures/conversions.json"));
const fixture = JSON.parse(fixtureText.toString("utf8")) as Fixture;
const XML_ID: Bindings = { types: { "xml:id": { module: "./xml-id.js", export: "XmlId" } } };
const NONE: Bindings = { types: {} };
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const UNITSML_NS = "https://schema.unitsml.org/unitsml/1.0";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loaded = Record<string, any>;

function generateInto(bundle: Bundle, bindings: Bindings): string {
  const dir = mkdtempSync(join(tmpdir(), "lml-conv-"));
  created.push(dir);
  const contractsModule = "./contracts-shim.js";
  const files = generateModelsWith(bundle, bindings, [createXmlEmitter({ contractsModule })], { contractsModule });
  for (const [path, text] of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  copyFileSync(join(REPO, "src/contracts.ts"), join(dir, "contracts-shim.ts"));
  copyFileSync(join(HERE, "bindings/xml-id.ts"), join(dir, "xml-id.ts"));
  writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022", lib: ["ES2022"], module: "NodeNext", moduleResolution: "NodeNext", types: [],
      strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noImplicitOverride: true,
      noFallthroughCasesInSwitch: true, noUnusedLocals: true, noUnusedParameters: true,
      verbatimModuleSyntax: true, isolatedModules: true, skipLibCheck: true, noEmit: true,
    },
    include: ["./*.ts", "./xml/*.ts"],
  }));
  try {
    execFileSync(process.execPath, [join(REPO, "node_modules/typescript/bin/tsc"), "-p", join(dir, "tsconfig.json")], { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    const out = error as { stdout?: string; stderr?: string };
    throw new Error(`tsc failed:\n${out.stdout ?? ""}${out.stderr ?? ""}`);
  }
  return dir;
}

/** The generated model as the Ruby portable-JSON shape: absent members dropped, integers as strings. */
function neutral(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "bigint" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? undefined : value.map(neutral);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "__lml_model") continue; // dump()'s model-id marker, not model data
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
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rubyNeutral(v)]));
  }
  return value;
}

/** Collects every (namespace, local) attribute name of a canonical tree. */
function attributeNames(tree: Tree): string[] {
  const [, attrs, kids] = tree;
  return [...attrs.map(([[ns, local]]) => `${ns}|${local}`), ...kids.flatMap((k) => (typeof k === "string" ? [] : attributeNames(k)))];
}

describe("fixture provenance", () => {
  it("pins every source head, the Nokogiri oracle adapter and the explicit registration", () => {
    const p = fixture.provenance as { heads: Record<string, string>; xml_adapter: string; value_type_registration: Record<string, unknown>; bundle_checksum: string };
    expect(p.heads).toEqual({
      lutaml: "8531b54dd14b03eed894f6a7f665f3029c7e5324",
      unitsml: "ee09d6d7f87bb2f76069d1cb6ced6c64cbb2ebb1",
      oracle: "9db47641d84587df4241d9f5639a92f566f33cfa",
    });
    expect(p.xml_adapter).toBe("Lutaml::Xml::Adapter::NokogiriAdapter");
    expect(p.value_type_registration).toEqual({ "xml:id": { class: "Lutaml::Xml::W3c::XmlIdType", base: "string", facets: {} } });
    expect(p.bundle_checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("the bundle is the real five-model Conversions graph and loads through loadBundle", () => {
    const loaded = loadBundle(Buffer.from(JSON.stringify(fixture.bundle)), "json");
    expect(Object.keys(loaded.models).map((id) => id.split("::").pop()).sort()).toEqual([
      "ConversionNote@default", "Conversions@default", "Float64ConversionFrom@default",
      "SpecialConversionFrom@default", "WsdlConversionFrom@default",
    ]);
    expect(loaded.value_types).toEqual({ "xml:id": { base: "string", facets: {} } });
  });

  it("uses exact frozen testsuite lexical values", () => {
    const frozen = fixture.cases.filter((c) => c.id.startsWith("frozen-")).map((c) => c.input_xml);
    expect(frozen.length).toBeGreaterThan(0);
    expect(frozen.join("\n")).toContain('finalAddend="273.15"');
    expect(frozen.join("\n")).toContain('initialAddend="-273.15" multiplicand="9" divisor="5" finalAddend="32"');
    expect(frozen.join("\n")).toContain('finalAddend="-273.16"');
  });
});

const FACET_FREE_REFUSAL = [createXmlEmitter({ contractsModule: "./c.js" })];

describe("generation with the xml:id binding", () => {
  it("a missing binding for a faceted value type is refused by name (preservation)", () => {
    const faceted = structuredClone(fixture.bundle) as Bundle;
    (faceted.value_types as Record<string, unknown>)["xml:id"] = { base: "string", facets: { white_space: "collapse" } };
    expect(() => generateModelsWith(faceted, NONE, FACET_FREE_REFUSAL, { contractsModule: "./c.js" })).toThrow(/missing_type_binding/);
  });

  // KNOWN GAP (reported, not weakened): the real facet-free xml:id value type with NO binding is generated as a
  // plain string today instead of being refused. `it.fails` passes while the gap exists and goes red when fixed.
  it.fails("an unbound facet-free xml:id is refused as missing_type_binding", () => {
    expect(() => generateModelsWith(fixture.bundle, NONE, FACET_FREE_REFUSAL, { contractsModule: "./c.js" })).toThrow(/missing_type_binding/);
  });
});

describe.skipIf(!available)("generated Conversions XML codecs (moxml-ts) vs the Ruby oracle", () => {
  let mod: Loaded;
  it("generate from the exported IR as-is, compile under strict tsc and load", { timeout: 180_000 }, async () => {
    mod = (await import(pathToFileURL(join(generateInto(fixture.bundle, XML_ID), "index.ts")).href)) as Loaded;
    expect(Object.keys(mod["xml"].CODECS).sort()).toEqual(Object.keys(fixture.bundle.models).sort());
  });

  it("the exported rules state the namespaces Ruby serializes", () => {
    const rules = (id: string) => (fixture.bundle.models[`Unitsml::Model::Units::${id}@default`] as unknown as { mappings: { xml: { rules: { name: string[]; namespace: unknown }[] } } })
      .mappings.xml.rules;
    for (const model of ["Float64ConversionFrom", "SpecialConversionFrom", "WsdlConversionFrom"]) {
      expect(rules(model).find((r) => r.name[0] === "id")?.namespace).toEqual({ mode: "uri", prefix: "xml", uri: XML_NS });
    }
    expect(rules("SpecialConversionFrom").find((r) => r.name[0] === "ConversionDescription")?.namespace).toEqual({ mode: "unqualified" });
    expect(rules("WsdlConversionFrom").find((r) => r.name[0] === "WSDLDescription")?.namespace).toEqual({ mode: "unqualified" });
    expect(rules("Float64ConversionFrom").find((r) => r.name[0] === "initialUnit")?.namespace).toEqual({ mode: "inherit" });
    expect(fixture.cases[0]?.ruby_xml).toContain(' xml:id="');
    expect(fixture.cases[0]?.ruby_xml).toContain(`xmlns="${UNITSML_NS}"`);
  });

  for (const c of fixture.cases) {
    describe(c.id, () => {
      const xml = c.input_xml ?? c.ruby_xml;

      it("reads the Ruby XML into the Ruby portable-JSON data (exact lexical strings, flags, children)", async () => {
        const value = await mod["xml"].CODECS[c.model_id].parse(xml);
        expect(firstDiff(rubyNeutral(c.portable_json), neutral(dump(value)))).toBeNull();
      });

      it("serializes to the Ruby XML tree under the namespace-aware profile (xml:id in the XML namespace)", async () => {
        const codec = mod["xml"].CODECS[c.model_id];
        const out = await codec.stringify(await codec.parse(xml));
        expect(firstDiff(stripWs(await canonicalTree(c.ruby_xml)), stripWs(await canonicalTree(out)))).toBeNull();
        expect(attributeNames(await canonicalTree(out)).filter((n) => n.endsWith("|id"))).not.toEqual([]);
      });
    });
  }

  it("keeps the long exact lexical strings and flags", async () => {
    const c = fixture.cases.find((x) => x.id === "constructed-float64-long-lexical") as Case;
    const value = await mod["xml"].CODECS[c.model_id].parse(c.ruby_xml);
    expect(value.final_addend).toBe("273.150000000000000000000000000000000000000000000000000000000001");
    expect(value.initial_addend).toBe("-273.150000000000000000000000000000000000000000000000000000000001");
    expect(value.exact).toBe(false);
    expect(value.id).toBe("NISTc_long");
  });

  it("byte parity with Ruby's text is reported separately (not part of the tree profile)", async () => {
    const rows: Record<string, boolean> = {};
    for (const c of fixture.cases) {
      const codec = mod["xml"].CODECS[c.model_id];
      rows[c.id] = (await codec.stringify(await codec.parse(c.input_xml ?? c.ruby_xml))) === c.ruby_xml;
    }
    writeFileSync(join(tmpdir(), "lml-conversions-byte-parity.json"), JSON.stringify(rows, null, 2));
    expect(Object.keys(rows).length).toBe(fixture.cases.length);
  });
});
