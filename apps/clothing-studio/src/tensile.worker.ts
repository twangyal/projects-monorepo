import {compareTensile,type TensileInput} from './tensile.ts';
self.onmessage=(event:MessageEvent<TensileInput>)=>{try{self.postMessage({ok:true,receipt:compareTensile(event.data)});}catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:'Coupon comparison failed.'});}};
