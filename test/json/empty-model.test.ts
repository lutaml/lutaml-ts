import { describe, expect, it } from "vitest";
import type { Bundle } from "../../src/contracts.js";
import { generateInto, load, tscCheck } from "../xml/harness.js";

// An empty model object under the default render policy (empty: omit). Root's measurements:
//  - a nested model with NOTHING set is an empty hash and is omitted (Ruby: Parent.new(child: Plain.new) => {});
//  - a nested model with a member set explicitly, whose values all render empty, stays {}
//    (umath-ts frozen row unicode-external-167: "mitBbb":{} from MitBbb{present: ""});
//  - a nested model emptied only by suppressed applied defaults is omitted (default-provenance.test.ts).
const OUTER = "Outer@default";
const INNER = "Inner@default";
const render = { default: false, empty: "omit", nil: "omit" };
const str = { kind: "builtin", name: "string" };
const attr = (name: string, type: unknown, def?: unknown): unknown => ({
  name, type, required: false, collection: false,
  default: def === undefined ? { present: false } : { present: true, value: def }, initialize_empty: false,
});
const bundle = { lml_bundle: 1, roots: [OUTER], capabilities: ["json"], value_types: {}, models: {
  [INNER]: { lml: 2, model: "Inner", register: "default", attributes: [attr("present", str), attr("tag", str, "d")],
    mappings: { json: { rules: [{ key: ["present"], to: "present", render }, { key: ["tag"], to: "tag", render }] } } },
  [OUTER]: { lml: 2, model: "Outer", register: "default", attributes: [attr("inner", { kind: "model", id: INNER })],
    mappings: { json: { rules: [{ key: ["inner"], to: "inner", render }] } } },
} } as unknown as Bundle;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = Record<string, any>;
describe("an empty model object keeps {} under the default empty policy", () => {
  let models: Any; let json: Any;
  const setup = async (): Promise<void> => {
    if (models !== undefined) return;
    const dir = generateInto(bundle, { json: true });
    tscCheck(dir);
    models = await load(dir, "models.ts");
    json = (await load(dir, "json/index.ts"))["CODECS"];
  };
  const encode = (inner: Any): unknown => json[OUTER].encode(new models["Outer"]({ inner }));

  it("keeps {} for a model whose explicitly set member renders empty", async () => {
    await setup();
    expect(encode(new models["Inner"]({ present: "", tag: "" }))).toEqual({ inner: {} });
  });

  it("keeps {} when an explicitly empty member is decoded and written again", async () => {
    await setup();
    expect(json[OUTER].encode(json[OUTER].decode({ inner: { present: "" } }))).toEqual({ inner: {} });
  });

  it("still omits a model with nothing set, or one emptied only by applied defaults", async () => {
    await setup();
    expect(encode(new models["Inner"]({ present: undefined }))).toEqual({});
    expect(encode(new models["Inner"]())).toEqual({});
  });

  it("writes a non-empty model normally", async () => {
    await setup();
    expect(encode(new models["Inner"]({ present: "x" }))).toEqual({ inner: { present: "x" } });
  });
});
