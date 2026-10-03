import {multiply,groundHit} from './math.js';
import {cameraFromPose} from './model.js';
export async function enterXR(renderer,getProject,getTime,onPlace,onEnd,{signal,onCamera=()=>{},onCameraError=()=>{}}={}){
  const checkCancelled=()=>{if(signal?.aborted)throw Error('VR request cancelled.');};
  checkCancelled();
  if(!globalThis.isSecureContext||!navigator.xr||!await navigator.xr.isSessionSupported('immersive-vr'))throw Error('VR needs a compatible headset and a secure browser connection. Desktop remains available.');
  checkCancelled();
  const session=await navigator.xr.requestSession('immersive-vr',{requiredFeatures:['local-floor']});
  let ended=false,space,viewerSpace,closing;
  const end=()=>{if(ended)return;ended=true;signal?.removeEventListener('abort',cancel);onEnd();};
  const close=()=>{
    if(closing)return closing;
    try{closing=Promise.resolve(session.end()).catch(()=>{});}catch{closing=Promise.resolve();}
    end();return closing;
  };
  const cancel=()=>{void close();};
  session.addEventListener('end',end,{once:true});
  signal?.addEventListener('abort',cancel,{once:true});
  try{
    checkCancelled();
    const gl=renderer.gl;await gl.makeXRCompatible();
    checkCancelled();
    if(ended)throw Error('VR session ended during setup.');
    session.updateRenderState({baseLayer:new XRWebGLLayer(session,gl)});
    space=await session.requestReferenceSpace('local-floor');
    checkCancelled();
    if(ended)throw Error('VR session ended during setup.');
    viewerSpace=await session.requestReferenceSpace('viewer');
    checkCancelled();
    if(ended)throw Error('VR session ended during setup.');
    session.addEventListener('select',event=>{
      if(ended)return;
      const pose=event.frame.getPose(event.inputSource.targetRaySpace,space);if(!pose)return;
      const m=pose.transform.matrix,hit=groundHit([m[12],m[13],m[14]],[-m[8],-m[9],-m[10]]);
      if(hit)onPlace(hit);
    });
    session.addEventListener('squeeze',event=>{
      if(ended)return;
      try{const pose=event.frame.getPose(viewerSpace,space);if(!pose)throw Error('Headset tracking is unavailable. Try again when tracking returns.');onCamera(cameraFromPose(pose.transform.matrix));}
      catch(e){onCameraError(e.message);}
    });
    let started=null;
    const baseTime=getTime();
    const draw=(now,frame)=>{
      if(ended)return;session.requestAnimationFrame(draw);
      if(started===null)started=now;
      const pose=frame.getViewerPose(space);if(!pose)return;
      let marker=null;
      for(const source of session.inputSources){
        const ray=frame.getPose(source.targetRaySpace,space);if(!ray)continue;
        const m=ray.transform.matrix;
        marker=groundHit([m[12],m[13],m[14]],[-m[8],-m[9],-m[10]]);
        if(marker)break;
      }
      const layer=session.renderState.baseLayer;gl.bindFramebuffer(gl.FRAMEBUFFER,layer.framebuffer);
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      for(const view of pose.views){const v=layer.getViewport(view);gl.viewport(v.x,v.y,v.width,v.height);
        renderer.scene(getProject(),baseTime+(now-started)/1000,multiply(view.projectionMatrix,view.transform.inverse.matrix),marker);}
    };
    session.requestAnimationFrame(draw);return session;
  }catch(e){await close();throw e;}
}
