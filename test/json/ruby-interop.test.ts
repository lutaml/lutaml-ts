import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createKeyValueEmitter } from "../../src/codecs/index.js";
import { generateModelsWith } from "../../src/generator/index.js";

const REPO = resolve(import.meta.dirname, "../..");
// Golden owned by lutaml-model (spec/fixtures/lml_conformance/ruby_portable_interop.json),
// copied byte-identical: an Lml bundle plus Lml.portable_json text of three records.
const FIXTURE = join(REPO, "test/lml/fixtures/ruby_portable_interop.json");

describe("ruby portable writer", () => {
  it("reads Ruby portable output and re-writes it byte-identically", async () => {
    const { bundle, outputs } = JSON.parse(readFileSync(FIXTURE, "utf8")) as { bundle: any; outputs: string[] };
    const bindings = { types: {
      "builtin:decimal": { module: "./exact-stub.js", export: "Decimal" },
      "builtin:rational": { module: "./exact-stub.js", export: "Rational" } } };
    const dir = mkdtempSync(join(tmpdir(), "lml-interop-"));
    const contractsModule = "./contracts-shim.js";
    const files = generateModelsWith(bundle, bindings, [createKeyValueEmitter("json", { contractsModule })], { contractsModule });
    for (const [path, text] of files) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); }
    copyFileSync(join(REPO, "src/contracts.ts"), join(dir, "contracts-shim.ts"));
    writeFileSync(join(dir, "exact-stub.ts"), `export * from ${JSON.stringify(join(REPO, "src/codecs/exact.js"))};\n`);
    writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
    const mod = (await import(pathToFileURL(join(dir, "index.ts")).href)) as Record<string, any>;
    const codec = mod["json"].CODECS["Interop::Rec@default"];
    expect(outputs.length).toBe(3);
    for (const text of outputs) {
      const value = codec.parse(text);
      expect(codec.stringify(value)).toBe(text);
    }
    expect(() => codec.parse('{"count":5}')).toThrow();
    const first = codec.parse(outputs[0]);
    expect(first.count).toBe(9007199254740993n);
    expect(first.counts).toEqual([-7n, 0n, 2n ** 70n]);
    expect(first.price.lexical).toBe("1.5");
  });
});
