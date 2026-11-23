import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateModelsWith } from "../../src/generator/index.js";
import { createKeyValueEmitter } from "../../src/codecs/index.js";
import { bundleChecksum, loadBundle } from "../../src/lml/index.js";
import type { Bundle } from "../../src/index.js";
import { generated } from "../generator/support.js";

const REPO = resolve(import.meta.dirname, "../..");
const FIXTURE = join(REPO, "test/fixtures/ts_generated/serialization_hooks_bundle.json");
const bytes = readFileSync(FIXTURE);
const bundle = (): Bundle => loadBundle(bytes, "json");
const MEASURE = "Example::Measure@default";
const created: string[] = [];
afterAll(() => created.forEach((d) => rmSync(d, { recursive: true, force: true })));

const mutated = (edit: (rules: Record<string, unknown>[]) => void): { reason?: string; location?: string | undefined } => {
  const tree = JSON.parse(bytes.toString("utf8"));
  edit(tree.models[MEASURE].mappings.json.rules);
  try {
    loadBundle(Buffer.from(JSON.stringify(tree)), "json");
  } catch (error) {
    const info = (error as { info: { reason: string; location?: string } }).info;
    return { reason: info.reason, location: info.location };
  }
  return {};
};
const AT = `/models/${MEASURE}/mappings/json/rules`;

describe("custom serialization hooks: validator", () => {
  it("accepts the shared fixture and the checksum covers the custom metadata", () => {
    const sum = bundleChecksum(bundle());
    const tree = JSON.parse(bytes.toString("utf8"));
    delete tree.models[MEASURE].mappings.json.rules[1].custom.to;
    expect(bundleChecksum(loadBundle(Buffer.from(JSON.stringify(tree)), "json"))).not.toBe(sum);
    expect(mutated(() => {})).toEqual({});
  });

  const cases: [string, (rules: Record<string, unknown>[]) => void, string, string][] = [
    ["not an object", (r) => { r[1]!["custom"] = "x"; }, "invalid_document", `${AT}/1/custom`],
    ["empty object", (r) => { r[1]!["custom"] = {}; }, "invalid_document", `${AT}/1/custom`],
    ["array", (r) => { r[1]!["custom"] = []; }, "invalid_document", `${AT}/1/custom`],
    ["unknown key", (r) => { r[1]!["custom"] = { to: "a", other: "b" }; }, "invalid_document", `${AT}/1/custom/other`],
    ["bad name", (r) => { r[1]!["custom"] = { to: "1bad" }; }, "invalid_document", `${AT}/1/custom/to`],
    ["name with dash", (r) => { r[1]!["custom"] = { from: "a-b" }; }, "invalid_document", `${AT}/1/custom/from`],
    ["non-string name", (r) => { r[1]!["custom"] = { to: 5 }; }, "invalid_document", `${AT}/1/custom/to`],
    ["empty name", (r) => { r[1]!["custom"] = { to: "" }; }, "invalid_document", `${AT}/1/custom/to`],
    ["to equals from", (r) => { r[1]!["custom"] = { to: "same", from: "same" }; }, "invalid_document", `${AT}/1/custom`],
    ["one name in two directions", (r) => { r[2]!["custom"] = { to: "category_from_kv" }; }, "invalid_document", `${AT}/2/custom/to`],
    ["executable with key unchanged", (r) => { r[1]!["with"] = { to: "x" }; }, "unsupported_mapping", `${AT}/1/with`],
  ];
  it.each(cases)("refuses %s", (_name, edit, reason, location) => {
    expect(mutated(edit)).toEqual({ reason, location });
  });

  it("refuses custom on an xml rule as unsupported_mapping", () => {
    const tree = JSON.parse(bytes.toString("utf8"));
    tree.models[MEASURE].mappings.xml = { root: { element: "m" }, rules: [{ kind: "element", name: ["m"], to: "amount", custom: { to: "h" } }] };
    tree.capabilities = ["json", "xml"];
    let info: { reason: string; location: string } | undefined;
    try { loadBundle(Buffer.from(JSON.stringify(tree)), "json"); } catch (error) { info = (error as { info: { reason: string; location: string } }).info; }
    expect(info).toMatchObject({ reason: "unsupported_mapping", location: `/models/${MEASURE}/mappings/xml/rules/0/custom` });
  });
});

