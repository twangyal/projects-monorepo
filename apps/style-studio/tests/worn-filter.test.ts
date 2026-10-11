import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoProject} from '../src/demo.ts';
import {generateAlternatives,trainPreferenceModel} from '../src/model.ts';
import type {PieceIds} from '../src/types.ts';
test('explicit repeat filter excludes exact ordered combinations without changing learned scores or votes',()=>{
 const p=createDemoProject(),before=structuredClone(p),model=trainPreferenceModel(p.examples),ids=p.looks[0].pieces.map(x=>x.id) as unknown as PieceIds;
 const original=generateAlternatives(p.pieces,model,{mode:'match',occasion:'any'}),filtered=generateAlternatives(p.pieces,model,{mode:'match',occasion:'any',excludePieceIds:[ids,ids]});
 assert.equal(original.eligibleCount,8);assert.equal(filtered.eligibleCount,7);assert.equal(filtered.excludedCount,1);assert.ok(filtered.candidates.every(x=>x.pieceIds.join(':')!==ids.join(':')));assert.deepEqual(p,before);if(model.status==='trained')for(const c of filtered.candidates){const logit: number=c.features.reduce((sum,x,i)=>sum+x*model.weights[i],model.intercept);assert.equal(c.taste!.score,Math.round(100/(1+Math.exp(-logit))));}
 const all:PieceIds[]=[];for(const top of p.pieces.filter(x=>x.category==='top'))for(const bottom of p.pieces.filter(x=>x.category==='bottom'))for(const shoes of p.pieces.filter(x=>x.category==='shoes'))all.push([top.id,bottom.id,shoes.id]);
 const excluded=generateAlternatives(p.pieces,model,{mode:'explore',occasion:'any',excludePieceIds:all});assert.equal(excluded.eligibleCount,0);assert.equal(excluded.excludedCount,8);assert.match(excluded.reason!,/worn|repeat/i);
 const cold=trainPreferenceModel([]);assert.equal(generateAlternatives(p.pieces,cold,{mode:'match',occasion:'any',excludePieceIds:[ids]}).ranked,false);
 const formal=generateAlternatives(p.pieces,model,{mode:'match',occasion:'formal',excludePieceIds:all});assert.equal(formal.eligibleCount,0);assert.equal(formal.excludedCount,0);
 const reversed=[ids[2],ids[1],ids[0]] as const;assert.equal(generateAlternatives(p.pieces,model,{mode:'match',occasion:'any',excludePieceIds:[reversed]}).excludedCount,0);
 const unknown=['a'.repeat(32),'b'.repeat(32),'c'.repeat(32)] as const;assert.equal(generateAlternatives(p.pieces,model,{mode:'match',occasion:'any',excludePieceIds:[unknown]}).eligibleCount,8);
});
test('repeat exclusion input refuses malformed, sparse, accessor and over-limit records',()=>{
 const p=createDemoProject(),model=trainPreferenceModel([]),ids=p.looks[0].pieces.map(x=>x.id) as unknown as PieceIds;
 for(const bad of [null,{},[[]],[[ids[0],ids[0],ids[0]]],[[ids[0],ids[1],'x']],Array(1),Array(31).fill(ids)])assert.throws(()=>generateAlternatives(p.pieces,model,{mode:'match',occasion:'any',excludePieceIds:bad as PieceIds[]}));
 const accessor=[...ids];Object.defineProperty(accessor,'0',{get:()=>{throw Error('getter must not run');},enumerable:true});assert.throws(()=>generateAlternatives(p.pieces,model,{mode:'match',occasion:'any',excludePieceIds:[accessor as unknown as PieceIds]}),/ordinary|exclusion/i);
});
