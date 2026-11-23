/**
 * HANDWRITTEN target-local counterparts of the 25 Plurimath `Uncertainty` key-value hooks (source:
 * plurimath 050a3a9c `Core.node_fields` / `declare_node_field` / `declare_plain_field`). Not compiler
 * output and no source text is evaluated: each function re-implements one source contract.
 *
 * Storage contract: the generated model keeps only declared data (`__class`, the node views). Everything
 * the source keeps in instance variables behind these hooks lives in {@link UncertaintyState}, the explicit
 * application state passed to every hook. A hook never touches another field's slot.
 */

export type Neutral = null | boolean | number | string | readonly Neutral[] | { readonly [key: string]: Neutral };

/** Source `STRING_KEYS`: the list that tells String keys from Symbol keys in a hash. */
const STRING_KEYS = "__string_keys";

export const NODE_FIELDS = ["value", "magnitude", "coverage_factor", "coverage_probability", "lower", "upper", "unit"] as const;
export type NodeField = (typeof NODE_FIELDS)[number];
export const SYMBOL_FIELDS = ["category", "interval_kind", "notation", "distribution"] as const;
export type SymbolField = (typeof SYMBOL_FIELDS)[number];

/** The symbol vocabularies of the source class (CATEGORIES, INTERVAL_KINDS, NOTATIONS, DISTRIBUTIONS). */
const TAGS: Readonly<Record<SymbolField, readonly string[]>> = {
  category: ["standard", "expanded", "coverage_interval"],
  interval_kind: ["shortest", "probabilistically_symmetric"],
  notation: ["absolute", "concise"],
  distribution: ["rect", "triang", "arcsine"],
};

/** Node classes the finite pilot graph can name in a mixed list (source NODE_CLASS_MAP, restricted to the graph). */
const MIXED_CLASSES: readonly string[] = [
  "Plurimath::Math::Core",
  "Plurimath::Math::Number",
  "Plurimath::Math::Function::Unitsml",
  "Plurimath::Math::Function::Uncertainty",
];

/** A hash as the source holds it: each key remembers whether it was a String (else a Symbol). */
export type Keyed = Neutral | readonly Keyed[] | { readonly keyed: readonly { readonly key: string; readonly string: boolean; readonly value: Keyed }[] };
export type MixedItem = { readonly text: string } | { readonly class: string; readonly node: { readonly [key: string]: Neutral } };

export interface UncertaintyState {
  readonly symbols: Partial<Record<SymbolField, string>>;
  readonly text: Partial<Record<NodeField, string>>;
  readonly value: Partial<Record<NodeField, Keyed>>;
  readonly mixed: Partial<Record<NodeField, readonly MixedItem[]>>;
}

export function newState(): UncertaintyState {
  return { symbols: {}, text: {}, value: {}, mixed: {} };
}

/** A hook refused a shape the source contract does not define. */
export class HookRefusal extends Error {
  readonly info: { readonly reason: "invalid_document"; readonly location: string; readonly detail: string };
  constructor(hook: string, detail: string) {
    super(`${hook}: ${detail}`);
    this.name = "HookRefusal";
    this.info = { reason: "invalid_document", location: "", detail: `${hook}: ${detail}` };
  }
}

const isObject = (v: unknown): v is { readonly [key: string]: Neutral } => typeof v === "object" && v !== null && !Array.isArray(v);

// -- Core.load_keys / Core.dump_keys -----------------------------------------------------------

function loadKeys(hook: string, value: Neutral): Keyed {
  if (Array.isArray(value)) return value.map((item) => loadKeys(hook, item as Neutral));
  if (!isObject(value)) return value;
  const listed = value[STRING_KEYS];
  if (listed !== undefined && !(Array.isArray(listed) && listed.every((k) => typeof k === "string"))) {
    throw new HookRefusal(hook, `${STRING_KEYS} must be a list of strings`);
  }
  const strings = new Set((listed ?? []) as readonly string[]);
  const keyed: { key: string; string: boolean; value: Keyed }[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (key === STRING_KEYS) continue;
    keyed.push({ key, string: strings.has(key), value: loadKeys(hook, item) });
  }
  return { keyed };
}

function dumpKeys(value: Keyed): Neutral {
  if (Array.isArray(value)) return value.map((item) => dumpKeys(item as Keyed));
  if (isObject(value) && "keyed" in value && Array.isArray((value as { keyed: unknown }).keyed)) {
    const entries = (value as { keyed: readonly { key: string; string: boolean; value: Keyed }[] }).keyed;
    const dumped: Record<string, Neutral> = {};
    for (const entry of entries) dumped[entry.key] = dumpKeys(entry.value);
    const strings = entries.filter((e) => e.string).map((e) => e.key);
    if (strings.length > 0) dumped[STRING_KEYS] = strings;
    return dumped;
  }
  return value as Neutral;
}

