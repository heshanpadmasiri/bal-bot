import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm, access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';

// Exercise the actual server helpers without starting servers, builds or captures.
const source=await readFile(new URL('./server.mjs',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('async function repeatSVGPresent('),source.indexOf('function sendJSON('));
const {repeatSVGPresent,previewSVG}=runInNewContext(`${helpers}\n({repeatSVGPresent,previewSVG})`,{
 readFile,join,exists:async path=>{try{await access(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}},
});

for(const [first,repeat] of [[false,true],[true,false],[false,false],[true,true]]){
 test(`independent preview presence: first=${first}, repeat=${repeat}`,async()=>{
  const folder=await mkdtemp(join(tmpdir(),'review-preview-'));
  try{
   const meta={svg:first,repeat:true,repeatSVGPresence:repeat};
   if(first)await writeFile(join(folder,'diagram.svg'),'<svg>first</svg>');
   if(repeat)await writeFile(join(folder,'repeat.svg'),'<svg>repeat</svg>');
   assert.equal(await previewSVG(meta,folder,false),first?'<svg>first</svg>':null);
   assert.equal(await previewSVG(meta,folder,true),repeat?'<svg>repeat</svg>':null);
   assert.equal(await repeatSVGPresent(meta,folder),repeat);
  }finally{await rm(folder,{recursive:true,force:true});}
 });
}

test('missing expected first or repeat SVG is an ENOENT, not captured absence',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'review-preview-'));
 try{
  const meta={svg:true,repeat:true,repeatSVGPresence:true};
  for(const repeat of [false,true])await assert.rejects(previewSVG(meta,folder,repeat),{code:'ENOENT'});
  await assert.rejects(previewSVG({svg:false,repeat:false},folder,true),{code:'ENOENT'});
 }finally{await rm(folder,{recursive:true,force:true});}
});

test('legacy repeat presence is independent and missing uncertain artifacts fail closed',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'review-preview-'));
 try{
  await writeFile(join(folder,'repeat.svg'),'<svg>repeat</svg>');
  assert.equal(await previewSVG({svg:false,repeat:true},folder,true),'<svg>repeat</svg>');
  await rm(join(folder,'repeat.svg'));
  assert.equal(await previewSVG({svg:false,repeat:true,comparison:{svg:true}},folder,true),null);
  await assert.rejects(previewSVG({svg:false,repeat:true,comparison:{svg:false}},folder,true),{code:'ENOENT'});
  await assert.rejects(previewSVG({svg:true,repeat:true},folder,true),{code:'ENOENT'});
 }finally{await rm(folder,{recursive:true,force:true});}
});
