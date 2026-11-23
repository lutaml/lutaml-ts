/**
 * Real Plurimath `Uncertainty` consumer (second pilot): typed classes and key-value codecs GENERATED from the
 * exact Ruby-exported bundle, the 25 source hook rules implemented by HANDWRITTEN target-local bindings, and
 * the 10 actual source contract cases replayed. No math writer or evaluator is claimed.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateModelsWith } from "../../../src/generator/index.js";
import { createKeyValueEmitter } from "../../../src/codecs/index.js";
import { bundleChecksum, loadBundle } from "../../../src/lml/index.js";
import { generated } from "../../generator/support.js";
import { HookRefusal, NODE_FIELDS, SYMBOL_FIELDS, createUncertaintyHooks, newState } from "./bindings/uncertainty-hooks.js";
import type { UncertaintyState } from "./bindings/uncertainty-hooks.js";

const HERE = import.meta.dirname;
const REPO = resolve(HERE, "../../..");
const BUNDLE_BYTES = readFileSync(join(HERE, "fixtures/bundle.json"));
const CASES_BYTES = readFileSync(join(HERE, "fixtures/cases.json"));
const UNC = "Plurimath::Math::Function::Uncertainty@default";
const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

interface Case {
  id: string;
  model_fields: Record<string, unknown>;
  input_json: Record<string, unknown>;
  ruby_json: Record<string, unknown>;
}
const fixture = JSON.parse(CASES_BYTES.toString("utf8")) as { provenance: Record<string, string>; cases: Case[]; excluded_outside_finite_graph: unknown[] };
const bundle = () => loadBundle(BUNDLE_BYTES, "json");
const created: string[] = [];
afterAll(() => created.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("pinned inputs", () => {
  it("are the exact root artifacts", () => {
    expect(sha(BUNDLE_BYTES)).toBe("a33485b50c90bd55add555470ab6e249da367991d4cc7c021934c6c73442fe10");
    expect(sha(CASES_BYTES)).toBe("3d07c837713f0190cbb4aa5062721b5f09a96e580628564de1e38143f7b220a0");
    expect(bundleChecksum(bundle())).toBe("sha256:34354ce6b8ea0e8fd9d3ca91a6e29774e4fc0a65e1bdab92a5586224ea1d154e");
    expect(fixture.provenance).toMatchObject({
      plurimath_head: "050a3a9cd677e8a17baf47bef01348a8e6296f34",
      lutaml_head: "74a0ab8ae559c83679fc8aeb8ee8daab0413681e",
      contract_sha256: "50bdb09013dc22d35750d1846889fc65a736377df927a1e8d576d44e1f19e0c6",
    });
    expect(fixture.cases).toHaveLength(10);
    expect(fixture.excluded_outside_finite_graph).toHaveLength(0);
  });

  it("keeps all 40 rules and 25 hook rules on the Uncertainty root, and no hooks on the other models", () => {
    const models = bundle().models;
    const rules = (id: string): readonly { custom?: unknown }[] => (models[id]?.mappings as unknown as { json?: { rules: { custom?: unknown }[] } }).json?.rules ?? [];
    expect(rules(UNC)).toHaveLength(40);
    expect(rules(UNC).filter((r) => r.custom !== undefined)).toHaveLength(25);
    for (const id of Object.keys(models).filter((k) => k !== UNC)) expect(rules(id).filter((r) => r.custom !== undefined)).toHaveLength(0);
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const setup = async (): Promise<{ models: Any; json: Any; codec: Any; reason: (run: () => unknown) => Record<string, unknown> }> => {
  const out = await generated(bundle(), { json: true });
  const json = out.json as Any;
  const reason = (run: () => unknown): Record<string, unknown> => {
    try { run(); } catch (error) {
      const info = (error as { info?: Record<string, unknown> }).info;
      if (info === undefined) throw error;
      return { reason: info["reason"], location: info["location"], model: info["model_id"], detail: info["detail"] };
    }
    return {};
  };
  return { models: out.models, json, codec: json["codecPlurimathMathFunctionUncertainty"], reason };
};
const replay = (json: Any, codec: Any, text: string, state: UncertaintyState = newState()): { model: Any; state: UncertaintyState; out: string } => {
  const hooks = { [UNC]: createUncertaintyHooks() };
  return json["withHooks"](hooks, state, () => {
    const model = codec.parse(text);
    return { model, state, out: codec.stringify(model) };
  });
};

describe("generated typed consumer: the 10 actual source cases", () => {
  it.each(fixture.cases.map((c) => [c.id, c] as const))("%s: declared data, hook state and Ruby JSON", async (_id, c) => {
    const { models, json, codec } = await setup();
    const { model, state, out } = replay(json, codec, JSON.stringify(c.input_json));
    // Declared data: the polymorphic node views are typed instances, the strings stay exact.
    expect(model).toBeInstanceOf(models["PlurimathMathFunctionUncertainty"]);
    expect(model.__class).toBe("Plurimath::Math::Function::Uncertainty");
    for (const field of NODE_FIELDS) {
      const want = c.model_fields[field];
      const node = model[`__${field}_node`];
      if (want === null || want === undefined) expect(typeof node === "symbol" || node === null || node === undefined).toBe(true);
      else if (field === "unit") {
        expect(node).toBeInstanceOf(models["PlurimathMathFunctionUnitsml"]);
        expect(node.text).toBe((want as { text: string }).text);
      } else {
        expect(node).toBeInstanceOf(models["PlurimathMathNumber"]);
        expect(node.value).toBe(want);
        expect(node.mini_sub_sized).toBe(false);
        expect(node.mini_sup_sized).toBe(false);
      }
    }
    // Hook state: exactly the symbol fields the source carries, nothing else.
    for (const field of SYMBOL_FIELDS) expect(state.symbols[field]).toBe(c.model_fields[field] ?? undefined);
    expect(state.text).toEqual({});
    expect(state.value).toEqual({});
    expect(state.mixed).toEqual({});
    // Reserialization equals Ruby: tree equality and exact (ordered) text.
    expect(JSON.parse(out)).toEqual(c.ruby_json);
    expect(out).toBe(JSON.stringify(c.ruby_json));
  });
});

describe("handwritten hooks implement the source contracts", () => {
  const run = async (): Promise<{ json: Any; codec: Any; reason: (r: () => unknown) => Record<string, unknown> }> => setup();
  const decode = (json: Any, codec: Any, wire: Record<string, unknown>): UncertaintyState => replay(json, codec, JSON.stringify({ __class: "Plurimath::Math::Function::Uncertainty", ...wire })).state;
  const roundTrip = (json: Any, codec: Any, wire: Record<string, unknown>): Record<string, unknown> =>
    JSON.parse(replay(json, codec, JSON.stringify({ __class: "Plurimath::Math::Function::Uncertainty", ...wire })).out);

  it.each(SYMBOL_FIELDS)("%s keeps a closed symbol vocabulary and refuses other shapes", async (field) => {
    const { json, codec } = await run();
    const tags: Record<string, string> = { category: "expanded", interval_kind: "shortest", notation: "concise", distribution: "triang" };
    expect(decode(json, codec, { [field]: tags[field] }).symbols[field]).toBe(tags[field]);
    expect(roundTrip(json, codec, { [field]: tags[field] })[field]).toBe(tags[field]);
    expect(() => decode(json, codec, { [field]: "bogus" })).toThrow(HookRefusal);
    expect(() => decode(json, codec, { [field]: 7 })).toThrow(HookRefusal);
    expect(() => decode(json, codec, { [field]: { string: "standard" } })).toThrow(HookRefusal);
    expect(decode(json, codec, { [field]: null }).symbols[field]).toBeUndefined();
  });

  it.each(NODE_FIELDS)("%s text/value/mixed hooks round-trip their own slot only", async (field) => {
    const { json, codec } = await run();
    const wire = {
      [`${field}_text`]: "1,23",
      [`${field}_value`]: { align: "left", nested: { n: [1, "x"], __string_keys: ["n"] }, __string_keys: ["id"], id: "a" },
      [`${field}_mixed`]: [{ text: "a" }, { class: "Plurimath::Math::Number", node: { __class: "Plurimath::Math::Number", value: "2" } }, { text: "b" }],
    };
    const state = decode(json, codec, wire);
    expect(Object.keys(state.text)).toEqual([field]);
    expect(Object.keys(state.value)).toEqual([field]);
    expect(Object.keys(state.mixed)).toEqual([field]);
    const out = roundTrip(json, codec, wire);
    expect(out[`${field}_text`]).toBe("1,23");
    expect(out[`${field}_value`]).toEqual(wire[`${field}_value`]);
    expect(out[`${field}_mixed`]).toEqual(wire[`${field}_mixed`]);
    // the source's empty-array value form
    expect(roundTrip(json, codec, { [`${field}_value`]: [] })[`${field}_value`]).toEqual([]);
  });

  it.each(NODE_FIELDS)("%s hooks refuse unsupported shapes and unknown node classes", async (field) => {
    const { json, codec } = await run();
    for (const bad of [
      { [`${field}_text`]: 5 },
      { [`${field}_value`]: "x" },
      { [`${field}_value`]: [1] },
      { [`${field}_value`]: { __string_keys: "id" } },
      { [`${field}_mixed`]: "x" },
      { [`${field}_mixed`]: [{ text: 5 }] },
      { [`${field}_mixed`]: [{ class: "Plurimath::Math::Nope", node: {} }] },
      { [`${field}_mixed`]: [{ class: "Plurimath::Math::Number", node: "x" }] },
    ]) {
      expect(() => decode(json, codec, bad), JSON.stringify(bad)).toThrow(HookRefusal);
    }
  });

  it("an all-node mixed list is not written (the node view owns it), exactly like the source", async () => {
    const { json, codec } = await run();
    const wire = { value_mixed: [{ class: "Plurimath::Math::Number", node: { value: "1" } }] };
    expect(roundTrip(json, codec, wire)["value_mixed"]).toBeUndefined();
  });

  it("refuses an unknown polymorphic tag and keeps known fields", async () => {
    const { json, codec, reason } = await run();
    const text = JSON.stringify({ __class: "Plurimath::Math::Function::Uncertainty", value: { __class: "Plurimath::Math::Nope", value: "1" } });
    expect(reason(() => replay(json, codec, text)).reason).toBe("unknown_discriminator");
  });
});

describe("explicit missing handlers and application init stay separate", () => {
  const first = fixture.cases[0] as Case;
  const text = JSON.stringify(first.input_json);

  it("a read reaching a hooked key with no handler fails custom_serialization, naming model and key", async () => {
    const { json, codec, reason } = await setup();
    expect(reason(() => codec.parse(text))).toMatchObject({ reason: "custom_serialization", location: "/category", model: UNC });
    // only the attempted direction: the decoded model has declared data, and a write with no hooks fails by name too
    const hooks = { [UNC]: createUncertaintyHooks() };
    const model = json["withHooks"](hooks, newState(), () => codec.parse(text));
    expect(reason(() => codec.stringify(model))).toMatchObject({ reason: "custom_serialization", location: "/category", model: UNC });
  });

  it("removing one handler fails exactly that direction", async () => {
    const { json, codec, reason } = await setup();
    const all = createUncertaintyHooks();
    const { notation_from_kv: _drop, ...noNotationRead } = all;
    const state = newState();
    expect(reason(() => json["withHooks"]({ [UNC]: noNotationRead }, state, () => codec.parse(text)))).toMatchObject({ reason: "custom_serialization", location: "/notation" });
    const { notation_to_kv: _drop2, ...noNotationWrite } = all;
    const model = json["withHooks"]({ [UNC]: all }, newState(), () => codec.parse(text));
    expect(reason(() => json["withHooks"]({ [UNC]: noNotationWrite }, newState(), () => codec.stringify(model)))).toMatchObject({ reason: "custom_serialization", location: "/notation" });
  });

  it("the target constructor stub fails custom_initialize; explicit handwritten initialization is separate", async () => {
    const { models, reason } = await setup();
    const Unc = models["PlurimathMathFunctionUncertainty"];
    expect(Unc.customInitialize).toBe(true);
    expect(reason(() => Unc.construct({ category: "standard" }))).toMatchObject({ reason: "custom_initialize", model: UNC });
    // Target-local application init (this is the consumer's code, never generated): builds declared data.
    const init = (args: { category: string; value: string }): Any => {
      if (!["standard", "expanded", "coverage_interval"].includes(args.category)) throw new Error("unknown category");
      return { __class: UNC.split("@")[0], __value_node: new models["PlurimathMathNumber"]({ __class: "Plurimath::Math::Number", value: args.value }) };
    };
    const built = Unc.construct({ category: "standard", value: "1.23" }, init);
    expect(built.__value_node.value).toBe("1.23");
    // The declared-data constructor (what decoding uses) never calls an initializer.
    expect(new Unc({ __class: "Plurimath::Math::Function::Uncertainty" }).__class).toBe("Plurimath::Math::Function::Uncertainty");
  });
});

describe("strict compile of the generated consumer with the handwritten bindings", () => {
  it("compiles under the repository's strictest flags", () => {
    const dir = mkdtempSync(join(tmpdir(), "lml-unc-"));
    created.push(dir);
    for (const [path, text] of generateModelsWith(bundle(), { types: {} }, [createKeyValueEmitter("json")])) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    copyFileSync(join(HERE, "bindings/uncertainty-hooks.ts"), join(dir, "uncertainty-hooks.ts"));
    writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
    writeFileSync(join(dir, "consumer.ts"), [
      'import { codecPlurimathMathFunctionUncertainty, withHooks } from "./json/index.js";',
      'import type { CodecHooks, PlurimathMathFunctionUncertaintyHooks } from "./json/index.js";',
      'import { createUncertaintyHooks, newState } from "./uncertainty-hooks.js";',
      'import type { UncertaintyState } from "./uncertainty-hooks.js";',
      "const handwritten: PlurimathMathFunctionUncertaintyHooks<UncertaintyState> = createUncertaintyHooks();",
      'const hooks: CodecHooks<UncertaintyState> = { "Plurimath::Math::Function::Uncertainty@default": handwritten };',
      "export const reserialize = (text: string): string => withHooks(hooks, newState(), () => codecPlurimathMathFunctionUncertainty.stringify(codecPlurimathMathFunctionUncertainty.parse(text)));",
    ].join("\n"));
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ES2022", lib: ["ES2022"], module: "NodeNext", moduleResolution: "NodeNext",
        typeRoots: [join(REPO, "node_modules/@types")], types: ["node"], strict: true,
        noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, verbatimModuleSyntax: true,
        noUnusedLocals: true, noUnusedParameters: true, isolatedModules: true, noEmit: true,
        paths: { "lutaml-model-ts": [join(REPO, "src/index.ts")] },
      },
      include: ["./**/*.ts"],
    }));
    try {
      execFileSync(process.execPath, [join(REPO, "node_modules/typescript/bin/tsc"), "-p", join(dir, "tsconfig.json")], { encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      throw new Error(`tsc failed:\n${(error as { stdout?: string }).stdout ?? ""}`);
    }
  }, 120_000);
});
