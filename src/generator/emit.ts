import type { AttributeSpec, ModelDocument, ModelId, ModelChoiceGroup } from "../contracts.js";
import { access, declName, fail } from "./names.js";
import { planAttribute } from "./plan.js";
import type { ElementPlan, PlanContext } from "./plan.js";

const ORDERED_MEMBER = "__lml_content";

interface Member {
  readonly name: string;
  readonly prop: string;
  readonly initType: string;
  readonly fieldType: string;
  readonly omittable: boolean;
  readonly filler: string | null;
  readonly specLine: string | null;
  /** Collection or hash member: stored as a frozen copy. */
  readonly snapshot: boolean;
}

function arrayOf(ts: string): string {
  return ts.includes(" | ") ? `readonly (${ts})[]` : `readonly ${ts}[]`;
}

function checkCollection(attr: AttributeSpec, modelId: string, location: string): void {
  const spec = attr.collection;
  if (spec === false) return;
  const ok =
    Number.isInteger(spec.min) && spec.min >= 0 &&
    (spec.max === null || (Number.isInteger(spec.max) && spec.max >= spec.min));
  if (!ok) {
    fail({ reason: "invalid_document", model_id: modelId, attribute: attr.name, location: location + "/collection", detail: "invalid collection bounds" });
  }
  if (spec.class !== undefined) {
    fail({
      reason: "unsupported_type",
      model_id: modelId,
      attribute: attr.name,
      location: location + "/collection/class",
      detail: `collection class ${spec.class} has no TypeScript binding contract`,
    });
  }
}

function defaultExpr(attr: AttributeSpec, plan: ElementPlan, modelId: string, location: string): string | null {
  if (!attr.default.present) return null;
  const value = attr.default.value;
  const reject = (detail: string): never =>
    fail({ reason: "non_serializable_default", model_id: modelId, attribute: attr.name, location: location + "/default", detail });
  if (value === null) {
    return attr.required ? reject("null default on a required attribute") : "null";
  }
  if (plan.literal === null) return reject("defaults of model types are not portable");
  if (attr.collection === false) return plan.literal(value, reject);
  if (!Array.isArray(value)) return reject("collection default must be an array");
  return `[${value.map((item) => (plan.literal as NonNullable<ElementPlan["literal"]>)(item, reject)).join(", ")}]`;
}

/** Fills members a sparse document may omit with their contract meaning. */
function normalized(attr: AttributeSpec): AttributeSpec {
  const sparse = attr as Partial<AttributeSpec> & Pick<AttributeSpec, "name" | "type">;
  return {
    ...attr,
    required: sparse.required ?? false,
    collection: sparse.collection ?? false,
    default: sparse.default ?? { present: false },
    initialize_empty: sparse.initialize_empty ?? false,
  };
}

function buildMember(ctx: PlanContext, source: AttributeSpec, modelId: string, location: string, choice = false): Member {
  const attr = normalized(source);
  // Any Object.prototype member (toString, valueOf, constructor, __proto__ ...) is refused.
  if (attr.name in Object.prototype) {
    fail({ reason: "reserved_member", model_id: modelId, attribute: attr.name, location: location + "/name" });
  }
  checkCollection(attr, modelId, location);
  if (attr.initialize_empty && attr.collection === false) {
    fail({ reason: "invalid_document", model_id: modelId, attribute: attr.name, location: location + "/initialize_empty", detail: "initialize_empty needs a collection" });
  }
  const plan = planAttribute(ctx, attr, modelId);
  const def = defaultExpr(attr, plan, modelId, location);
  const base = attr.collection === false ? plan.ts : arrayOf(plan.ts);
  const filler = def ?? (attr.initialize_empty ? "[]" : null);
  const omittable = !attr.required || filler !== null;
  const nullable = !attr.required;
  const fieldType = !nullable ? base : filler !== null ? `${base} | null` : `rt.Maybe<${base}>`;
  const initType = `${base}${nullable ? " | null" : ""}${omittable ? " | rt.Absent" : ""}`;
  const collection = attr.collection === false
    ? "null"
    : `{ min: ${attr.collection.min}, max: ${attr.collection.max === null ? "null" : attr.collection.max} }`;
  const specLine =
    `rt.attr(out, o, { name: ${JSON.stringify(attr.name)}, required: ${attr.required}, ` +
    `filled: ${filler !== null}, collection: ${collection}, item: ${plan.check}${choice ? ", choice: true" : ""} });`;
  const snapshot = attr.collection !== false || plan.check === "rt.neutralObject";
  return { name: attr.name, prop: declName(attr.name), initType, fieldType, omittable, filler, specLine, snapshot };
}

