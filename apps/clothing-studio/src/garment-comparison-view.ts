import {MATERIALS,isBottoms,type Product} from './product.ts';
import {fabricVariants,comparisonReceipt,type ComparisonBody,type GarmentComparisonReceipt} from './garment-comparison.ts';
import type {GarmentDrapeResult} from './garment-drape.ts';
interface Capture {product:Product;body:ComparisonBody}
/** A read-only experiment until the explicit, guarded material choice. */
export function mountGarmentComparison(host:HTMLElement,options:{capture:()=>Capture;apply:(material:string)=>boolean}){
 const panel=document.createElement('details');panel.id='garment-comparison';panel.dataset.independentExperiment='true';
 panel.innerHTML=`<summary>Compare fabrics on this garment</summary><p>Compare two approximate fabric drapes on the same committed top and entered body. Colors, prints, artwork and rib trims stay the same. Apply pending product edits first.</p><form><div class="measure-grid">${['A','B'].map((name,i)=>`<label class="field">Comparison fabric ${name}<select name="fabric${name}">${MATERIALS.map(m=>`<option value="${m.id}"${m.id===(i?'denim-340':'jersey-180')?' selected':''}>${m.name} · ${m.gsm} gsm</option>`).join('')}</select></label>`).join('')}</div><div class="inline-actions"><button type="submit">Compare garment fabrics</button><button type="button" id="garment-comparison-cancel" class="quiet" hidden>Cancel garment comparison</button><button type="button" id="garment-comparison-download" class="quiet" disabled>Download garment comparison</button></div></form><p id="garment-comparison-status" role="status">Choose a top to compare fabrics.</p><div id="garment-comparison-results" class="garment-comparison-grid"></div><p class="fine-print">Approximate texture-based stretch/bending and library weight; not measured fabric specimens. Same pattern, body, mesh, solve settings and fixed front/back views. Pockets ride on the body fabric; no cloth self/layer contact. Images and numerical differences do not establish physical fit. Comparison results are session-only.</p>`;host.append(panel);
 const form=panel.querySelector('form')!,status=panel.querySelector<HTMLElement>('#garment-comparison-status')!,cards=panel.querySelector<HTMLElement>('#garment-comparison-results')!,run=form.querySelector<HTMLButtonElement>('[type=submit]')!,cancel=panel.querySelector<HTMLButtonElement>('#garment-comparison-cancel')!,download=panel.querySelector<HTMLButtonElement>('#garment-comparison-download')!;
 let current:Capture|null=null,origin:Capture|null=null,worker:Worker|null=null,generation=0,receipt:GarmentComparisonReceipt|null=null;
 const urls:string[]=[];
 const same=(a:Capture|null,b:Capture|null)=>a?.product===b?.product&&JSON.stringify(a?.body)===JSON.stringify(b?.body);
 function stop(){generation++;worker?.terminate();worker=null;run.disabled=!current;cancel.hidden=true;}
 function invalidate(message:string){stop();origin=null;receipt=null;download.disabled=true;cards.replaceChildren();for(const url of urls.splice(0))URL.revokeObjectURL(url);status.textContent=message;}
 const owns=(token:number,capture:Capture)=>generation===token&&same(current,capture);
 const sync=(product:Product|null,body:ComparisonBody|null)=>{const next=product&&body&&!isBottoms(product)?{product,body:{...body}}:null;if(!same(current,next)){current=next;invalidate(next?'Ready to compare fabrics on this top.':'Choose a top to compare fabrics.');}run.disabled=!current||!!worker||!cancel.hidden;};
 const reset=()=>invalidate('Comparison cleared. Run again for the current garment.');
 form.addEventListener('input',()=>invalidate('Comparison fabrics changed. Run again.'));form.addEventListener('change',()=>invalidate('Comparison fabrics changed. Run again.'));
 cancel.addEventListener('click',()=>invalidate('Comparison cancelled. Your garment is unchanged.'));
 window.addEventListener('pagehide',()=>invalidate('Comparison stopped on leaving the page.'));
 function solve(product:Product,capture:Capture,token:number):Promise<GarmentDrapeResult>{return new Promise((resolve,reject)=>{
  let active:Worker;
  try{active=new Worker(new URL('./garment-drape.worker.ts',import.meta.url),{type:'module'});worker=active;
   active.onmessage=(event:MessageEvent<{kind:string;result:GarmentDrapeResult;message:string;frame:number;frames:number}>)=>{
    if(!owns(token,capture)||worker!==active)return;
    if(event.data.kind==='progress')return;
    active.terminate();worker=null;
    if(event.data.kind==='result')resolve(event.data.result);else reject(new Error(event.data.message||'Garment comparison failed.'));
   };
   active.onerror=event=>{event.preventDefault();if(owns(token,capture)&&worker===active){active.terminate();worker=null;reject(new Error('The comparison worker could not run.'));}};
   active.postMessage({product,bodyChest:capture.body.chest,bodyShape:capture.body});
  }catch(error){worker?.terminate();worker=null;reject(error);}
 });}
 form.addEventListener('submit',event=>{event.preventDefault();void compare();});
 async function compare(){
  let owned:number|undefined;
  invalidate('Preparing comparison…');
  try{
   const capture=options.capture();if(!same(current,capture))throw new Error('The garment changed. Run again.');
   const materials:[string,string]=[(form.elements.namedItem('fabricA') as HTMLSelectElement).value,(form.elements.namedItem('fabricB') as HTMLSelectElement).value];
   const source=structuredClone(capture.product),products=fabricVariants(source,materials),token=++generation;owned=token;
   origin=capture;run.disabled=true;cancel.hidden=false;
   const results:GarmentDrapeResult[]=[],renders:{front:Blob;back:Blob}[]=[];
   for(let i=0;i<2;i++){
    status.textContent=`Comparing fabric ${i+1} of 2…`;
    const result=await solve(products[i]!,capture,token);if(!owns(token,capture))return;results.push(result);
    status.textContent=`Rendering fabric ${i+1} of 2…`;
    const {productSnapshotRenders}=await import('./product-3d.ts');if(!owns(token,capture))return;
    renders.push(await productSnapshotRenders(products[i]!,result));if(!owns(token,capture))return;
   }
   const data=comparisonReceipt(source,capture.body,materials,results as [GarmentDrapeResult,GarmentDrapeResult]);
   for(let i=0;i<2;i++){
    const candidate=data.candidates[i]!,card=document.createElement('article'),heading=document.createElement('h5'),images=document.createElement('div'),metrics=document.createElement('p'),use=document.createElement('button');card.className='garment-comparison-card';images.className='garment-comparison-images';heading.textContent=`${candidate.material.name} · ${candidate.material.gsm} gsm`;
    for(const view of ['front','back'] as const){const image=document.createElement('img'),url=URL.createObjectURL(renders[i]![view]);urls.push(url);image.src=url;image.alt=`${candidate.material.name}, matched ${view} drape`;images.append(image);}
    const m=candidate.result.metrics;metrics.textContent=`${(m.maxStrain*100).toFixed(1)}% maximum edge extension · ${m.residualSpeed.toFixed(2)} cm/s final speed · ${m.minClearance.toFixed(3)} cm minimum body clearance · ${(m.contact*100).toFixed(1)}% contact. ${candidate.warnings.join(' ')}`;
    use.type='button';use.textContent=`Use ${candidate.material.name}`;use.addEventListener('click',()=>{
     try{const latest=options.capture();if(!receipt||!same(origin,latest))throw new Error('The garment or body changed. Run a new comparison.');if(!options.apply(candidate.material.id))throw new Error('The fabric choice could not be applied. Your design is unchanged.');invalidate(`${candidate.material.name} applied to non-rib parts. Undo restores the previous fabrics.`);}
     catch(error){status.textContent=error instanceof Error?error.message:'The fabric could not be applied.';}
    });card.append(heading,images,metrics,use);cards.append(card);
   }
   receipt=data;download.disabled=false;run.disabled=false;cancel.hidden=true;status.textContent=`Comparison ready. Captured body: ${capture.body.chest} cm chest / ${Number(capture.body.waist.toFixed(2))} cm waist / ${Number(capture.body.hip.toFixed(2))} cm hip. Choose a fabric deliberately; your garment is unchanged.`;
  }catch(error){if(owned!==undefined&&owned!==generation)return;invalidate(`${error instanceof Error?error.message:'Comparison unavailable.'} Run again to retry.`);}
 }
 download.addEventListener('click',()=>{if(!receipt)return;const url=URL.createObjectURL(new Blob([JSON.stringify(receipt,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='clothing-garment-comparison.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 return{sync,reset};
}
