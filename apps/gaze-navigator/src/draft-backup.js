export const MAX_BACKUP_BYTES=2*1024*1024;
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export function validateBackupDrafts(rows){
 if(!Array.isArray(rows)||rows.length<1||rows.length>20)throw Error('A backup must contain 1 to 20 drafts.');
 return rows.map(row=>{
  if(!exact(row,['subject','body'])||typeof row.subject!=='string'||typeof row.body!=='string'||row.subject.length>200||row.body.length>10000||!row.subject.trim())throw Error('Invalid draft: use a text subject up to 200 characters and a message up to 10000 characters.');
  return{subject:row.subject,body:row.body};
 });
}
export function encodeDraftBackup(rows){
 const text=JSON.stringify({format:'gaze-session-drafts',version:1,drafts:validateBackupDrafts(rows)},null,2)+'\n';
 if(new TextEncoder().encode(text).length>MAX_BACKUP_BYTES)throw Error('Draft backups are limited to 2 MiB.');return text;
}
export function parseDraftBackup(text){
 if(typeof text!=='string'||text.length>MAX_BACKUP_BYTES||new TextEncoder().encode(text).length>MAX_BACKUP_BYTES)throw Error('Draft backups are limited to 2 MiB.');
 let value;try{value=JSON.parse(text);}catch{throw Error('Choose a valid draft backup JSON file.');}
 if(!exact(value,['format','version','drafts'])||value.format!=='gaze-session-drafts'||value.version!==1)throw Error('Unsupported draft backup format or version.');
 return validateBackupDrafts(value.drafts);
}