/**
 * Reads own properties only (the predicate validate's present() uses), so an
 * inherited or prototype-polluted value is never assigned unvalidated.
 * Collections and hashes are snapshotted: copied and frozen.
 */
function constructorAssign(m: Member, className: string): string {
  const key = JSON.stringify(m.name);
  const read = `const v = Object.hasOwn(init, ${key}) ? init${access(m.name)} : undefined;`;
  const dst = `this${access(m.name)}`;
  const wrap = (expr: string): string => (m.snapshot ? `rt.snapshot(${expr})` : expr);
  let value: string;
  if (!m.omittable) value = `v as ${className}Init[${key}]`;
  else if (m.filler === null) value = "v === undefined ? rt.ABSENT : v";
  else value = `v === undefined || v === rt.ABSENT ? ${m.filler} : v`;
  return `{ ${read} ${dst} = ${wrap(value)}; }`;
}

interface CompiledChoice {
  min: number;
  max: number | null;
  allowEmpty: boolean;
  optionalEmpty: boolean;
  members: ({ attribute: string; collectionMax: number | null; renderEmpty: boolean } | { choice: CompiledChoice })[];
}
export function compileChoices(doc: ModelDocument, modelId: string): { groups: CompiledChoice[]; names: Set<string> } {
  const names = new Set<string>();
  const compile = (group: ModelChoiceGroup): CompiledChoice => {
    const members = group.members.map((member) => {
      if ("choice" in member) return {choice: compile(member.choice)};
      names.add(member.attribute);
      const attribute = doc.attributes.find((attr) => attr.name === member.attribute);
      if (!attribute) fail({reason: "dangling_reference", model_id: modelId, attribute: member.attribute});
      if (attribute.collection !== false && attribute.collection.max === 0) fail({reason: "unsupported_type", model_id: modelId, attribute: member.attribute, detail: "zero-sized choice collection batch validation is not supported"});
      const rule = group.format === "xml" ? doc.mappings.xml?.rules.find((rule) => rule.kind === "element" && "to" in rule && rule.to === member.attribute) : undefined;
      const renderEmpty = rule !== undefined && "render" in rule && rule.render?.empty !== undefined && rule.render.empty !== "omit";
      return {attribute: member.attribute, collectionMax: attribute.collection === false ? null : attribute.collection.max, renderEmpty};
    });
    const optionalEmpty = members.some((member) => "choice" in member ? member.choice.optionalEmpty : doc.attributes.some((attr) => attr.name === member.attribute && attr.collection !== false && attr.collection.min === 0));
    const allowEmpty = group.format === "xml" && doc.mappings.xml !== undefined && members.every((member) => "choice" in member || member.renderEmpty);
    return {min: group.min, max: group.max, allowEmpty, optionalEmpty, members};
  };
  return {groups: doc.choices?.groups.map(compile) ?? [], names};
}

