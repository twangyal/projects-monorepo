import {test as base,type Page,type Browser,type BrowserContext} from '@playwright/test';
export * from '@playwright/test';
/** Existing feature gates enter the real product's expanded view; focused flows have separate gates. */
export async function expandTools(page:Page):Promise<void>{
 if(new URL(page.url()).pathname!=='/')return;
 const mode=page.locator('#workspace-mode');await mode.waitFor({state:'visible'});
 if(await mode.getAttribute('aria-pressed')==='false')await mode.click();
}
const pages=new WeakSet<Page>();
export function expandedPage(page:Page):void{
 if(pages.has(page))return;pages.add(page);
 const goto=page.goto.bind(page),reload=page.reload.bind(page);
 page.goto=async(...args:Parameters<Page['goto']>)=>{const response=await goto(...args);await expandTools(page);return response;};
 page.reload=async(...args:Parameters<Page['reload']>)=>{const response=await reload(...args);await expandTools(page);return response;};
}
export function expandedContext(context:BrowserContext):void{context.on('page',expandedPage);for(const page of context.pages())expandedPage(page);}
const browsers=new WeakSet<Browser>();
export function expandedBrowser(browser:Browser):void{if(browsers.has(browser))return;browsers.add(browser);const create=browser.newContext.bind(browser);browser.newContext=async(...args:Parameters<Browser['newContext']>)=>{const context=await create(...args);expandedContext(context);return context;};}
export const test=base.extend({browser:async({browser},use)=>{expandedBrowser(browser);await use(browser);},context:async({context},use)=>{
 expandedContext(context);await use(context);
}});
