import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateArtifacts, generateModels, LmlError } from "../../src/index.js";
import type { Bundle } from "../../src/index.js";
import { bundleChecksum, loadBundle } from "../../src/lml/index.js";
import { generateModelsWith } from "../../src/generator/index.js";
import { attr, bundleOf, codeOf, generated } from "./support.js";

const REPO = resolve(import.meta.dirname, "../..");
const FIXTURE = join(REPO, "test/fixtures/ts_generated/custom_initialize_bundle.json");
const bytes = readFileSync(FIXTURE);
const bundle = (): Bundle => loadBundle(bytes, "json");
const created: string[] = [];
afterAll(() => created.forEach((d) => rmSync(d, { recursive: true, force: true })));

const refuse = (mutate: (doc: Record<string, unknown>) => void): LmlError | undefined => {
  const tree = JSON.parse(bytes.toString("utf8"));
  mutate(tree.models["Example::Money@default"]);
  try {
    loadBundle(Buffer.from(JSON.stringify(tree)), "json");
  } catch (error) {
    return error as LmlError;
  }
  return undefined;
};

describe("custom_initialize marker: reader", () => {
  it("keeps the marker on the marked model only", () => {
    const b = bundle();
    expect(b.models["Example::Money@default"]?.custom_initialize).toBe(true);
    expect("custom_initialize" in (b.models["Example::Plain@default"] as object)).toBe(false);
  });

  it.each([false, null, "true", 1, {}, []])("refuses malformed marker %j as invalid_document", (value) => {
    const error = refuse((doc) => { doc["custom_initialize"] = value; });
    expect(error?.info.reason).toBe("invalid_document");
    expect(error?.info.location).toBe("/models/Example::Money@default/custom_initialize");
  });

  it("round-trips the marker through the bundle checksum, and the marker changes the checksum", () => {
    const sum = bundleChecksum(bundle());
    expect(sum).toBe(bundleChecksum(bundle()));
    const stripped = JSON.parse(bytes.toString("utf8"));
    delete stripped.models["Example::Money@default"].custom_initialize;
    expect(bundleChecksum(loadBundle(Buffer.from(JSON.stringify(stripped)), "json"))).not.toBe(sum);
  });
});

describe("custom_initialize marker: generator", () => {
  it("leaves ordinary models byte-identical to a bundle without the marker anywhere", () => {
    const plain = JSON.parse(bytes.toString("utf8"));
    delete plain.models["Example::Money@default"].custom_initialize;
    const withMarker = generateModels(bundle(), { types: {} });
    const without = generateModels(loadBundle(Buffer.from(JSON.stringify(plain)), "json"), { types: {} });
    const plainClass = (m: ReadonlyMap<string, string>): string =>
      (m.get("models.ts") as string).split("export class ExamplePlain ")[1] as string;
    expect(plainClass(withMarker)).toBe(plainClass(without));
    expect(without.get("models.ts")).not.toContain("customInitialize");
    expect(without.get("runtime.ts")).not.toContain("unimplementedInitializer");
  });

  it("is deterministic and artifacts carry checksummed marker output", () => {
    const input = { bundleBytes: bytes, bundleFormat: "json", bindings: { types: {} } } as const;
    const a = generateArtifacts(input);
    const b = generateArtifacts(input);
    expect(b.manifestSha256).toBe(a.manifestSha256);
    expect(a.files.get("models.ts")).toContain("static readonly customInitialize = true;");
    expect(a.manifest.lml_checksum).toBe(bundleChecksum(bundle()));
  });

  it("refuses a hand-built bundle with a malformed marker", () => {
    const b = bundleOf([attr("a", "string")], {}, { custom_initialize: false });
    expect(codeOf(() => generateModels(b, { types: {} }))).toBe("invalid_document");
  });

  it("refuses an initializer type name that collides with another model", () => {
    const tree = JSON.parse(bytes.toString("utf8"));
    tree.models["Example::MoneyInitializer@default"] = { ...tree.models["Example::Plain@default"], model: "Example::MoneyInitializer" };
    expect(codeOf(() => generateModels(loadBundle(Buffer.from(JSON.stringify(tree)), "json"), { types: {} }))).toBe("duplicate_id");
  });
});

