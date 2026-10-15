import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,serializeProject,parseProject,addTaggedExample} from '../src/domain.ts';
import {INSPIRATION, voteOnInspiration,inspirationIdeas} from '../src/inspiration.ts';
import {featuresFromTags} from '../src/features.ts';
import {trainPreferenceModel,assessOutfit} from '../src/model.ts';
test('pictured opinions are explicit reversible existing-schema evidence, with no owned clothes or sample votes',()=>{
 const empty=createProject();assert.equal(INSPIRATION.length,12);
 let p=voteOnInspiration(empty,INSPIRATION[0].id,'like');p=voteOnInspiration(p,INSPIRATION[1].id,'pass');
 assert.equal(empty.examples.length,0);assert.equal(p.pieces.length,0);assert.equal(p.examples.length,2);
 assert.deepEqual(p.examples[0].features,featuresFromTags(INSPIRATION[0].tags));
 const revised=voteOnInspiration(p,INSPIRATION[0].id,'pass');assert.equal(revised.examples.length,2);assert.equal(revised.examples[0].id,p.examples[0].id);assert.equal(revised.examples[0].label,'pass');
 assert.deepEqual(parseProject(serializeProject(revised)),revised);
 assert.equal(voteOnInspiration(revised,INSPIRATION[0].id,null).examples.length,1);
});
test('first inspiration responds to sparse real opinions without claiming a fitted model',()=>{
 const p=createProject();const a=inspirationIdeas(voteOnInspiration(p,INSPIRATION[0].id,'like'));
 const b=inspirationIdeas(voteOnInspiration(p,INSPIRATION[6].id,'like'));
 assert.equal(a.kind,'tag-match');assert.equal(a.opinions,1);assert.equal(a.ideas.length,3);
 assert.notDeepEqual(a.ideas.map(x=>x.outfit.id),b.ideas.map(x=>x.outfit.id));
 assert.equal(inspirationIdeas(p).kind,'unranked');
});
test('enough actual Like/Pass evidence uses the same fitted production model',()=>{
 let p=createProject();for(let i=0;i<8;i++)p=voteOnInspiration(p,INSPIRATION[i].id,i<4?'like':'pass');
 const result=inspirationIdeas(p),model=trainPreferenceModel(p.examples);assert.equal(result.kind,'learned');
 for(const idea of result.ideas)assert.equal(idea.value,assessOutfit(featuresFromTags(idea.outfit.tags),model)!.score);
});
test('catalog refusals cannot alter a full profile or an unrelated colliding imported opinion',()=>{
 let p=createProject();for(let i=0;i<80;i++)p=addTaggedExample(p,{caption:`Opinion ${i}`,label:'like',tags:INSPIRATION[0].tags,photoId:null});
 const exact=serializeProject(p);assert.throws(()=>voteOnInspiration(p,INSPIRATION[0].id,'like'));assert.equal(serializeProject(p),exact);
 const collision=createProject();collision.examples=[{...p.examples[0],id:INSPIRATION[0].id}];const before=serializeProject(collision);
 assert.throws(()=>voteOnInspiration(collision,INSPIRATION[0].id,'pass'));assert.equal(serializeProject(collision),before);
 assert.throws(()=>voteOnInspiration(createProject(),'unknown','like'));
});