// -- Symbol fields: category, interval_kind, notation, distribution -----------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Hook = (model: unknown, subject: any, state: UncertaintyState) => void;

function symbolHooks(field: SymbolField): { readonly from: Hook; readonly to: Hook } {
  const name = `${field}_from_kv`;
  return {
    // Source: a stored Symbol is written as its name. Strings ({"string": s}) are a source encoding for
    // free-form values; these four fields are closed vocabularies, so only the symbol form is defined.
    to: (_model: unknown, document: Record<string, unknown>, state: UncertaintyState) => {
      const tag = state.symbols[field];
      if (tag !== undefined) document[field] = tag;
    },
    from: (_model: unknown, value: unknown, state: UncertaintyState) => {
      if (value === null) {
        delete state.symbols[field];
        return;
      }
      if (typeof value !== "string") throw new HookRefusal(name, `expected a symbol name, got ${JSON.stringify(value)}`);
      if (!TAGS[field].includes(value)) throw new HookRefusal(name, `unknown ${field} tag ${JSON.stringify(value)}`);
      state.symbols[field] = value;
    },
  };
}

// -- Node fields: <field>_text, <field>_value, <field>_mixed ------------------------------------

function nodeHooks(field: NodeField): Record<string, Hook> {
  const text = `${field}_text`;
  const valueKey = `${field}_value`;
  const mixedKey = `${field}_mixed`;
  return {
    [`${text}_to_kv`]: (_m: unknown, document: Record<string, unknown>, state: UncertaintyState) => {
      const held = state.text[field];
      if (held !== undefined) document[text] = held;
    },
    [`${text}_from_kv`]: (_m: unknown, value: unknown, state: UncertaintyState) => {
      if (typeof value !== "string") throw new HookRefusal(`${text}_from_kv`, `expected a string, got ${JSON.stringify(value)}`);
      state.text[field] = value;
    },
    // Source: an attribute Hash or an empty array.
    [`${valueKey}_to_kv`]: (_m: unknown, document: Record<string, unknown>, state: UncertaintyState) => {
      const held = state.value[field];
      if (held !== undefined) document[valueKey] = dumpKeys(held);
    },
    [`${valueKey}_from_kv`]: (_m: unknown, value: unknown, state: UncertaintyState) => {
      const empty = Array.isArray(value) && value.length === 0;
      if (!isObject(value) && !empty) {
        throw new HookRefusal(`${valueKey}_from_kv`, `expected an object or an empty list, got ${JSON.stringify(value)}`);
      }
      state.value[field] = loadKeys(`${valueKey}_from_kv`, value as Neutral);
    },
    // Source: a list mixing Strings and nodes: {"text": s} | {"class": name, "node": hash}.
    [`${mixedKey}_to_kv`]: (_m: unknown, document: Record<string, unknown>, state: UncertaintyState) => {
      const held = state.mixed[field];
      if (held !== undefined && held.some((item) => "text" in item)) {
        document[mixedKey] = held.map((item) => ("text" in item ? { text: item.text } : { class: item.class, node: item.node }));
      }
    },
    [`${mixedKey}_from_kv`]: (_m: unknown, value: unknown, state: UncertaintyState) => {
      const hook = `${mixedKey}_from_kv`;
      if (!Array.isArray(value)) throw new HookRefusal(hook, `expected a list, got ${JSON.stringify(value)}`);
      state.mixed[field] = value.map((item: unknown): MixedItem => {
        if (!isObject(item)) throw new HookRefusal(hook, "list items must be objects");
        if (!("node" in item)) {
          if (typeof item["text"] !== "string") throw new HookRefusal(hook, "a text item needs a string `text`");
          return { text: item["text"] };
        }
        const name = item["class"];
        if (typeof name !== "string" || !MIXED_CLASSES.includes(name)) {
          throw new HookRefusal(hook, `unknown node class ${JSON.stringify(name)}`);
        }
        if (!isObject(item["node"])) throw new HookRefusal(hook, "`node` must be an object");
        return { class: name, node: item["node"] };
      });
    },
  };
}

/** The 25 handwritten hooks for the Uncertainty model; the application state arrives as each hook's third argument. */
export function createUncertaintyHooks(): Record<string, Hook> {
  const hooks: Record<string, Hook> = {};
  for (const field of SYMBOL_FIELDS) {
    const pair = symbolHooks(field);
    hooks[`${field}_from_kv`] = pair.from;
    hooks[`${field}_to_kv`] = pair.to;
  }
  for (const field of NODE_FIELDS) Object.assign(hooks, nodeHooks(field));
  return hooks;
}