describe("custom_initialize marker: generated code", () => {
  it("compiles strictly, with a consumer initializer typed against the stub contract", () => {
    const dir = mkdtempSync(join(tmpdir(), "lml-ci-"));
    created.push(dir);
    for (const [path, text] of generateModelsWith(bundle(), { types: {} }, [])) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
    writeFileSync(join(dir, "consumer.ts"), [
      'import { ExampleMoney } from "./index.js";',
      'import type { ExampleMoneyInitializer } from "./models.js";',
      "const fromCents: ExampleMoneyInitializer<{ cents: bigint }> = ({ cents }) => ({ amount: cents, currency: \"USD\" });",
      "export const money: ExampleMoney = ExampleMoney.construct({ cents: 5n }, fromCents);",
      "export const stub = ExampleMoney.initializeStub;",
      "// @ts-expect-error a plain model has no construct()",
      "import { ExamplePlain } from \"./index.js\"; void ExamplePlain.construct;",
    ].join("\n"));
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ES2022", lib: ["ES2022"], module: "NodeNext", moduleResolution: "NodeNext",
        typeRoots: [join(REPO, "node_modules/@types")], types: ["node"], strict: true,
        noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, verbatimModuleSyntax: true, noUnusedLocals: true, noUnusedParameters: true,
        isolatedModules: true, noEmit: true, paths: { "lutaml-model-ts": [join(REPO, "src/index.ts")] },
      },
      include: ["./**/*.ts"],
    }));
    try {
      execFileSync(process.execPath, [join(REPO, "node_modules/typescript/bin/tsc"), "-p", join(dir, "tsconfig.json")], { encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      const out = error as { stdout?: string };
      throw new Error(`tsc failed:\n${out.stdout ?? ""}`);
    }
  }, 30_000);

  it("separates data construction from application construction", async () => {
    const { models } = await generated(bundle());
    const Money = models["ExampleMoney"];
    // Declared data path (what decoding uses): unchanged, data-only.
    const data = new Money({ amount: 3n, currency: "EUR" });
    expect([data.amount, data.currency]).toEqual([3n, "EUR"]);
    expect(Money.customInitialize).toBe(true);
    // Application path with no handwritten implementation: the named stub failure.
    let failure: LmlError | undefined;
    try { Money.construct({ cents: 5 }); } catch (error) { failure = error as LmlError; }
    expect(failure?.info.reason).toBe("custom_initialize");
    expect(failure?.info.model_id).toBe("Example::Money@default");
    expect(failure?.constructor.name).toBe("LmlError");
    // Same stub when invoked directly, and it never falls back to a generic substitute.
    expect(() => Money.initializeStub({ amount: 1n, currency: "X" })).toThrow(/custom_initialize/);
  });

  it("builds through an explicit handwritten initializer and still validates its output", async () => {
    const { models } = await generated(bundle());
    const Money = models["ExampleMoney"];
    const built = Money.construct({ cents: 250n }, ({ cents }: { cents: bigint }) => ({ amount: cents, currency: "USD" }));
    expect(built).toBeInstanceOf(Money);
    expect([built.amount, built.currency]).toEqual([250n, "USD"]);
    expect(() => Money.construct({}, () => ({ amount: "nope", currency: "USD" }))).toThrow(/Money|type/);
  });

  it("does not add construct/stub members to ordinary models", async () => {
    const { models } = await generated(bundle());
    expect(models["ExamplePlain"].construct).toBeUndefined();
    expect(models["ExamplePlain"].customInitialize).toBeUndefined();
  });
});
