import {PROFILE_KEY,PROFILE_BYTES,emptyBodyProfiles,readBodyProfiles,writeBodyProfiles,validateBodyProfiles,mergeBodyProfiles,type BodyProfile,type BodyProfiles,type ProfileBody} from './top-body-profiles.ts';
/** Profiles are explicitly saved local assets, separate from the garment and its exports. */
export function mountTopBodyProfiles(host:HTMLElement,options:{capture:()=>ProfileBody;use:(body:ProfileBody)=>void;download:(blob:Blob,name:string)=>void}){
 const panel=document.createElement('details');panel.id='top-body-profiles';panel.dataset.independentExperiment='true';
 panel.innerHTML=`<summary>Saved body profiles</summary><p>Save applied top-body measurements for another design or visit. Selecting previews a profile; Use applies it. Apply or discard body drafts first. Blank optional dimensions keep chest-based proportions.</p><label class="field">Saved body profile<select id="body-profile-select"><option value="">Choose a saved profile</option></select></label><p id="body-profile-preview" class="fine-print"></p><label class="field">Body profile name<input id="body-profile-name" maxlength="60" autocomplete="off"></label><div class="inline-actions"><button type="button" id="body-profile-save">Save body as new profile</button><button type="button" id="body-profile-update" class="quiet">Update selected body profile</button><button type="button" id="body-profile-use">Use selected body profile</button><button type="button" id="body-profile-delete" class="quiet">Delete selected body profile</button></div><div id="body-profile-confirm" hidden><p>Delete this saved profile? The current body and garment stay as they are.</p><button type="button" id="body-profile-delete-confirm">Confirm profile deletion</button><button type="button" id="body-profile-delete-cancel" class="quiet">Keep profile</button></div><div class="inline-actions"><button type="button" id="body-profile-download" class="quiet">Download body profiles</button><label class="button quiet file-button">Import body profiles<input id="body-profile-import" type="file" accept="application/json,.json"></label><button type="button" id="body-profile-recovery" class="quiet" hidden>Download unreadable profile data</button></div><p id="body-profile-status" role="status">Profiles stay in this browser only when you save them. Up to 20 profiles; backup imports append new names and refuse conflicting measurements.</p><p class="fine-print">These are private body measurements: backups contain them. Clearing browser data removes saved profiles. The profile library is separate from project backups. Using a profile saves its measurement values with the current design. These are not personalized anatomical avatars or validated physical fit.</p>`;
 host.append(panel);
 const get=<T extends HTMLElement>(id:string)=>panel.querySelector<T>(`#${id}`)!;
 const select=get<HTMLSelectElement>('body-profile-select'),name=get<HTMLInputElement>('body-profile-name'),status=get('body-profile-status'),preview=get('body-profile-preview'),confirmation=get('body-profile-confirm'),file=get<HTMLInputElement>('body-profile-import');
 let library=emptyBodyProfiles(),available=true,generation=0,pending=false,deleted:BodyProfile|null=null,recovery:string|null=null;
 const selected=()=>library.profiles.find(p=>p.name===select.value);
 function render(wanted=select.value){
  select.replaceChildren(new Option('Choose a saved profile',''),...library.profiles.map(p=>new Option(p.name,p.name)));select.value=library.profiles.some(p=>p.name===wanted)?wanted:'';
  const p=selected();preview.textContent=p?`${p.body.chest} cm chest / ${p.body.waist??'proportional'} waist / ${p.body.hip??'proportional'} hip / ${p.body.chestDepth??'proportional'} chest depth (cm). Choose Use to apply these settings.`:'';
  for(const action of ['update','use','delete'])get<HTMLButtonElement>(`body-profile-${action}`).disabled=!available||!p;
  get<HTMLButtonElement>('body-profile-save').disabled=!available;file.disabled=!available;get<HTMLButtonElement>('body-profile-download').disabled=!available||!library.profiles.length;
  get<HTMLButtonElement>('body-profile-recovery').hidden=recovery===null;
 }
 function refresh(){try{library=readBodyProfiles(localStorage);available=true;recovery=null;}catch{available=false;try{recovery=localStorage.getItem(PROFILE_KEY);}catch{recovery=null;}status.textContent='Saved profiles could not be read. Stored data was left untouched. Download unreadable data if available, then restore it outside this library or reload after fixing storage.';}render();}
 function cancelRead(){generation++;if(pending){pending=false;status.textContent='Profile import cancelled by a newer profile action. Choose the backup again.';}confirmation.hidden=true;deleted=null;}
 function fail(error:unknown){status.textContent=`${error instanceof Error?error.message:'Body profiles unavailable.'} Profiles, current body and garment are unchanged.`;}
 function fresh(){const next=readBodyProfiles(localStorage);return next;}
 function publish(next:BodyProfiles,wanted:string,message:string){library=writeBodyProfiles(localStorage,next);render(wanted);status.textContent=message;}
 function action(work:()=>void){cancelRead();try{work();}catch(error){fail(error);}}
 select.addEventListener('change',()=>{cancelRead();render();name.value=selected()?.name??'';});
 name.addEventListener('input',cancelRead);
 get('body-profile-save').addEventListener('click',()=>action(()=>{
  const next=fresh(),profile=validateBodyProfiles({schema:1,kind:'clothing-top-body-profiles',profiles:[{name:name.value,body:options.capture()}]}).profiles[0]!;
  if(next.profiles.some(p=>p.name.toLowerCase()===profile.name.toLowerCase()))throw new Error('That profile name already exists. Choose another name or Update selected.');
  next.profiles.push(profile);publish(next,profile.name,`Body profile “${profile.name}” saved in this browser.`);
 }));
 get('body-profile-update').addEventListener('click',()=>action(()=>{
  const original=selected();if(!original)throw new Error('Select a profile first.');const next=fresh(),at=next.profiles.findIndex(p=>p.name===original.name);
  if(at<0||JSON.stringify(next.profiles[at])!==JSON.stringify(original))throw new Error('The selected profile changed elsewhere. Select it again before updating.');
  next.profiles[at]={name:name.value,body:options.capture()};const validated=validateBodyProfiles(next),saved=validated.profiles[at]!;publish(validated,saved.name,`Body profile “${saved.name}” updated in this browser.`);
 }));
 get('body-profile-use').addEventListener('click',()=>action(()=>{
  const original=selected(),next=fresh(),p=next.profiles.find(p=>p.name===original?.name);
  if(!p||JSON.stringify(p)!==JSON.stringify(original))throw new Error('The selected profile changed elsewhere. Select it again before using it.');
  options.use({...p.body});status.textContent=`Body profile “${p.name}” applied to this design. You can undo this.`;
 }));
 get('body-profile-delete').addEventListener('click',()=>{cancelRead();deleted=selected()?structuredClone(selected()!):null;confirmation.hidden=!deleted;});
 get('body-profile-delete-cancel').addEventListener('click',cancelRead);
 get('body-profile-delete-confirm').addEventListener('click',()=>{
  const target=deleted;action(()=>{const next=fresh(),p=next.profiles.find(p=>p.name===target?.name);if(!p||JSON.stringify(p)!==JSON.stringify(target))throw new Error('The selected profile changed elsewhere. Select it again before deleting.');next.profiles=next.profiles.filter(item=>item.name!==p.name);publish(next,'','Body profile deleted. Current body and garment unchanged.');});
 });
 get('body-profile-download').addEventListener('click',()=>action(()=>{const next=fresh();options.download(new Blob([JSON.stringify(next,null,2)],{type:'application/json'}),'clothing-body-profiles.json');status.textContent='Body profile backup prepared. It contains private measurements.';}));
 get('body-profile-recovery').addEventListener('click',()=>{if(recovery!==null)options.download(new Blob([recovery],{type:'text/plain'}),'clothing-body-profiles-unreadable.txt');});
 file.addEventListener('change',()=>{
  cancelRead();const picked=file.files?.[0];file.value='';if(!picked)return;const token=++generation;
  if(picked.size>PROFILE_BYTES){fail(new Error('Body profile backups must be at most 64 KiB.'));return;}
  pending=true;status.textContent='Reading body profile backup…';
  void picked.text().then(text=>{if(token!==generation)return;pending=false;if(new TextEncoder().encode(text).length>PROFILE_BYTES)throw new Error('Body profile backups must be at most 64 KiB.');const incoming=validateBodyProfiles(JSON.parse(text)),next=mergeBodyProfiles(fresh(),incoming);publish(next,select.value,'Body profiles imported. Select one and choose Use to apply it.');}).catch(error=>{if(token!==generation)return;pending=false;fail(error);});
 });
 window.addEventListener('storage',event=>{if(event.storageArea===localStorage&&(event.key===PROFILE_KEY||event.key===null)){cancelRead();refresh();if(available)status.textContent='Saved profiles changed in another tab. Current body and garment unchanged.';}});
 window.addEventListener('pagehide',cancelRead);window.addEventListener('pageshow',refresh);refresh();
 return{reset:()=>{cancelRead();if(available)status.textContent='Current design body settings restored. Saved profiles remain available; choose Use to apply one.';}};
}
