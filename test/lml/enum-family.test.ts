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
const bundleText=await readFile(new URL('./fixtures/enum-family-bundle.json',import.meta.url),'utf8');
const corpus=JSON.parse(await readFile(new URL('./fixtures/enum-family-corpus.json',import.meta.url),'utf8')) as {rows:{id:string;input:string;expected:string;values:Record<string,string>}[];refusals:{input:string;attribute:string}[]};

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

const codec=generated.xml.CODECS['OmmlPortableEnumFamilyProbe@omml'];
describe('closed enum-family source values in a test-only wrapper',()=>{
it.each(corpus.rows)('$id XML/scalar source equality',async(row)=>{
 assert.ok(!row.input.includes('<!DOCTYPE')&&!row.input.includes('<!--'));
 const value=await codec.parse(row.input);const xml=await codec.stringify(value);
 assert.equal(stable(await canonicalTree(xml)),stable(await canonicalTree(row.expected)),row.id+' QName tree');
 for(const [key,expected] of Object.entries(row.values))assert.equal(value[key],expected,row.id+' scalar '+key);

},30000);
it.each(corpus.refusals)('$attribute rejects undeclared value',async(row)=>{await assert.rejects(()=>codec.parse(row.input));},30000);
});
