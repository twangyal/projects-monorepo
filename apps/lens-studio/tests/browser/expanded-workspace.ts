import {test as base,type Page} from '@playwright/test';
export * from '@playwright/test';
/** Existing feature gates enter the real product's expanded view; focused flows have separate gates. */
export async function expandTools(page:Page):Promise<void>{
 if(new URL(page.url()).pathname!=='/')return;
 const mode=page.locator('#workspace-mode');await mode.waitFor({state:'visible'});
 if(await mode.getAttribute('aria-pressed')==='false')await mode.click();
}
export function expandedPage(page:Page):void{
 const goto=page.goto.bind(page),reload=page.reload.bind(page);
 page.goto=async(...args:Parameters<Page['goto']>)=>{const response=await goto(...args);await expandTools(page);return response;};
 page.reload=async(...args:Parameters<Page['reload']>)=>{const response=await reload(...args);await expandTools(page);return response;};
}
export const test=base.extend({context:async({context},use)=>{
 context.on('page',expandedPage);for(const page of context.pages())expandedPage(page);await use(context);
}});
