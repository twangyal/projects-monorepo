import {test,expect} from './helpers/expanded-workspace.ts';
import {readFile} from 'node:fs/promises';
test('a product skirt shares styling, applied measurements, history, saved reload and exports',async({page})=>{
  test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/'); const editor=page.locator('#product-editor');
  await editor.getByRole('button',{name:/^Use the Flared skirt template/}).click();
  await expect(editor.locator('#product-status')).toContainText('Editing Flared skirt');
  await expect(editor.getByRole('radiogroup',{name:'Garment parts'}).getByRole('radio')).toHaveCount(2);
  await expect(editor.locator('#garment-drape-on')).toBeDisabled();
  await editor.locator('#product-skirt-waist').fill('90');
  await editor.locator('#product-skirt-hem').fill('190');
  await editor.locator('#product-skirt-slant').fill('65');
  const shape=editor.locator('[data-piece=front] polygon');const before=await shape.getAttribute('points');
  await editor.getByRole('radio',{name:'Back body',exact:true}).check();
  await expect(editor.locator('#product-skirt-waist')).toHaveValue('90');
  await expect(shape).toHaveAttribute('points',before!);
  await editor.locator('#apply-measurements').click();
  await expect(editor.locator('#techpack-preview')).toContainText('190');
  await expect(shape).not.toHaveAttribute('points',before!);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(editor.locator('#product-skirt-waist')).toHaveValue('80');
  await page.getByRole('button',{name:'Redo',exact:true}).click();
  await expect(editor.locator('#product-skirt-waist')).toHaveValue('90');
  await editor.getByRole('button',{name:'Apply Denim twill',exact:true}).click();
  await editor.getByRole('button',{name:'Apply Gingham check print',exact:true}).click();
  const backup=async()=>{const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Export project backup',exact:true}).click();return JSON.parse(await readFile((await(await wait).path())!,'utf8'));};
  const saved=await backup();expect(saved.product.base).toBe('skirt');expect(saved.product.measurements).toEqual({waist:90,hem:190,slant:65});expect(saved.product.parts.back.material).toBe('denim-340');expect(saved.product.parts.front.print).toBeNull();
  await editor.locator('#product-skirt-hem').fill('91');await editor.locator('#apply-measurements').click();
  await expect(editor.locator('#product-draft-state')).toContainText('Unapplied');
  await editor.locator('#discard-product-drafts').click();expect((await backup()).product).toEqual(saved.product);
  // Autosave persists committed fields and styles; native downloads contain real geometry and measured patterns.
  await expect.poll(()=>page.locator('#save-state').textContent()).toMatch(/saved/i);
  await page.reload();await expect(editor.locator('#product-status')).toContainText('Editing Flared skirt');
  expect((await backup()).product).toEqual(saved.product);
  for(const [id,match] of [['#pattern-svg',/Waist|Flared skirt/],['#product-glb',null]] as const){
    const button=editor.locator(id);const wait=page.waitForEvent('download');await button.click();const bytes=await readFile((await(await wait).path())!);if(match)expect(bytes.toString()).toMatch(match);else {expect(bytes.subarray(0,4).toString()).toBe('glTF');expect(bytes.length).toBeGreaterThan(1000);}
  }
  expect(errors).toEqual([]);
});
