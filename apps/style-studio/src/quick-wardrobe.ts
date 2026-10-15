import {validateProject} from './domain.ts';
import {CATEGORIES,LIMITS,type Category,type Project,type Tags} from './types.ts';
/** User-reviewed starter metadata, never visual recognition or learned facts about clothing. */
export function starterPiece(project:Project,category:Category){
 const safe=validateProject(project);if(!CATEGORIES.includes(category))throw new Error('Choose top, bottom or shoes.');
 if(safe.pieces.length>=LIMITS.pieces)throw new Error('This profile already has 36 pieces.');
 if(safe.pieces.filter(p=>p.category===category).length>=LIMITS.piecesPerCategory)throw new Error(`This category already has 12 pieces. Edit or remove one first.`);
 let ordinal=1;while(safe.pieces.some(p=>p.name===`My ${category} ${ordinal}`))ordinal++;
 return {name:`My ${category} ${ordinal}`,category,tags:{palette:'neutral',fit:'regular',style:'minimal',formality:'casual'} as Tags,photoId:null};
}
interface IntakeHost{project():Project;ready():boolean;quick():boolean;draft():boolean;editing():boolean;review():string;start(category:Category):void;discard():void;ideas():void}
/** Reuses the same form/photo controller, so no parallel draft or writer is introduced. */
export function mountQuickWardrobe(app:HTMLElement,host:IntakeHost){
 const find=(s:string)=>app.querySelector<HTMLElement>(s)!;
 const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;n.className=className;return n;};
 const action=(text:string,fn:()=>void)=>{const b=make('button',text,'button subtle');b.type='button';b.addEventListener('click',fn);return b;};
 const form=find('#piece-form'),details=make('details','','piece-details'),summary=make('summary','Name & style tags');details.id='piece-details';details.open=true;details.append(summary,find('label[for="piece-name"]'),find('#piece-name'),find('#piece-tags'));form.insertBefore(details,find('label[for="piece-photo"]'));
 const review=make('p','','quick-piece-review');review.id='quick-piece-review';review.setAttribute('role','status');form.insertBefore(review,details);
 const guide=make('section','','quick-wardrobe');guide.setAttribute('aria-label','Quick wardrobe setup');guide.append(make('h3','Three pieces to a first look'),make('p','Start with clothes you own. Suggested names and starter tags keep setup light; review or edit them before adding. Photos are optional references, not recognized garments.','quiet'));
 const buttons=CATEGORIES.map(category=>{const b=action(`Start with ${category}`,()=>host.start(category));guide.append(b);return b;});
 const progress=make('p','','quiet');progress.id='quick-progress';progress.setAttribute('role','status');const ideas=action('Show my combinations',()=>host.ideas());guide.append(progress,ideas);find('#wardrobe').insertBefore(guide,find('#wardrobe .section-layout'));
 const discard=action('Discard quick piece',()=>host.discard());discard.id='discard-quick-piece';find('#piece-form .form-actions').append(discard);
 function sync(){const p=host.project(),counts=CATEGORIES.map(c=>p.pieces.filter(x=>x.category===c).length),ready=counts.filter(n=>n>0).length;progress.textContent=`${ready} of 3 categories ready · ${counts.map((n,i)=>`${CATEGORIES[i]}: ${n}`).join(' · ')}`;buttons.forEach((b,i)=>{b.disabled=!host.ready()||counts[i]>=12||p.pieces.length>=36;});ideas.disabled=ready!==3||!host.ready();discard.hidden=!host.quick()&&!host.draft();discard.textContent=host.quick()?'Discard quick piece':'Discard piece draft';review.hidden=!host.quick();review.textContent=host.quick()?`${host.review()} · editable starter tags, not recognized from your photo. Open Name & style tags to change them; Add wardrobe piece keeps the values shown.`:'';
  if(!host.quick()||host.editing()||find('main').dataset.styleExpanded==='true')details.open=true;
 }
 sync();return {sync,collapse:()=>{details.open=false;},expand:()=>{details.open=true;}};
}
