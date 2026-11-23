import { describe, expect, it } from "vitest";
import type { Bundle } from "../../src/index.js";
import { generated } from "../generator/support.js";

// Concern: a declared REQUIRED attribute whose custom.from handler supplies its value. Reproduced old-red: the read
// hook ran after construction, so the constructor refused the missing value first ("/n is required") and the hook
// never ran. The hook now returns the declared value before construction and the constructor validates it.
const ID = "Req@default";
const bundle = (extra: Record<string, unknown> = {}): Bundle => ({
  lml_bundle: 1, roots: [ID], capabilities: ["json"], value_types: {},
  models: {
    [ID]: {
      lml: 2, model: "Req", register: "default",
      attributes: [
        { name: "n", type: { kind: "builtin", name: "integer" }, required: true, collection: false, default: { present: false }, initialize_empty: false },
        { name: "tag", type: { kind: "builtin", name: "string" }, required: false, collection: false, default: { present: false }, initialize_empty: false },
      ],
      mappings: { json: { rules: [
        { key: ["n"], to: "n", custom: { from: "n_from_json" }, render: { default: false, empty: "omit", nil: "omit" } },
        { key: ["tag"], to: "tag", render: { default: false, empty: "omit", nil: "omit" } },
        ...(extra["rules"] as unknown[] ?? []),
      ] } },
    },
  },
}) as unknown as Bundle;

const reason = (run: () => unknown): { reason?: string; location?: string | undefined } => {
  try { run(); } catch (error) {
    const info = (error as { info?: { reason: string; location?: string } }).info;
    if (info === undefined) throw error;
    return { reason: info.reason, location: info.location };
  }
  return {};
};

describe("custom.from on a required declared attribute (KV)", () => {
  it("the explicit read hook supplies the value and the constructor validates it", async () => {
    const { json } = await generated(bundle(), { json: true });
    const state: { seen: unknown[] } = { seen: [] };
    const hooks = { [ID]: { n_from_json: (value: unknown, s: typeof state) => { s.seen.push(value); return BigInt(String(value)) * 2n; } } };
    const model = json?.["withHooks"](hooks, state, () => json?.["codecReq"].decode({ n: "21", tag: "t" }));
    expect(model.n).toBe(42n);
    expect(model.tag).toBe("t");
    expect(state.seen).toEqual(["21"]);
  });

  it("declared validation still applies to the supplied value, and an unsupplied required value is refused", async () => {
    const { json } = await generated(bundle(), { json: true });
    const wrongType = { [ID]: { n_from_json: () => "not an integer" } };
    expect(reason(() => json?.["withHooks"](wrongType, {}, () => json?.["codecReq"].decode({ n: "1" })))).toMatchObject({ reason: "invalid_document", location: "/n" });
    const unset = { [ID]: { n_from_json: () => undefined } };
    expect(reason(() => json?.["withHooks"](unset, {}, () => json?.["codecReq"].decode({ n: "1" })))).toMatchObject({ reason: "invalid_document", location: "/n" });
    // the key absent: the hook is not reached and the required value is missing
    expect(reason(() => json?.["withHooks"]({ [ID]: { n_from_json: () => 1n } }, {}, () => json?.["codecReq"].decode({ tag: "t" })))).toMatchObject({ reason: "invalid_document", location: "/n" });
  });

  it("without the hook installed the reached key fails by name and the ordinary rule still decodes", async () => {
    const { json } = await generated(bundle(), { json: true });
    expect(reason(() => json?.["codecReq"].decode({ n: "1" }))).toMatchObject({ reason: "custom_serialization", location: "/n" });
    // write is independent of the read hook: the declared value is written ordinarily
    const model = json?.["withHooks"]({ [ID]: { n_from_json: () => 7n } }, {}, () => json?.["codecReq"].decode({ n: "x" }));
    expect(json?.["codecReq"].encode(model)).toEqual({ n: "7" });
  });

  it("the ambient scope is synchronous: a Promise-returning operation is refused by name", async () => {
    const { json } = await generated(bundle(), { json: true });
    const hooks = { [ID]: { n_from_json: () => 1n } };
    expect(() => json?.["withHooks"](hooks, {}, async () => json?.["codecReq"].decode({ n: "1" }))).toThrow(/synchronous.*custom_serialization/);
  });
});
