import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll } from "vitest";
import { LmlError } from "../../src/contracts.js";
import type { Bindings, Bundle } from "../../src/contracts.js";
import { createKeyValueEmitter } from "../../src/codecs/index.js";
import { generateModelsWith } from "../../src/generator/index.js";
import { createXmlEmitter } from "../../src/xml/index.js";

const REPO = resolve(import.meta.dirname, "../..");
const created: string[] = [];
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loaded = Record<string, any>;

/** Generates models + xml (and optionally json) codecs into a fresh directory. */
export function generateInto(bundle: Bundle, opts: { bindings?: Bindings; json?: boolean; extra?: Record<string, string> } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "lml-xhooks-"));
  created.push(dir);
  const contractsModule = "./contracts-shim.js";
  const emitters = [createXmlEmitter({ contractsModule }), ...(opts.json === true ? [createKeyValueEmitter("json", { contractsModule })] : [])];
  const files = generateModelsWith(bundle, opts.bindings ?? { types: {} }, emitters, { contractsModule });
  for (const [path, text] of files) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  for (const [path, text] of Object.entries(opts.extra ?? {})) writeFileSync(join(dir, path), text);
  copyFileSync(join(REPO, "src/contracts.ts"), join(dir, "contracts-shim.ts"));
  writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
  return dir;
}

/** Strict tsc over everything in the directory; throws with the compiler output. */
export function tscCheck(dir: string): void {
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022", lib: ["ES2022"], module: "NodeNext", moduleResolution: "NodeNext", types: [],
      strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noImplicitOverride: true,
      noFallthroughCasesInSwitch: true, noUnusedLocals: true, noUnusedParameters: true,
      verbatimModuleSyntax: true, isolatedModules: true, skipLibCheck: true, noEmit: true,
    },
    include: ["./*.ts", "./xml/*.ts", "./json/*.ts"],
  }));
  try {
    execFileSync(process.execPath, [join(REPO, "node_modules/typescript/bin/tsc"), "-p", join(dir, "tsconfig.json")], { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    throw new Error(`tsc failed:\n${(error as { stdout?: string }).stdout ?? ""}`);
  }
}

export async function load(dir: string, entry = "index.ts"): Promise<Loaded> {
  return (await import(pathToFileURL(join(dir, entry)).href)) as Loaded;
}

export async function infoOf(run: () => Promise<unknown> | unknown): Promise<LmlError["info"] | undefined> {
  try {
    await run();
  } catch (error) {
    const info = (error as { name?: string; info?: LmlError["info"] }).info;
    if (info === undefined) throw error;
    return info;
  }
  return undefined;
}
