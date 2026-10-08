import {validateTitle,validateCues,type Project} from './lyrics.ts';

export class UnconfirmedReplyError extends TypeError {
  constructor(){super('Save result is unconfirmed. Your edits are kept. Inspect the saved clip before another deliberate save; nothing was repeated automatically.');this.name='UnconfirmedReplyError';}
}
export async function readReply(response:Response):Promise<unknown>{
  try{return await response.json();}
  catch{if(response.ok)throw new UnconfirmedReplyError();return {};}
}
export function validateProject(value:unknown):Project{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid clip response.');
  const p=value as Record<string,unknown>;
  if(p.schemaVersion!==1||typeof p.id!=='string'||! /^[a-f0-9]{32}$/.test(p.id)||typeof p.duration!=='number'||!Number.isSafeInteger(p.revision)||Number(p.revision)<0)throw new Error('Invalid clip metadata.');
  return {schemaVersion:1,id:p.id,title:validateTitle(p.title),duration:p.duration,revision:p.revision as number,cues:validateCues(p.cues as Project['cues'],p.duration)};
}
export function validateSaveReply(value:unknown,sent:Project):Project{
  try{
    const saved=validateProject(value);
    if(saved.id!==sent.id||saved.duration!==sent.duration||saved.revision!==sent.revision+1||saved.title!==sent.title||JSON.stringify(saved.cues)!==JSON.stringify(sent.cues))throw new Error('Unexpected Save acknowledgment.');
    return saved;
  }catch{throw new UnconfirmedReplyError();}
}
