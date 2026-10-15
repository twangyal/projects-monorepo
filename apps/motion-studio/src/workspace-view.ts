type AnimationView = 'draw'|'layers'|'poses'|'drawings'|'projects'|'share'|'export'|'help';
interface WorkspaceHost { canNavigate(): boolean; playing(): boolean; stop(): void }
/** Mounted tool visibility only; editor selection, drafts, history and operation owners stay untouched. */
export function mountAnimationWorkspace(app: HTMLElement, host: WorkspaceHost) {
  const node = (selector:string) => app.querySelector<HTMLElement>(selector)!;
  const main=node('main'), tools=node('.tools'), content=node('.tools .tool-content'), stage=node('#stage-section');
  const children=[...content.children] as HTMLElement[], rules=children.filter(n=>n.classList.contains('rule'));
  const first=children.indexOf(rules[0]),second=children.indexOf(rules[1]);
  function group(nodes:HTMLElement[]) {const box=document.createElement('div');box.className='workspace-tool-group';box.append(...nodes);return box;}
  const drawing=group(children.slice(0,first)), layers=group(children.slice(first+1,second)), projects=group(children.slice(second+1));
  rules.forEach(n=>n.remove());content.append(drawing,layers,projects);projects.append(node('#load-demo'));
  const help=node('.intro');const guide=document.createElement('p');guide.className='hint';guide.textContent='Draw on the stage, set poses at different timeline frames, then preview. Layers manages artwork; Drawings handles held exposures and reviewed in-betweens. Projects saves editable work; Export saves rendered frames or GIF. Raw pose/stroke values stay in memory until you apply or discard them. Navigation keeps the same selected artwork and pending work.';help.append(guide);
  const groups:Record<AnimationView,HTMLElement[]>={draw:[drawing],layers:[layers],poses:[node('.pose-panel')],drawings:[node('#drawing-timeline')],projects:[projects,node('#project-library')],share:[node('#private-links')],export:[node('.export')],help:[help]};
  const studio=node('.studio');studio.prepend(stage);
  const nav=document.createElement('nav');nav.className='workspace-nav';nav.setAttribute('aria-label','Animation workspace');
  const buttons=new Map<AnimationView,HTMLButtonElement>();let current:AnimationView='draw',expanded=false,returnTo:HTMLElement|null=null,navigating=false;
  function control(label:string,action:()=>void){const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',action);return button;}
  for(const [id,label] of [['draw','Draw'],['layers','Layers'],['poses','Poses'],['drawings','Drawings'],['projects','Projects'],['share','Share'],['export','Export'],['help','Help']] as const){const button=control(label,()=>select(id));buttons.set(id,button);nav.append(button);}
  const back=control('Back to canvas',close),mode=control('Expand workspace',()=>{if(!host.canNavigate())return;present(()=>{expanded=!expanded;sync();});});mode.id='workspace-mode';
  const stop=control('Stop animation',()=>host.stop());stop.id='workspace-stop';
  const actions=document.createElement('div');actions.className='workspace-actions';actions.append(back,mode,stop,node('#cancel-export'),node('#export-progress'));main.prepend(nav,actions);
  function present(action:()=>void){navigating=true;try{action();}finally{queueMicrotask(()=>{navigating=false;});}}
  function sync(){
    main.dataset.workspace=current;main.classList.toggle('expanded-workspace',expanded);
    for(const [id,elements] of Object.entries(groups))for(const element of elements)element.hidden=!expanded&&id!==current;
    tools.hidden=!expanded&&!['draw','layers','projects'].includes(current);node('.tools .panel-heading h3').textContent=current==='layers'?'Layers':current==='projects'?'Project settings':'Make your mark';
    for(const [id,button] of buttons)button.setAttribute('aria-pressed',String(!expanded&&id===current));
    mode.textContent=expanded?'Focus workspace':'Expand workspace';mode.setAttribute('aria-pressed',String(expanded));back.hidden=!expanded&&current==='draw';stop.hidden=!host.playing();
  }
  function select(view:AnimationView){if(!host.canNavigate())return;present(()=>{if(current==='draw'&&view!=='draw')returnTo=document.activeElement instanceof HTMLElement?document.activeElement:null;current=view;expanded=false;sync();const target=view==='draw'?stage:groups[view][0];window.scrollTo({top:Math.max(0,target.getBoundingClientRect().top+window.scrollY-80),behavior:'instant'});});}
  function close(){if(!host.canNavigate())return;present(()=>{current='draw';expanded=false;sync();const target=returnTo?.isConnected&&returnTo.getClientRects().length?returnTo:buttons.get('draw')!;target.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});});}
  window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&(expanded||current!=='draw')){event.preventDefault();close();}});
  sync();
  return {sync,get navigating(){return navigating;},isControl(target:Element|null){return !!target&&(nav.contains(target)||actions.contains(target));}};
}