describe("custom serialization hooks: generated code", () => {
  it("emits no hook code for unhooked mappings and keeps unhooked models' codec text", () => {
    const files = generateModelsWith(bundle(), { types: {} }, [createKeyValueEmitter("json")]);
    const plain = JSON.parse(bytes.toString("utf8"));
    plain.models[MEASURE].mappings.json.rules = [plain.models[MEASURE].mappings.json.rules[0]];
    const without = generateModelsWith(loadBundle(Buffer.from(JSON.stringify(plain)), "json"), { types: {} }, [createKeyValueEmitter("json")]);
    expect(without.get("json/codecs.ts")).not.toMatch(/Hooks|hook/);
    expect(without.get("json/runtime.ts")).not.toMatch(/withHooks|readHook|writeHook/);
    expect(files.get("json/runtime.ts")).toContain("export function withHooks");
    const text = without.get("json/codecs.ts") as string;
    expect(text).toContain('  return w.build(m.ExampleMeasure, init, {"amount":"amount"}, m.ExampleMeasure.modelId);');
    expect(text).not.toContain("const model");
  });

  it("compiles strictly with a typed consumer implementing the hooks", () => {
    const dir = mkdtempSync(join(tmpdir(), "lml-hooks-"));
    created.push(dir);
    for (const [path, text] of generateModelsWith(bundle(), { types: {} }, [createKeyValueEmitter("json")])) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
    writeFileSync(join(dir, "consumer.ts"), [
      'import { withHooks, codecExampleMeasure } from "./json/index.js";',
      'import type { CodecHooks, ExampleMeasureHooks } from "./json/index.js";',
      "interface State { category?: string; note?: string }",
      "const measure: ExampleMeasureHooks<State> = {",
      "  category_from_kv: (_model, value, state) => { state.category = String(value); },",
      "  category_to_kv: (_model, document, state) => { if (state.category !== undefined) document[\"category\"] = state.category; },",
      "  note_to_kv: (_model, document, state) => { document[\"note\"] = state.note ?? \"\"; },",
      "};",
      'const hooks: CodecHooks<State> = { "Example::Measure@default": measure };',
      "export const run = (text: string): string => withHooks(hooks, {} as State, () => codecExampleMeasure.stringify(codecExampleMeasure.parse(text)));",
      "// @ts-expect-error a hook has the declared (model, document, state) shape",
      "export const bad: ExampleMeasureHooks<State> = { note_to_kv: (_m: unknown, _d: number) => undefined };",
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setup = async (): Promise<{ json: Record<string, any>; reason: (run: () => unknown) => { reason?: string; location?: string | undefined; model?: string | undefined } }> => {
    const out = await generated(bundle(), { json: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = out.json as Record<string, any>;
    const reason = (run: () => unknown): { reason?: string; location?: string | undefined; model?: string | undefined } => {
      try { run(); } catch (error) {
        const info = (error as { info?: { reason: string; location?: string; model_id?: string } }).info;
        if (info === undefined) throw error;
        return { reason: info.reason, location: info.location, model: info.model_id };
      }
      return {};
    };
    return { json, reason };
  };

  it("ordinary declared data never runs a hook, and the data constructor is unchanged", async () => {
    const { json, reason } = await setup();
    const model = json["codecExampleMeasure"].decode({ amount: "5" });
    expect(model.amount).toBe(5n);
    expect(reason(() => json["codecExampleMeasure"].encode(model)).reason).toBe("custom_serialization");
    expect(json["decodeExampleMeasure"]({ amount: "5" }).amount).toBe(5n);
  });

  it("fails custom_serialization by name only for the direction attempted", async () => {
    const { json, reason } = await setup();
    const model = json["codecExampleMeasure"].decode({ amount: "5" });
    expect(reason(() => json["codecExampleMeasure"].decode({ amount: "5", category: "x" })))
      .toEqual({ reason: "custom_serialization", location: "/category", model: MEASURE });
    expect(reason(() => json["codecExampleMeasure"].encode(model))).toEqual({ reason: "custom_serialization", location: "/category", model: MEASURE });
    const calls: string[] = [];
    const readOnly = { [MEASURE]: { category_from_kv: () => { calls.push("read"); } } };
    expect(reason(() => json["withHooks"](readOnly, {}, () => json["codecExampleMeasure"].encode(model))).reason).toBe("custom_serialization");
    expect(calls).toEqual([]);
    const writeOnly = {
      [MEASURE]: {
        category_to_kv: () => { calls.push("write-category"); },
        note_to_kv: () => { calls.push("write-note"); },
      },
    };
    json["withHooks"](writeOnly, {}, () => json["codecExampleMeasure"].encode(model));
    expect(calls).toEqual(["write-category", "write-note"]);
    calls.length = 0;
    json["withHooks"](writeOnly, {}, () => json["codecExampleMeasure"].decode({ amount: "5" }));
    expect(calls).toEqual([]);
    expect(reason(() => json["withHooks"](writeOnly, {}, () => json["codecExampleMeasure"].decode({ note: "n" }))))
      .toEqual({ reason: "custom_serialization", location: "/note", model: MEASURE });
  });

  it("explicit handwritten hooks read and write real values that survive parse and write", async () => {
    const { json } = await setup();
    const state: { category?: string; note?: string } = { note: "kept" };
    const hooks = {
      [MEASURE]: {
        category_from_kv: (_model: unknown, value: unknown, s: typeof state) => { s.category = String(value); },
        category_to_kv: (_model: unknown, document: Record<string, unknown>, s: typeof state) => { document["category"] = s.category; },
        note_to_kv: (_model: unknown, document: Record<string, unknown>, s: typeof state) => { document["note"] = s.note; },
      },
    };
    const text = '{"amount":"7","category":"metric"}';
    const out = json["withHooks"](hooks, state, () => json["codecExampleMeasure"].stringify(json["codecExampleMeasure"].parse(text)));
    expect(state.category).toBe("metric");
    expect(JSON.parse(out)).toEqual({ amount: "7", category: "metric", note: "kept" });
    expect(() => json["codecExampleMeasure"].encode(json["codecExampleMeasure"].decode({ amount: "5" }))).toThrow(/custom_serialization/);
  });
});
