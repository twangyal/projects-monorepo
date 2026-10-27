import test from 'node:test';import assert from 'node:assert/strict';
import {interpret} from '../src/web/interpreter.js';
import {createController} from '../src/web/controller.js';
const context={elements:[{id:1,name:'Delete page',role:'button',consequential:true,element:{isConnected:true}}]};
test('circle resizing requires explicit navigator intent and leaves dictation and website names alone',()=>{
 for(const [said,size]of [['make the circle bigger','larger'],['make circle smaller','smaller'],['use a small circle','small'],['use a medium gaze circle please','medium'],['set the circle to large','large']])assert.deepEqual(interpret(said,{elements:[]}),{type:'circle-size',size});
 assert.equal(interpret('type make the circle bigger',{elements:[{id:1,name:'Message',role:'textbox',editable:true,focused:true}],focusedId:1}).type,'edit');
 assert.notEqual(interpret('I think the circle is bigger',{elements:[]}).type,'circle-size');
 assert.equal(interpret('open small circle',{elements:[{id:1,name:'Small circle',role:'link'}]}).type,'activate');
});
test('circle size is delegated while paused and retires pending targets without page actions',()=>{
 const sizes=[],clicks=[];const controller=createController({window:{},actions:{activate:()=>{clicks.push(1);return {ok:true,message:'Clicked'};}},commands:{circleSize:size=>{sizes.push(size);return {ok:true,message:`Circle ${size}`};}}});
 controller.handle('click delete page',context);assert.equal(controller.pending.kind,'confirm');
 assert.equal(controller.handle('make the circle bigger',context).message,'Circle larger');assert.equal(controller.pending,null);
 controller.handle('confirm',context);assert.deepEqual(clicks,[]);
 controller.handle('pause',context);controller.handle('use a small circle',context);assert.equal(controller.paused,true);assert.deepEqual(sizes,['larger','small']);
 assert.equal(createController({window:{}}).handle('use a large circle',{elements:[]}).tone,'error');
});
