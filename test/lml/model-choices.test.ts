import {readFile,writeFile,mkdir,copyFile,symlink} from "node:fs/promises";
import {join,dirname,resolve} from "node:path";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {afterAll,describe,it} from "vitest";
import type {Bundle} from "../../src/contracts.js";
import {generateModelsWith,createKeyValueEmitter} from "../../src/index.js";
import {createXmlEmitter} from "../../src/xml/index.js";
import {canonicalTree,stripWs,stable} from "../../scripts/mml/lib.mjs";
import {pathToFileURL} from "node:url";
import {execFileSync} from "node:child_process";
import assert from "node:assert/strict";
const sdk=resolve(import.meta.dirname,"../..");
const out=mkdtempSync(join(tmpdir(),"lml-choices-"));
afterAll(()=>rmSync(out,{recursive:true,force:true}));
const fixture=JSON.parse(await readFile(new URL("./fixtures/model-choices.json",import.meta.url),"utf8")) as {bundle:Bundle;cases:{id:string;model_id:string;input:unknown;expected:{construct:string[];json_input:string[];json_wire:unknown;json_roundtrip:string[];xml_wire:string;xml_roundtrip:string[]}}[]};

const options={contractsModule:"./contracts-shim.js"};
const files=generateModelsWith(fixture.bundle,{types:{}},[createKeyValueEmitter("json",options),createXmlEmitter(options)],options);
for(const [name,text] of files){await mkdir(dirname(join(out,name)),{recursive:true});await writeFile(join(out,name),text);}
await copyFile(sdk+"/src/contracts.ts",out+"/contracts-shim.ts");
await writeFile(out+"/package.json",'{"type":"module"}');
try{await symlink(sdk+"/node_modules",out+"/node_modules","dir");}catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;}
await writeFile(out+"/tsconfig.json",JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,skipLibCheck:true,noUncheckedIndexedAccess:true,exactOptionalPropertyTypes:true,outDir:"dist"},include:["./*.ts","./json/*.ts","./xml/*.ts"]}));
try{execFileSync(process.execPath,[sdk+"/node_modules/typescript/bin/tsc","-p",out+"/tsconfig.json"],{encoding:"utf8",stdio:"pipe"});}catch(e){console.error((e as {stdout?:string}).stdout??e);throw e;}
const generated=await import(pathToFileURL(out+"/dist/index.js").href);


describe("source model choice semantics and deferred validation",()=>{
it.each(fixture.cases)("$id",async(row)=>{
 const modelClass=generated.MODELS[row.model_id];
 const init = row.model_id === "LmlModelChoicesFixtures::Parent@default" && Object.hasOwn(row.input as object,"child")
  ? {child:new generated.MODELS["LmlModelChoicesFixtures::Plain@default"]((row.input as {child:unknown}).child)} : row.input;
 const model=new modelClass(init);
 const codes=(value:unknown):string[]=>modelClass.validate(value).map((problem:{code:string})=>problem.code);
 const phase=(read:()=>unknown):string[]=>{try{return codes(read());}catch(error){if(row.expected.json_input.includes("eager_collection_count_out_of_range") && (error as {info?:{reason:string}}).info?.reason === "invalid_document")return ["eager_collection_count_out_of_range"];throw error;}};
 assert.deepEqual(codes(model),row.expected.construct,row.id+" construct");
 const json=generated.json.CODECS[row.model_id];
 assert.deepEqual(phase(()=>json.decode(row.input)),row.expected.json_input,row.id+" raw JSON");
 assert.deepEqual(json.encode(model),row.expected.json_wire,row.id+" JSON writer");
 assert.deepEqual(phase(()=>json.decode(json.encode(model))),row.expected.json_roundtrip,row.id+" JSON reread");
 const xml=generated.xml.CODECS[row.model_id];const text=await xml.stringify(model);
 assert.equal(stable(stripWs(await canonicalTree(text))),stable(stripWs(await canonicalTree(row.expected.xml_wire))),row.id+" XML writer");
 assert.deepEqual(codes(await xml.parse(row.expected.xml_wire)),row.expected.xml_roundtrip,row.id+" XML read");

},30000);
});