export function emitClass(ctx: PlanContext, className: string, modelId: ModelId, doc: ModelDocument, withChoices = false): string {
  const members: Member[] = [];
  const choicePlan = compileChoices(doc, modelId);
  const seen = new Set<string>();
  doc.attributes.forEach((attr, index) => {
    const location = `/models/${modelId}/attributes/${index}`;
    if (attr.name === ORDERED_MEMBER) {
      fail({ reason: "reserved_member", model_id: modelId, attribute: attr.name, location });
    }
    if (seen.has(attr.name)) {
      fail({ reason: "duplicate_id", model_id: modelId, attribute: attr.name, location });
    }
    seen.add(attr.name);
    members.push(buildMember(ctx, attr, modelId, location, choicePlan.names.has(attr.name)));
  });
  const ordered = doc.ordered_content !== undefined;
  const mandatory = members.some((m) => !m.omittable);
  const filledAny = members.some((m) => m.filler !== null);
  const names = members.map((m) => m.name);
  if (ordered) names.push(ORDERED_MEMBER);

  const lines: string[] = [];
  lines.push(`export interface ${className}Init {`);
  for (const m of members) lines.push(`  readonly ${m.prop}${m.omittable ? "?" : ""}: ${m.initType};`);
  if (ordered) lines.push(`  readonly ${ORDERED_MEMBER}?: rt.Maybe<readonly rt.OrderedContentToken[]>;`);
  lines.push("}", "");
  lines.push(`export class ${className} {`);
  lines.push(`  static readonly modelId = ${JSON.stringify(modelId)};`);
  lines.push(`  static readonly memberNames: readonly string[] = ${JSON.stringify(names)};`);
  lines.push("");
  for (const m of members) lines.push(`  readonly ${m.prop}: ${m.fieldType};`);
  if (ordered) lines.push(`  readonly ${ORDERED_MEMBER}: rt.Maybe<readonly rt.OrderedContentToken[]>;`);
  lines.push("");
  lines.push(`  constructor(init: ${className}Init${mandatory ? "" : " = {}"}) {`);
  lines.push(`    const problems = ${className}.${withChoices ? "validateShape" : "validate"}(init);`);
  lines.push(`    if (problems.length > 0) throw new rt.ValidationError(${className}.modelId, problems);`);
  for (const m of members) lines.push(`    ${constructorAssign(m, className)}`);
  if (ordered) {
    lines.push(
      `    { const v = Object.hasOwn(init, ${JSON.stringify(ORDERED_MEMBER)}) ? init.${ORDERED_MEMBER} : undefined; ` +
        `this.${ORDERED_MEMBER} = rt.snapshot(v === undefined ? rt.ABSENT : v); }`,
    );
  }
  if (filledAny) {
    lines.push(`    const effective = ${className}.${withChoices ? "validateShape" : "validate"}(this);`);
    lines.push(`    if (effective.length > 0) throw new rt.ValidationError(${className}.modelId, effective);`);
  }
  lines.push("    Object.freeze(this);", "  }", "");
  lines.push("  /** Reports every violation of an init-like value without throwing. */");
  lines.push(`  static ${withChoices ? "validateShape" : "validate"}(input: unknown): readonly rt.Violation[] {`);
  lines.push("    const out: rt.Violation[] = [];");
  lines.push("    const o = rt.record(input, out);");
  lines.push("    if (o === null) return out;");
  lines.push(`    rt.knownMembers(o, ${className}.memberNames, out);`);
  for (const m of members) lines.push(`    ${m.specLine ?? ""}`);
  if (ordered) {
    lines.push(`    rt.orderedContent(out, o, ${JSON.stringify(ORDERED_MEMBER)}, ${JSON.stringify(doc.attributes.map((a) => a.name))});`);
  }
  lines.push("    return out;", "  }");
  if (withChoices) {
    lines.push("  /** Explicit validation includes deferred choices and nested model validation. */");
    lines.push("  static validate(input: unknown, visiting = new WeakSet<object>()): readonly rt.Violation[] {");
    lines.push(`    const out = [...${className}.validateShape(input)];`);
    lines.push("    if (!rt.isRecord(input) || out.length > 0 || visiting.has(input)) return out;");
    if (filledAny) {
      lines.push(`    let effective: unknown = input;`);
      lines.push(`    try { if (!(input instanceof ${className})) effective = new ${className}(input as unknown as ${className}Init); }`);
      lines.push("    catch (error) { if (error instanceof rt.ValidationError) return error.violations; throw error; }");
      lines.push("    const value = effective as rt.Rec;");
    } else lines.push("    const value = input;");
    lines.push("    visiting.add(input);", "    try {");
    lines.push(`      rt.nestedChoices(out, value, ${className}.memberNames, MODELS, visiting);`);
    lines.push(`      rt.choices(out, value, ${JSON.stringify(choicePlan.groups)});`);
    lines.push("      return out;", "    } finally { visiting.delete(input); }", "  }");
  }
  lines.push("}", "");
  return lines.join("\n");
}
