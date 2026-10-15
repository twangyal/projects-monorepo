import {INSPIRATION,inspirationIdeas,picturedOpinion,type Inspiration} from './inspiration.ts';
import type {Label,Project} from './types.ts';
interface JourneyHost {project():Project;ready():boolean;recovery():boolean;vote(id:string,label:Label|null):void}
type View='welcome'|'pictures'|'inspiration'|'wardrobe'|'taste'|'compose'|'ideas'|'saved'|'profile';
/** Presentation only: original editor nodes, raw fields and async owners remain mounted. */
export function mountStyleJourney(app:HTMLElement,host:JourneyHost){
 const find=(s:string)=>app.querySelector<HTMLElement>(s)!;
 const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;n.className=className;return n;};
 const action=(text:string,fn:()=>void)=>{const b=make('button',text,'button subtle');b.type='button';b.addEventListener('click',fn);return b;};
 const main=find('main'),hero=find('.hero'),profile=find('.profile-bar');
 const welcome=make('section','','journey-screen welcome-screen'),pictures=make('section','','journey-screen'),inspiration=make('section','','journey-screen');
 welcome.id='style-welcome';pictures.id='picture-preferences';inspiration.id='first-inspiration';
 const heading=(parent:HTMLElement,text:string,copy:string)=>{const h=make('h1',text);h.tabIndex=-1;parent.append(h,make('p',copy,'journey-copy'));return h;};
 heading(welcome,'Find your starting point','Choose a few pictured outfits. We’ll offer directions to explore before you add your own clothes. No names, tags or account needed.');
 const welcomeArt=outfitArt(INSPIRATION[0]);welcomeArt.classList.add('welcome-art');welcome.append(welcomeArt);
 welcome.append(action('Choose pictured styles',()=>select('pictures')),action('Skip to inspiration',finish),make('p','Original illustrations, not shopping listings. Your opinions stay on this device.','quiet'));
 heading(pictures,'What catches your eye?','Like what feels like you, pass on what doesn’t, or skip any picture. Each opinion is saved and can be changed. These are example outfits, not clothes you own.');
 const pictureCount=make('p','','quiet');pictureCount.setAttribute('role','status');pictures.append(pictureCount);
 const choiceGrid=make('div','','inspiration-grid');pictures.append(choiceGrid);
 const cards=INSPIRATION.map(outfit=>{
  const card=make('article','','inspiration-choice');card.dataset.outfit=outfit.id;card.append(outfitArt(outfit),make('h2',outfit.name));
  const controls=make('div','','picture-actions');const votes=(['like','pass',null] as const).map(label=>{const b=action(label==='like'?'Like':label==='pass'?'Pass':'Skip',()=>host.vote(outfit.id,label));b.setAttribute('aria-pressed','false');controls.append(b);return b;});
  const status=make('p','','quiet');card.append(controls,status);choiceGrid.append(card);return {outfit,card,votes,status};
 });
 pictures.append(action('See inspiration',finish),action('Back to start',()=>select('welcome')));
 heading(inspiration,'A few directions for you','Example outfits to explore. Add pieces you actually own when you’re ready to build a wearable look.');
 const evidence=make('p','','journey-copy');evidence.id='inspiration-evidence';evidence.setAttribute('role','status');const results=make('div','','inspiration-grid');results.id='inspiration-results';inspiration.append(evidence,results,action('Refine pictured choices',()=>select('pictures')),action('Add my own clothes',()=>select('wardrobe')));
 main.prepend(welcome,pictures,inspiration);
 const nav=make('nav','','journey-nav');nav.setAttribute('aria-label','Style workspace');
 const links=new Map<View,HTMLButtonElement>();const more=make('details','','journey-more'),summary=make('summary','More tools');more.append(summary);const extra=make('div','','journey-extra');more.append(extra);nav.append(more);
 for(const [view,label] of [['inspiration','Inspiration'],['pictures','Picture preferences'],['wardrobe','Wardrobe'],['taste','Your taste'],['compose','Build a look'],['ideas','Suggest owned looks'],['saved','Saved looks'],['profile','Profile & backup']] as const){const b=action(label,()=>select(view));links.set(view,b);if(['taste','compose','ideas','saved'].includes(view))extra.append(b);else nav.insertBefore(b,more);}
 const toolbar=make('div','','journey-toolbar'),back=action('Back to inspiration',finish),expand=action('Expand workspace',()=>{initialized=true;expanded=!expanded;sync();focus();});expand.id='workspace-mode';
 toolbar.append(back,expand,find('#undo'),find('#redo'),find('.save-line'));main.prepend(nav,toolbar,find('.message-line'));find('#message').textContent='Your style, kept on this device.';
 const groups:Record<View,HTMLElement[]>={welcome:[welcome],pictures:[pictures],inspiration:[inspiration],wardrobe:[find('#wardrobe')],taste:[find('#taste'),find('#assessment')],compose:[find('#compose')],ideas:[find('#ideas')],saved:[find('#saved')],profile:[profile,hero]};
 find('.site-header nav').hidden=true;
 let current:View='welcome',expanded=false,initialized=false,lastSignature='';
 function focus(){const target=groups[current][0];const heading=target.querySelector<HTMLElement>('h1,h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}window.scrollTo({top:0,behavior:'instant'});}
 function select(view:View){initialized=true;current=view;expanded=false;more.open=false;sync();focus();}
 function finish(){try{localStorage.setItem('style-studio:journey-finished','true');}catch{/* Presentation preference only; profile storage remains authoritative. */}select('inspiration');}
 function sync(){
  if(!initialized&&host.ready()){
   initialized=true;let seen=false;try{seen=localStorage.getItem('style-studio:journey-finished')==='true';}catch{/* Optional presentation preference. */}
   const p=host.project();if(p.pieces.length||p.examples.length||p.looks.length||seen)current='inspiration';
  }
  for(const [view,nodes] of Object.entries(groups))for(const n of nodes)n.hidden=expanded?['welcome','pictures','inspiration'].includes(view):view!==current;
  back.hidden=!expanded&&(current==='welcome'||current==='inspiration');expand.textContent=expanded?'Focus workspace':'Expand workspace';expand.setAttribute('aria-pressed',String(expanded));
  more.hidden=!expanded&&['welcome','pictures'].includes(current);summary.textContent=['taste','compose','ideas','saved'].includes(current)&&!expanded?`More tools · ${links.get(current)!.textContent}`:'More tools';
  for(const id of ['#retry-load','#replace-saved-copy'])find(id).hidden=!expanded&&current!=='profile'&&!host.recovery();
  for(const [view,b] of links){b.hidden=!expanded&&['welcome','pictures'].includes(current)&&view!=='profile';b.setAttribute('aria-pressed',String(!expanded&&view===current));}
  const project=host.project();let count=0;
  for(const {outfit,votes,status} of cards){try{const opinion=picturedOpinion(project,outfit);if(opinion)count++;votes[2].textContent=opinion?'Clear':'Skip';votes.forEach((b,i)=>{b.disabled=!host.ready();b.setAttribute('aria-pressed',String(opinion?.label===(i===0?'like':i===1?'pass':null)));});status.textContent=opinion?`You chose ${opinion.label==='like'?'Like':'Pass'}. Change it any time.`:'No opinion yet.';}catch(error){votes.forEach(b=>{b.disabled=true;});status.textContent=error instanceof Error?error.message:'This opinion is unavailable.';}}
  pictureCount.textContent=`${count} of 12 pictured opinions saved. Skip any; there is no minimum to explore.`;
  const signature=JSON.stringify(project.examples);if(signature!==lastSignature){lastSignature=signature;const suggested=inspirationIdeas(project);results.replaceChildren();
   evidence.textContent=suggested.kind==='learned'?`${suggested.opinions} saved profile labels inform a small fitted model. Scores are provisional taste alignment, not probabilities or fit predictions.`:suggested.kind==='tag-match'?`${suggested.opinions} saved profile labels inform simple tag matching, not a fitted model yet. Shared palette, fit, style and formality guide these starting points; more varied feedback helps.`:'No opinions yet. These are unranked starting points; choose Like or Pass to make them personal.';
   if(project.examples.some(x=>x.caption.includes('illustrative labels, not your preferences')))evidence.textContent+=' This profile includes sample labels, not your preferences. Replace them in Your taste before treating results as personal.';else if(project.examples.length)evidence.textContent+=' Imported labels are used as supplied; only opinions you choose are your own feedback.';
   for(const {outfit,value} of suggested.ideas){const card=make('article','','inspiration-result');card.dataset.outfit=outfit.id;card.append(outfitArt(outfit),make('p','Example outfit · not in your wardrobe','eyebrow'),make('h2',outfit.name),make('p',`${outfit.tags.palette} · ${outfit.tags.fit} · ${outfit.tags.style} · ${outfit.tags.formality}`,'quiet'));if(suggested.kind==='learned')card.append(make('p',`${Math.round(value)} / 100 · provisional alignment`));card.append(action('Choose my opinion',()=>{select('pictures');const target=cards.find(x=>x.outfit.id===outfit.id)!.card;target.scrollIntoView({block:'center'});target.querySelector('button')!.focus();}));results.append(card);}
   if(!suggested.ideas.length)results.append(make('p','You passed on every example. Revisit your choices or add your own references in Your taste.','empty'));
  }
 }
 window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&(expanded||current!=='inspiration')){event.preventDefault();finish();links.get('inspiration')!.focus({preventScroll:true});}});
 // Existing anchor links reveal their target without resetting editor state.
 app.addEventListener('click',event=>{const anchor=(event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');const view=anchor?.getAttribute('href')?.slice(1) as View;if(view in groups){event.preventDefault();select(view);}});
 sync();return {sync};
}
function outfitArt(outfit:Inspiration):SVGSVGElement{
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 300 320');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${outfit.name}: ${outfit.tags.fit} ${outfit.tags.style} outfit illustration, not a photograph`);
 const colors={neutral:['#e6dfce','#434c46'],warm:['#be7654','#705d48'],cool:['#83a8b4','#3b5265'],bright:['#d2ac36','#9a4f67']}[outfit.tags.palette];
 const wide=outfit.tags.fit==='relaxed'?20:outfit.tags.fit==='fitted'?-8:0;
 const part=(name:string,attributes:Record<string,string>)=>{const e=document.createElementNS(svg.namespaceURI,name);for(const [k,v]of Object.entries(attributes))e.setAttribute(k,v);svg.append(e);return e;};
 part('rect',{x:'0',y:'0',width:'300',height:'320',rx:'12',fill:'#f0ede4'});
 part('ellipse',{cx:'150',cy:'294',rx:'94',ry:'10',fill:'#dedbce'});
 part('path',{d:`M${105-wide} 38 130 27Q150 49 170 27L${195+wide} 38 228 85 200 106 186 83 190 161H110L114 83 100 106 72 85Z`,fill:colors[0],stroke:'#4c5149','stroke-width':'2','stroke-linejoin':'round'});
 part('path',{d:`M111 166H189L201 266H163L150 204 137 266H99Z`,fill:colors[1],stroke:'#4c5149','stroke-width':'2','stroke-linejoin':'round'});
 for(const x of [98,163])part('path',{d:`M${x} 272h34l8 8 13 4v12H${x-7}v-13Z`,fill:outfit.tags.style==='sporty'?'#faf8ef':'#5e594e',stroke:'#4c5149','stroke-width':'2'});
 if(outfit.tags.style==='sporty'){for(const y of [76,87])part('path',{d:`M112 ${y}H188`,stroke:'#faf7f1','stroke-width':'7',fill:'none'});}
 if(outfit.tags.style==='playful'){for(const [x,y] of [[132,74],[170,108],[139,139]])part('circle',{cx:String(x),cy:String(y),r:'10',fill:colors[1],opacity:'.7'});}
 if(outfit.tags.formality!=='casual'){part('path',{d:'M130 27 150 47 137 60 127 41M170 27 150 47 163 60 173 41',fill:'#faf7f1',stroke:'#4c5149','stroke-width':'1.5'});part('path',{d:'M150 48V160',stroke:'#4c5149','stroke-width':'1.5',fill:'none'});}
 if(outfit.tags.formality==='formal'){part('path',{d:'M112 56 137 70 128 108 146 158M188 56 163 70 172 108 154 158',stroke:colors[1],'stroke-width':'8',fill:'none'});}
 part('path',{d:'M110 174H190M150 176V202',stroke:'#d8d8cb','stroke-width':'1.5',fill:'none'});
 return svg;
}
