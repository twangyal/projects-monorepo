import {DEFAULT_BODY,validateBodyMeasurements,compareBody} from './body-fitting.ts';
import {validateProject,type Project} from './model.ts';
export const bodyMarkup=`<fieldset id="body-measurements"><legend>Body measurement comparison</legend><label><input id="body-enabled" type="checkbox"> Use body measurements</label><div class="construction-fields">${[['waist','Body waist circumference (cm)','80'],['hip','Body hip circumference (cm)','100'],['hipDepth','Waist-to-hip depth (cm)','20']].map(([key,label,value])=>`<label>${label}<input id="body-${key}" type="text" inputmode="decimal" maxlength="40" value="${value}" disabled></label>`).join('')}</div><div class="construction-actions"><button id="body-apply">Apply body measurements</button><button id="body-discard" class="quiet">Discard body edits</button></div><label><input id="body-translucent" type="checkbox"> Transparent garment comparison</label><p id="body-summary" role="status"></p><p class="fine-print">Entered measurements only: waist 50–180 cm, hip 50–220 cm, vertical hip depth 5–40 cm. The open circular rings are a measurement proxy, not anatomy. Differences compare nominal rigid circumferences; they do not establish comfort, mobility, cloth drape or physical fit. Pattern and OBJ exports remain garment-only.</p></fieldset>`;
export function mountBody(options:{current:()=>Project;commit:(next:Project)=>void;guard:()=>boolean;notice:(text:string,error?:boolean)=>void;view:()=>void}){
 const keys=['waist','hip','hipDepth'] as const;
 const input=(key:typeof keys[number])=>document.getElementById(`body-${key}`) as HTMLInputElement;
 const enabled=document.getElementById('body-enabled') as HTMLInputElement;
 const committed=()=>options.current().bodyMeasurements??DEFAULT_BODY;
 const sync=()=>{for(const key of keys)input(key).disabled=!enabled.checked;};
 let signature='';
 function reset(){enabled.checked=!!options.current().bodyMeasurements;for(const key of keys)input(key).value=String(committed()[key]);sync();}
 function dirty(){return enabled.checked!==!!options.current().bodyMeasurements||keys.some(key=>input(key).value!==String(committed()[key]));}
 function render(p:Project){
  const next=JSON.stringify(p.bodyMeasurements??null);if(next!==signature){signature=next;reset();}
  const summary=document.getElementById('body-summary')!;
  if(!p.bodyMeasurements){summary.textContent='No body measurements are saved. Enable and apply a profile to compare geometry.';return;}
  if(!p.construction){summary.textContent='Body measurements saved. Apply a measured skirt pattern to compare circumferences.';return;}
  const c=compareBody(p.construction,p.bodyMeasurements);
  const describe=(v:number)=>`${v>=0?'+':''}${v.toFixed(2)} cm (${v<0?'Negative: garment smaller':v===0?'Zero: same nominal circumference':'Positive: garment larger'})`;
  summary.textContent=`Waist difference ${describe(c.waistDifference)}. ${c.hipDifference===null?'Skirt does not reach the entered hip depth; no hip comparison or extrapolation.':`Hip difference ${describe(c.hipDifference)} at ${p.bodyMeasurements.hipDepth} cm below the waist.`} Geometry only; physical fit is unverified.`;
 }
 const host=document.getElementById('body-measurements')!;
 for(const type of ['pointerdown','click'] as const)host.addEventListener(type,event=>{
  const target=event.target as HTMLElement;
  if(target.closest('#body-discard')){if(type==='pointerdown')event.preventDefault();return;}
  if(!options.guard()){event.preventDefault();event.stopImmediatePropagation();}
 },true);
 enabled.addEventListener('change',sync);
 document.getElementById('body-translucent')!.addEventListener('change',options.view);
 document.getElementById('body-discard')!.addEventListener('click',()=>{reset();options.notice('Body drafts discarded; committed work is unchanged.');});
 const apply=document.getElementById('body-apply')!;
 apply.addEventListener('pointerdown',event=>event.preventDefault());
 apply.addEventListener('click',()=>{
  if(!options.guard())return;
  try{
   const next={...options.current()};
   if(enabled.checked){const values=Object.fromEntries(keys.map(key=>{const raw=input(key).value;if(!raw.trim())throw new Error(`${key} is required in cm.`);return [key,Number(raw)];}));next.bodyMeasurements=validateBodyMeasurements(values);}
   else delete next.bodyMeasurements;
   options.commit(validateProject(next));reset();options.notice('Body measurements applied. Comparison is geometric; physical fit is unverified.');
  }catch(error){options.notice(error instanceof Error?error.message:'Could not apply body measurements.',true);}
 });
 return {render,reset,dirty};
}
