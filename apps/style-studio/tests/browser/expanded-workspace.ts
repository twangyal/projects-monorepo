import {test as base,type Page,type BrowserContext,type Browser} from '@playwright/test';
export * from '@playwright/test';
/** Existing editor acceptance uses the actual expanded product view, with original assertions intact. */
const pages=new WeakSet<Page>();
export function expandedPage(page:Page){if(pages.has(page))return;pages.add(page);const goto=page.goto.bind(page),reload=page.reload.bind(page);
 const expand=async()=>{if(new URL(page.url()).pathname!=='/')return;const mode=page.locator('#workspace-mode');await mode.waitFor({state:'visible'});if(await mode.getAttribute('aria-pressed')==='false')await mode.click();};
 page.goto=async(...args:Parameters<Page['goto']>)=>{const r=await goto(...args);await expand();return r;};page.reload=async(...args:Parameters<Page['reload']>)=>{const r=await reload(...args);await expand();return r;};}
function contextPages(context:BrowserContext){context.on('page',expandedPage);for(const page of context.pages())expandedPage(page);}
const browsers=new WeakSet<Browser>();
export const test=base.extend({browser:async({browser},use)=>{if(!browsers.has(browser)){browsers.add(browser);const create=browser.newContext.bind(browser);browser.newContext=async(...args:Parameters<Browser['newContext']>)=>{const c=await create(...args);contextPages(c);return c;};}await use(browser);},context:async({context},use)=>{contextPages(context);await use(context);}});
