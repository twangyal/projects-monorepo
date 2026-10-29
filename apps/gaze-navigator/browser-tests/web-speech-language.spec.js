import {test,expect} from '@playwright/test';
for(const preference of [
 {primary:'fr-FR',languages:['fr-FR','en-GB'],want:'en-GB'},
 {primary:'ja-JP',languages:['ja-JP'],want:'en-US'},
])test(`English commands configure ${preference.want} under ${preference.primary} browser preferences`,async({page})=>{
 await page.addInitScript(preference=>{
  Object.defineProperty(navigator,'language',{get:()=>preference.primary});Object.defineProperty(navigator,'languages',{get:()=>preference.languages});
  window.__languageSpeech={instances:[],asked:[]};
  window.SpeechRecognition=class{
   static async available(options){window.__languageSpeech.asked.push(options);return 'available';}
   constructor(){window.__languageSpeech.instances.push(this);}start(){this.onstart?.();}abort(){this.onend?.();}
  };
 },preference);
 await page.goto('/practice-site/index.html');const panel=page.locator('#gaze-web-navigator section');
 await panel.getByRole('button',{name:'Start listening',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__languageSpeech.instances.at(-1)?.processLocally)).toBe(true);
 expect(await page.evaluate(()=>({languages:window.__languageSpeech.instances.map(r=>r.lang),asked:window.__languageSpeech.asked}))).toEqual({languages:[preference.want,preference.want],asked:[{langs:[preference.want],processLocally:true}]});
 const catalog=page.getByRole('link',{name:'Catalog',exact:true});await catalog.evaluate(e=>window.scrollTo({top:Math.max(0,e.getBoundingClientRect().top+scrollY-80),behavior:'instant'}));const box=await catalog.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await expect(panel.locator('.context')).toContainText('Link: Catalog');
 await page.evaluate(()=>{const r=window.__languageSpeech.instances.at(-1);r.onspeechstart?.();r.onresult({resultIndex:0,results:[Object.assign([{transcript:'open catalog'}],{isFinal:true})]});});
 await page.waitForURL('**/practice-site/catalog.html');
});
