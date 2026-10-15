import {serializeProject,validateProject} from './domain.ts';
import {featuresFromTags} from './features.ts';
import {assessOutfit,trainPreferenceModel} from './model.ts';
import type {Label,Project,Tags} from './types.ts';
export interface Inspiration {id:string;name:string;tags:Tags}
/** Original illustrated references, not owned pieces and never pre-labelled preferences. */
export const INSPIRATION:readonly Inspiration[] = [
 ['Quiet tailoring','neutral','regular','minimal','smart'],
 ['Sunset weekend','warm','relaxed','playful','casual'],
 ['Coastal linen','cool','relaxed','minimal','casual'],
 ['City classics','neutral','fitted','classic','formal'],
 ['Court-side color','bright','relaxed','sporty','casual'],
 ['Earth-tone layers','warm','regular','classic','smart'],
 ['Electric studio','bright','fitted','playful','smart'],
 ['Night-time tailoring','cool','fitted','classic','formal'],
 ['Easy monochrome','neutral','relaxed','sporty','casual'],
 ['Gallery afternoon','warm','fitted','minimal','smart'],
 ['Blue movement','cool','regular','sporty','casual'],
 ['Color-block occasion','bright','regular','playful','formal'],
].map((row,index)=>({id:`f264000000000000000000000000${String(index).padStart(4,'0')}`,name:row[0],tags:{palette:row[1],fit:row[2],style:row[3],formality:row[4]} as Tags}));
const caption=(outfit:Inspiration)=>`Pictured style — ${outfit.name}`;
export function picturedOpinion(project:Project,outfit:Inspiration){
 const example=project.examples.find(x=>x.id===outfit.id);
 if(example&&(example.caption!==caption(outfit)||example.origin!=='tagged'||example.photoId!==null||example.sourceLookId!==null||JSON.stringify(example.features)!==JSON.stringify(featuresFromTags(outfit.tags))))throw new Error('An imported opinion uses this picture’s identity. Keep it in Your taste; it was not changed.');
 return example;
}
export function voteOnInspiration(project:Project,id:string,label:Label|null):Project{
 const next=validateProject(project),outfit=INSPIRATION.find(x=>x.id===id);if(!outfit)throw new Error('This pictured style is unavailable.');
 if(label!==null&&label!=='like'&&label!=='pass')throw new Error('Choose Like, Pass or clear your opinion.');
 const previous=picturedOpinion(next,outfit);
 if(label===null)next.examples=next.examples.filter(x=>x.id!==id);
 else if(previous)previous.label=label;
 else next.examples.push({id,caption:caption(outfit),label,origin:'tagged',features:featuresFromTags(outfit.tags),photoId:null,sourceLookId:null});
 serializeProject(next);return next;
}
export function inspirationIdeas(project:Project){
 const valid=validateProject(project),model=trainPreferenceModel(valid.examples),likes=valid.examples.filter(x=>x.label==='like'),passes=valid.examples.filter(x=>x.label==='pass');
 const kind=model.status==='trained'?'learned':valid.examples.length?'tag-match':'unranked';
 const overlap=(tags:Tags,examples:typeof likes)=>examples.length?examples.reduce((sum,x)=>sum+featuresFromTags(tags).reduce((s,v,i)=>s+v*x.features[i],0)/4,0)/examples.length:0;
 const rows=INSPIRATION.filter(x=>!valid.examples.some(e=>e.id===x.id&&e.label==='pass')).map(outfit=>({outfit,value:model.status==='trained'?assessOutfit(featuresFromTags(outfit.tags),model)!.score:overlap(outfit.tags,likes)-overlap(outfit.tags,passes)}));
 rows.sort((a,b)=>b.value-a.value||INSPIRATION.indexOf(a.outfit)-INSPIRATION.indexOf(b.outfit));
 return {kind,opinions:valid.examples.length,ideas:rows.slice(0,3)};
}
