import {test,expect} from './helpers/expanded-workspace.ts';
for(const width of [1280,390])test(`typing preserves garment Undo and saved complete state at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('/');
 await page.getByRole('button',{name:/^Use the Blank tee template/}).click();
 await page.getByRole('button',{name:'Apply color #b23a2e',exact:true}).click();
 const note=page.locator('#note'),initial=await note.inputValue(),text='A long continuous design note preserves useful garment changes. '.repeat(2);
 await note.focus();await note.pressSequentially(text);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(note).toHaveValue(initial);await expect(page.locator('#part-color')).toHaveValue('#b23a2e');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#part-color')).toHaveValue('#f4f2ec');
 await page.getByRole('button',{name:'Redo',exact:true}).click();await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(note).toHaveValue(initial+text);
 await page.locator('#title').fill('A named garment');await note.focus();await note.press('Control+End');await note.pressSequentially('Later session');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(note).toHaveValue(initial+text);await expect(page.locator('#title')).toHaveValue('A named garment');
 await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('#save-state')).toHaveText('Locally saved');await page.reload();await expect(note).toHaveValue(initial+text+'Later session');await expect(page.locator('#title')).toHaveValue('A named garment');await expect(page.locator('#part-color')).toHaveValue('#b23a2e');
});
