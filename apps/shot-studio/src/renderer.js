import {multiply,lookAt,perspective,modelMatrix} from './math.js';
import {performerAt} from './model.js';

const VERTEX=`attribute vec3 position;attribute vec3 normal;uniform mat4 model;uniform mat4 viewProjection;varying vec3 n;void main(){n=mat3(model)*normal;gl_Position=viewProjection*model*vec4(position,1.0);}`;
const FRAGMENT=`precision mediump float;varying vec3 n;uniform vec3 color;uniform float light;void main(){float diffuse=max(dot(normalize(n),normalize(vec3(-.4,1.,.6))),0.);gl_FragColor=vec4(color*(.28+diffuse*.72)*light,1.);}`;
function shader(gl,type,source){
  const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){gl.deleteShader(s);throw Error('Could not compile the stage renderer.');}return s;
}
function cube(){
  const verts=[];
  for(const [axis,sign] of [[0,1],[0,-1],[1,1],[1,-1],[2,1],[2,-1]]){
    const a=(axis+1)%3,b=(axis+2)%3,points=[];
    for(const [u,v] of [[-1,-1],[1,-1],[1,1],[-1,1]]){const p=[0,0,0];p[axis]=sign*.5;p[a]=u*.5;p[b]=v*.5;points.push(p);}
    for(const i of [0,1,2,0,2,3]){const n=[0,0,0];n[axis]=sign;verts.push(...points[i],...n);}
  }return new Float32Array(verts);
}
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
export class StageRenderer{
  constructor(canvas){
    this.canvas=canvas;this.gl=canvas.getContext('webgl',{antialias:true,preserveDrawingBuffer:true,xrCompatible:true});
    const gl=this.gl;if(!gl)throw Error('WebGL is unavailable. Try a browser with hardware or software WebGL enabled.');
    const program=gl.createProgram(),vs=shader(gl,gl.VERTEX_SHADER,VERTEX),fs=shader(gl,gl.FRAGMENT_SHADER,FRAGMENT);
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Could not link stage renderer.');
    this.program=program;this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,cube(),gl.STATIC_DRAW);
    gl.useProgram(program);
    for(const [name,offset] of [['position',0],['normal',12]]){const loc=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,24,offset);}
    this.uniforms=Object.fromEntries(['model','viewProjection','color','light'].map(name=>[name,gl.getUniformLocation(program,name)]));
    gl.enable(gl.DEPTH_TEST);gl.clearColor(.07,.10,.13,1);
  }
  draw(project,time,camera){
    const gl=this.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    this.scene(project,time,multiply(perspective(camera.fov,this.canvas.width/this.canvas.height,.1,100),lookAt(camera.eye,camera.target)));
  }
  scene(p,time,viewProjection,marker=null){
    const gl=this.gl,u=this.uniforms;gl.useProgram(this.program);gl.uniformMatrix4fv(u.viewProjection,false,viewProjection);gl.uniform1f(u.light,p.light);
    const box=(x,y,z,sx,sy,sz,color,roll=0)=>{gl.uniformMatrix4fv(u.model,false,modelMatrix(x,y,z,sx,sy,sz,roll));gl.uniform3fv(u.color,rgb(color));gl.drawArrays(gl.TRIANGLES,0,36);};
    box(0,-.15,0,10,.3,10,'#b6a18b');
    if(marker)box(marker[0],.02,marker[1],.25,.04,.25,'#f9e0a1');
    box(0,1.8,-4.5,10,3.6,.3,'#63786d');
    for(const x of [-3.8,3.8]){box(x,1.2,-2.8,.55,2.4,.55,'#d3b392');box(x,2.5,-2.8,.85,.2,.85,'#e2ccac');}
    box(0,.4,-3,2.8,.8,.7,'#a07860');box(0,.9,-3,3,.15,.9,'#ccb49b');
    for(const x of [-2.4,2.4]){box(x,.5,2.2,.8,1,.8,'#777d61');box(x,1.1,2.2,1.1,.4,1.1,'#799a6e');}
    for(let index=0;index<p.actors.length;index++){
      const a=p.actors[index],pose=performerAt(p,index,time);
      if(!pose.visible)continue;
      const x=pose.x,z=pose.z;
      box(x,1.15,z,.5,.65,.32,a.color);box(x,1.7,z,.4,.4,.4,'#ead0ab');
      box(x-.16,.43,z,.17,.72,.22,'#28394a',pose.leg);box(x+.16,.43,z,.17,.72,.22,'#28394a',-pose.leg);
      box(x-.4,1.13,z,.15,.65,.2,a.color,pose.arm);box(x+.4,1.13,z,.15,.65,.2,a.color,-pose.arm);
      box(x-.11,1.73,z+.21,.045,.05,.025,'#26323c');box(x+.11,1.73,z+.21,.045,.05,.025,'#26323c');
    }
  }
  dispose(){this.gl.deleteBuffer(this.buffer);this.gl.deleteProgram(this.program);}
}
