import {test,expect} from '@playwright/test';

test('extension onboarding is reachable, keyboard usable and makes a truthful practice handoff',async({page,baseURL})=>{
 const external=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==new URL(baseURL).origin){external.push(route.request().url());return route.abort();}return route.continue();});
 await page.goto('/');await page.getByRole('link',{name:'Set up the Chrome extension',exact:true}).click();
 await expect(page).toHaveTitle('Set up Gaze Navigator');await expect(page.getByRole('heading',{level:1})).toHaveText('Your websites. Your way in.');
 const install=page.getByText('Build and load the extension',{exact:true});await install.focus();await page.keyboard.press('Enter');
 await expect(page.locator('#install pre')).toBeVisible();await expect(page.locator('#install')).toContainText('npm run build:extension');
 await expect(page.getByText('This guide cannot detect or install the extension for you.',{exact:true})).toBeVisible();
 await expect(page.locator('#access')).toContainText('optional');await expect(page.locator('#first-task')).toContainText('Turn on for this page');
 await expect(page.locator('#recovery')).toContainText('Check this page again');
 const viewport=page.viewportSize();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
 await page.getByRole('link',{name:'Try built-in practice',exact:true}).click();await expect(page).toHaveTitle(/Home/);await expect(page.locator('#gaze-web-navigator section .status')).toContainText('Ready on');
 expect(external).toEqual([]);expect(errors).toEqual([]);
});

test('setup opens without requesting camera or microphone and preserves the older practice tools',async({page})=>{
 await page.addInitScript(()=>{globalThis.inputRequests=[];navigator.mediaDevices.getUserMedia=async constraints=>{globalThis.inputRequests.push(constraints);throw Error('unexpected device request');};});
 await page.goto('/extension-setup.html');await expect(page.getByRole('heading',{name:'Choose how to give instructions',exact:true})).toBeVisible();
 await page.getByText('Add webcam gaze',{exact:true}).click();await expect(page.locator('#camera')).toContainText('9 calibration dots');
 await page.getByText('Add spoken instructions',{exact:true}).click();await expect(page.locator('#speech')).toContainText('Start listening');
 expect(await page.evaluate(()=>globalThis.inputRequests)).toEqual([]);
 await page.getByRole('link',{name:'Open the dwell and accuracy lab',exact:true}).click();await expect(page.getByRole('button',{name:'Pointer simulation',exact:true})).toBeVisible();await page.getByRole('button',{name:'Pointer simulation',exact:true}).click();await expect(page.locator('#calibration')).toBeVisible();
});
