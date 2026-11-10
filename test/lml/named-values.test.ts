import {readFile,writeFile,mkdir,copyFile,symlink} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {afterAll,describe,it} from 'vitest';
import {loadBundle,generateModelsWith} from '../../src/index.js';
import {createXmlEmitter} from '../../src/xml/index.js';
import {canonicalTree,stable} from '../../scripts/mml/lib.mjs';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const sdk=resolve(import.meta.dirname,'../..');
const out=mkdtempSync(join(tmpdir(),'lml-omml-enum-'));
afterAll(()=>rmSync(out,{recursive:true,force:true}));
const bundleText=await readFile(new URL('./fixtures/omml-enum-bundle.json',import.meta.url),'utf8');
const corpus=JSON.parse(await readFile(new URL('./fixtures/omml-enum-corpus.json',import.meta.url),'utf8')) as {rows:{id:string;input:string;expected:string;values:Record<string,string>}[];refusals:{input:string;attribute:string}[]};

const bundle=loadBundle(new TextEncoder().encode(bundleText),'json');
const options={contractsModule:'./contracts-shim.js'};
const files=generateModelsWith(bundle,{types:{}},[createXmlEmitter(options)],options);
for(const [name,text] of files){await mkdir(dirname(join(out,name)),{recursive:true});await writeFile(join(out,name),text);}
await copyFile(sdk+'/src/contracts.ts',out+'/contracts-shim.ts');
await writeFile(out+'/package.json','{"type":"module"}');
try{await symlink(sdk+'/node_modules',out+'/node_modules','dir');}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
await writeFile(out+'/tsconfig.json',JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,skipLibCheck:true,noUncheckedIndexedAccess:true,exactOptionalPropertyTypes:true,outDir:'dist'},include:['./*.ts','./xml/*.ts']}));
try{execFileSync(process.execPath,[sdk+'/node_modules/typescript/bin/tsc','-p',out+'/tsconfig.json'],{stdio:'pipe'});}catch(error){console.error(String((error as {stdout?:string}).stdout));throw error;}
const generated=await import(pathToFileURL(out+'/dist/index.js').href);

const codec=generated.xml.CODECS['Omml::Models::CTBr@omml'];
describe('actual OMML declared string enums',()=>{
it.each(corpus.rows)('$id XML/scalar source equality',async(row)=>{
 assert.ok(!row.input.includes('<!DOCTYPE')&&!row.input.includes('<!--'));
 const value=await codec.parse(row.input);const xml=await codec.stringify(value);
 assert.equal(stable(await canonicalTree(xml)),stable(await canonicalTree(row.expected)),row.id+' QName tree');
 for(const [key,expected] of Object.entries(row.values))assert.equal(value[key],expected,row.id+' scalar '+key);

},30000);
it.each(corpus.refusals)('$attribute rejects undeclared value',async(row)=>{await assert.rejects(()=>codec.parse(row.input));},30000);
});

it("lets a trusted binding handle the raw XML spelling separately", async () => {
  const root = join(out, "bound");
  const id = "Omml::Models::STBrType@omml";
  const bindings = { types: { [id]: { module: "./lexical.js", export: "BreakType", xmlLexical: true as const } } };
  const files = generateModelsWith(bundle, bindings, [createXmlEmitter(options)], options);
  for (const [name, source] of files) {
    const file = join(root, name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, source);
  }
  await copyFile(join(out, "contracts-shim.ts"), join(root, "contracts-shim.ts"));
  await writeFile(join(root, "lexical.ts"), `
export type BreakType = "page" | "column" | "textWrapping";
export function isBreakType(value: unknown): value is BreakType {
  return value === "page" || value === "column" || value === "textWrapping";
}
export function parseBreakTypeXml(raw: string): BreakType | null {
  if (raw === " ") return "page";
  const value = raw.trim();
  if (!isBreakType(value)) throw new Error("invalid break type");
  return value;
}
export function formatBreakTypeXml(value: BreakType): string { return value; }
`);
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({
    extends: "../tsconfig.json",
    compilerOptions: { outDir: "dist" },
    include: ["./*.ts", "./xml/*.ts"],
  }));
  execFileSync(process.execPath, [sdk + "/node_modules/typescript/bin/tsc", "-p", join(root, "tsconfig.json")], { stdio: "pipe" });
  const installed = await import(pathToFileURL(join(root, "dist/index.js")).href);
  const bound = installed.xml.CODECS["Omml::Models::CTBr@omml"];
  const source = corpus.rows.find((row) => row.values.type === "page");
  assert.ok(source);
  const model = await bound.parse(source.input.replace('="page"', '=" "'));
  assert.equal(model.type, "page");
  assert.equal(stable(await canonicalTree(await bound.stringify(model))), stable(await canonicalTree(source.expected)));
  await assert.rejects(() => bound.parse(source.input.replace('="page"', '=""')));
}, 30000);
