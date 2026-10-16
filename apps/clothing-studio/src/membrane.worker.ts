import {compareMembrane,type MembraneInput} from './membrane.ts';
self.onmessage=(event:MessageEvent<MembraneInput>)=>{try{self.postMessage({ok:true,receipt:compareMembrane(event.data)});}catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:'Membrane comparison unavailable.'});}};
