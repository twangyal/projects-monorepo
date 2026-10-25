export function installTerminalObserver() {
 type Entry=Record<string,unknown>;
 const state:{events:Entry[];overflow:boolean}={events:[],overflow:false};
 Object.defineProperty(window,'terminal300',{value:state});
 const contexts=new Map<BaseAudioContext,number>();
 const add=(event:Entry)=>{if(state.events.length>=128){state.overflow=true;return;}state.events.push({sequence:state.events.length,wallMs:performance.now(),...event});};
 const contextId=(context:BaseAudioContext)=>{let id=contexts.get(context);if(id===undefined){id=contexts.size;contexts.set(context,id);const current=id;add({kind:'context',contextId:current,state:context.state,audioTime:context.currentTime});context.addEventListener('statechange',()=>add({kind:'context',contextId:current,state:context.state,audioTime:context.currentTime}));}return id;};
 const start=AudioBufferSourceNode.prototype.start;
 AudioBufferSourceNode.prototype.start=function(...args:Parameters<AudioBufferSourceNode['start']>){add({kind:'source-start',contextId:contextId(this.context),audioTime:this.context.currentTime,frames:this.buffer?.length??0,when:args[0]??this.context.currentTime});return Reflect.apply(start,this,args);};
 const Native=AudioWorkletNode;
 window.AudioWorkletNode=class extends Native {
  constructor(context:BaseAudioContext,name:string,options?:AudioWorkletNodeOptions){
   super(context,name,options);const id=contextId(context);let terminal=false;const phases=new Set<string>();
   this.port.addEventListener('message',(event:MessageEvent)=>{
    const data=event.data as Record<string,unknown>;
    if(data?.type==='terminal-clock-research300'){event.stopImmediatePropagation();if(terminal){state.overflow=true;return;}terminal=true;add({kind:'terminal',contextId:id,audioTime:context.currentTime,data});return;}
    if(['ready','armed','error','complete'].includes(String(data?.type)))add({kind:'incoming',contextId:id,audioTime:context.currentTime,data:data.type==='complete'?{type:'complete',frames:(data.samples as Float32Array).length}:data});
    if(data?.type==='progress'&&!phases.has(String(data.phase))){phases.add(String(data.phase));add({kind:'phase',contextId:id,audioTime:context.currentTime,phase:data.phase,framesCaptured:data.framesCaptured});}
   });
   this.port.start();const post=this.port.postMessage.bind(this.port);
   this.port.postMessage=(message:unknown)=>{const data=message as Record<string,unknown>;add({kind:'outgoing',contextId:id,audioTime:context.currentTime,data});post(message);};
  }
 };
}
