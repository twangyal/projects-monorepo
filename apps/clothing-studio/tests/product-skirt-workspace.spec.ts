import {test,expect} from '@playwright/test';
for(const viewport of [{width:1280,height:900},{width:390,height:740}])test(`skirt template works in the focused workspace at ${viewport.width}px`,async({page})=>{
  await page.setViewportSize(viewport);await page.goto('/');
  await page.getByRole('button',{name:'Templates',exact:true}).click();
  await page.getByRole('button',{name:/^Use the Flared skirt template/}).click();
  await page.getByRole('button',{name:'Patterns & measurements',exact:true}).click();
  await expect(page.getByLabel('Skirt waist (cm)',{exact:true})).toBeVisible();
  await expect(page.locator('#top-measures')).toBeHidden();await expect(page.locator('#leg-measures')).toBeHidden();
  await expect(page.locator('#leg-modules')).toBeHidden();
  await page.getByLabel('Skirt side seam slant (cm)',{exact:true}).fill('70');
  await page.getByRole('button',{name:'Apply measurements',exact:true}).click();
  await page.getByRole('button',{name:'Materials & prints',exact:true}).click();
  await page.getByRole('radio',{name:'Back body',exact:true}).check();
  await page.getByRole('button',{name:'Apply color #b23a2e',exact:true}).click();
  await page.getByRole('button',{name:'Back to garment',exact:true}).click();
  await expect(page.locator('#product-canvas')).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#product-canvas').screenshot({path:`/tmp/clothing343-skirt-${viewport.width}.png`});
});
