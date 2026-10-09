import {DEFAULT_CONSTRUCTION,validateConstruction,patternGeometry,patternSvg} from './construction.ts';
import type {Project} from './model.ts';
export const constructionMarkup=`<section class="panel construction-panel" aria-labelledby="construction-heading"><div><p class="eyebrow">MEASURED CONSTRUCTION</p><h3 id="construction-heading">Draft a two-panel skirt</h3><p>Develop a flared skirt from physical measurements. The front and back are matching curved panels with paired side seams. This is separate from the tee illustration and photo overlay.</p><p class="fine-print">Seam lines only: no seam/hem allowance, waistband or closure. Enter garment circumferences, including your intended ease; these are not measured from your photo. Validate fit and construction before cutting fabric.</p><div class="construction-fields">${[['waist','Waist circumference (cm)','80'],['hem','Hem circumference (cm)','140'],['slant','Slant seam length (cm)','60']].map(([id,label,value])=>`<label>${label}<input id="construction-${id}" type="text" inputmode="decimal" maxlength="40" value="${value}"></label>`).join('')}</div><div class="construction-actions"><button id="construction-apply">Apply measured pattern</button><button id="construction-discard" class="quiet">Discard pattern edits</button><button id="construction-export" class="quiet">Export full-size pattern SVG</button></div><p id="construction-summary" role="status"></p></div><div id="construction-pattern" class="pattern-paper" role="img" aria-label="Measured skirt pattern panels"></div></section>`;
export function mountConstruction(options:{current:()=>Project;commit:(next:Project)=>void;guard:()=>boolean;notice:(text:string,error?:boolean)=>void;download:(blob:Blob,suffix:string)=>void}){
 const fields=['waist','hem','slant'] as const;
 const input=(key:typeof fields[number])=>document.getElementById(`construction-${key}`) as HTMLInputElement;
 let signature='';
 function reset(){const d=options.current().construction??DEFAULT_CONSTRUCTION;for(const key of fields)input(key).value=String(d[key]);}
 function dirty(){const d=options.current().construction??DEFAULT_CONSTRUCTION;return fields.some(key=>input(key).value!==String(d[key]));}
 function render(p:Project){
  const next=JSON.stringify(p.construction??null);if(next!==signature){signature=next;reset();}
  const host=document.getElementById('construction-pattern')!,summary=document.getElementById('construction-summary')!;
  if(!p.construction){host.textContent='Apply measurements to create the two-panel pattern.';summary.textContent='No measured pattern is saved yet.';return;}
  const d=p.construction,g=patternGeometry(d);host.innerHTML='<div class="pattern-labels"><span>Front · cut 1</span><span>Back · cut 1</span></div>'+patternSvg(d);summary.textContent=`Committed: waist ${d.waist} cm · hem ${d.hem} cm · slant ${d.slant} cm. Each panel: waist arc ${d.waist/2} cm, hem arc ${d.hem/2} cm, two ${d.slant} cm side seams. Assembled vertical height ${g.height.toFixed(2)} cm.`;
 }
 for(const action of ['apply','discard','export']){
  const button=document.getElementById(`construction-${action}`)!;
  button.addEventListener('pointerdown',event=>{event.preventDefault();if(action!=='discard'&&!options.guard())event.stopImmediatePropagation();});
  button.addEventListener('click',()=>{
   if(action==='discard'){reset();options.notice('Pattern drafts discarded; committed work is unchanged.');return;}
   if(!options.guard())return;
   try{
    if(action==='apply'){
     const values=Object.fromEntries(fields.map(key=>{const raw=input(key).value;if(!raw.trim())throw new Error(`${key} is required in cm.`);return [key,Number(raw)];}));
     const d=validateConstruction({kind:'flared-skirt',...values});options.commit({...options.current(),construction:d});reset();options.notice('Measured pattern applied. Undo restores the previous complete concept.');
    }else{
     if(dirty())throw new Error('Apply or discard pattern drafts before exporting.');
     const d=options.current().construction;if(!d)throw new Error('Apply measurements before exporting a pattern.');
     options.download(new Blob([patternSvg(d)],{type:'image/svg+xml;charset=utf-8'}),'-skirt-pattern.svg');options.notice('Full-size seam-line pattern exported. Check the 5 cm square; no seam or hem allowance is included.');
    }
   }catch(error){options.notice(error instanceof Error?error.message:'Could not apply the pattern.',true);}
  });
 }
 return {render,reset,dirty};
}
