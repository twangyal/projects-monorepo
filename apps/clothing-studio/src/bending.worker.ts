import {compareBending} from './bending.ts';
import type {TensileInput} from './tensile.ts';
self.onmessage=(event:MessageEvent<TensileInput>)=>{try{self.postMessage({ok:true,receipt:compareBending(event.data)});}catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:'Bending comparison failed.'});}};
