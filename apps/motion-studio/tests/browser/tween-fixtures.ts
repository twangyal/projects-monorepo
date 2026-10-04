// Original endpoint artwork and closed-form expectations, authored before producer inspection.
export interface Point {x:number;y:number}
export interface Stroke {color:string;width:number;points:Point[]}
export interface Cel {frame:number;strokes:Stroke[]}
export interface Key {frame:number;x:number;y:number;scale:number;rotation:number;opacity:number;easing:'linear'}
export interface Layer {id:string;name:string;kind:'drawing';keys:Key[];cels:Cel[]}
export interface Film {schemaVersion:2;title:string;background:string;frameCount:number;layers:Layer[]}
const key=(frame:number,x:number,y:number):Key=>({frame,x,y,scale:1,rotation:0,opacity:1,easing:'linear'});
export function endpoints():Film{return{schemaVersion:2,title:'Original geometric study',background:'#ffffff',frameCount:12,layers:[
  {id:'paired',name:'Original paired strokes',kind:'drawing',keys:[key(0,250,180),key(8,330,180)],cels:[
    {frame:0,strokes:[{color:'#FF0000',width:20,points:[{x:-100,y:-40},{x:-20,y:-40}]},{color:'#00ff00',width:16,points:[{x:0,y:-80}]}]},
    {frame:8,strokes:[{color:'#00ff00',width:16,points:[{x:0,y:-40}]},{color:'#0000FF',width:20,points:[{x:100,y:40},{x:20,y:40}]}]},
  ]},
  {id:'control',name:'Fixed green control',kind:'drawing',keys:[key(0,50,50)],cels:[{frame:0,strokes:[{color:'#00ff00',width:20,points:[{x:0,y:0}]}]}]},
]};}
// Correct explicit mapping is start0→end1 reversed, start1→end0. No producer helper.
export function applied():Film{const p=endpoints();for(const frame of [2,4,6]){const t=frame/8;p.layers[0].cels.push({frame,strokes:[
  {color:`#${Math.round(255*(1-t)).toString(16).padStart(2,'0')}00${Math.round(255*t).toString(16).padStart(2,'0')}`,width:20,points:Array.from({length:64},(_,i)=>({x:(1-t)*(-100+80*i/63)+t*(20+80*i/63),y:-40+80*t}))},
  {color:'#00ff00',width:16,points:Array.from({length:64},()=>({x:0,y:-80+40*t}))},
]});}p.layers[0].cels.sort((a,b)=>a.frame-b.frame);return p;}
export function coreAt(frame:number){const held=frame<2?0:frame<4?2:frame<6?4:frame<8?6:8;const t=held/8;const pose=250+10*Math.min(frame,8);return{line:{x:pose-60+120*t,y:140+80*t,rgb:[Math.round(255*(1-t)),0,Math.round(255*t)]},dot:{x:pose,y:100+40*t,rgb:[0,255,0]},control:{x:50,y:50,rgb:[0,255,0]}};}
