import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Bundle } from "../../src/contracts.js";
import { generateInto, infoOf, load } from "./harness.js";

// Acceptance table recorded from canonical Ruby (lutaml-model e4439b37, Nokogiri adapter, scripts/cdata_oracle.rb):
// 55 reads and 20 writes over five models. Every row is replayed against the generated TS codecs; nothing here is a
// self-authored expectation. Row meaning: a string is the value Ruby holds; null is an UNSET value (Ruby drops it);
// an Array is a list held by a single-valued :string attribute, which a typed string cannot represent, so TS refuses
// those documents by name (invalid_document) -- an empty list is "no value" and stays unset.
const REPO = resolve(import.meta.dirname, "../..");
const oracle = JSON.parse(readFileSync(join(REPO, "test/fixtures/ts_generated/cdata_ruby_oracle.json"), "utf8")) as {
  source: string; adapter: string;
  reads: { model: string; case: string; xml: string; read: { ok: boolean; value: unknown } }[];
  writes: { model: string; value: string; write: { ok: boolean; value: string } }[];
};
const str = (name: string): unknown => ({ name, type: { kind: "builtin", name: "string" }, required: false, collection: false, default: { present: false }, initialize_empty: false });
const render = { default: false, empty: "omit", nil: "omit" };
const ns = { mode: "inherit" };
const model = (id: string, root: string, attributes: unknown[], rules: unknown[]): unknown => ({
  lml: 2, model: id, register: "default", attributes, mappings: { xml: { root: { element: root }, rules } },
});
const bundle = { lml_bundle: 1, roots: [], capabilities: ["xml"], value_types: {}, models: {
  "OrdinaryContent@default": model("OrdinaryContent", "r", [str("text")], [{ kind: "content", to: "text", render }]),
  "CdataContent@default": model("CdataContent", "r", [str("text")], [{ kind: "content", to: "text", cdata: true, render }]),
  "OrdinaryElement@default": model("OrdinaryElement", "p", [str("v")], [{ kind: "element", name: ["v"], to: "v", namespace: ns, render }]),
  "CdataElement@default": model("CdataElement", "p", [str("v")], [{ kind: "element", name: ["v"], to: "v", cdata: true, namespace: ns, render }]),
  "ContentWithMappedChild@default": model("ContentWithMappedChild", "r", [str("text"), str("c")], [
    { kind: "content", to: "text", render }, { kind: "element", name: ["c"], to: "c", namespace: ns, render },
  ]),
} } as unknown as Bundle;
const MEMBER: Record<string, string> = { OrdinaryContent: "text", CdataContent: "text", OrdinaryElement: "v", CdataElement: "v", ContentWithMappedChild: "text" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = Record<string, any>;
const rows: { kind: string; model: string; case: string; verdict: "pass" | "mismatch" | "refused-by-name"; detail?: string }[] = [];

describe("CDATA reads and writes replay the canonical Ruby answer set", () => {
  let codecs: Any; let models: Any;
  const setup = async (): Promise<void> => {
    if (codecs !== undefined) return;
    const dir = generateInto(bundle);
    codecs = (await load(dir, "xml/index.ts"))["CODECS"];
    models = await load(dir, "models.ts");
  };

  it("pins the Ruby source and adapter", () => {
    expect(oracle.source).toBe("e4439b373ea0773f0f4713f2bff016ec5156f84b");
    expect(oracle.adapter).toBe("nokogiri");
    expect([oracle.reads.length, oracle.writes.length]).toEqual([55, 20]);
  });

  for (const r of oracle.reads) {
    it(`reads ${r.model} / ${r.case}`, async () => {
      await setup();
      const codec = codecs[`${r.model}@default`];
      const member = MEMBER[r.model] as string;
      const expected = r.read.value;
      if (Array.isArray(expected) && expected.length > 0) {
        const info = await infoOf(() => codec.parse(r.xml));
        rows.push({ kind: "read", model: r.model, case: r.case, verdict: info?.reason === "invalid_document" ? "refused-by-name" : "mismatch", detail: `ruby list ${JSON.stringify(expected)}` });
        expect(info, JSON.stringify(expected)).toMatchObject({ reason: "invalid_document", model_id: `${r.model}@default`, attribute: member });
        return;
      }
      const value = (await codec.parse(r.xml))[member];
      const unset = expected === null || (Array.isArray(expected) && expected.length === 0);
      const ok = unset ? value === null || typeof value === "symbol" : value === expected;
      rows.push({ kind: "read", model: r.model, case: r.case, verdict: ok ? "pass" : "mismatch", detail: JSON.stringify(value) });
      if (unset) expect(value === null || typeof value === "symbol").toBe(true);
      else expect(value).toBe(expected);
    });
  }

  for (const w of oracle.writes) {
    it(`writes ${w.model} / ${JSON.stringify(w.value)}`, async () => {
      await setup();
      const cls = models[w.model];
      const out: string = await codecs[`${w.model}@default`].stringify(new cls({ [MEMBER[w.model] as string]: w.value }));
      const ruby = w.write.value.replace(/\n\s*/g, ""); // Ruby pretty-prints; section structure and escaping are compared exactly
      rows.push({ kind: "write", model: w.model, case: w.value, verdict: out === ruby ? "pass" : "mismatch", detail: out });
      expect(out).toBe(ruby);
    });
  }

  it("summarizes every row", () => {
    const count = (v: string): number => rows.filter((r) => r.verdict === v).length;
    writeFileSync(join(tmpdir(), "lml-cdata-oracle-rows.json"), JSON.stringify({ rows, pass: count("pass"), refused: count("refused-by-name"), mismatch: count("mismatch") }, null, 2));
    expect(count("mismatch")).toBe(0);
  });
});
