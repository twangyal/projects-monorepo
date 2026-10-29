import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpeechInput} from '../src/web/speech-input.js';
for(const [name,navigator,want] of [
 ['primary English',{language:'en-GB',languages:['en-GB','en-US']},'en-GB'],
 ['secondary English',{language:'de-DE',languages:['de-DE','en-AU','en-GB']},'en-AU'],
 ['no English preference',{language:'ja-JP',languages:['ja-JP']},'en-US'],
 ['missing preferences',undefined,'en-US'],
 ['generic English',{language:'en',languages:['en']},'en'],
])test(`English command recognition uses ${name}`,()=>{
 const instances=[];class Recognition{constructor(){instances.push(this);}start(){this.onstart?.();}abort(){this.onend?.();}}
 const speech=createSpeechInput({navigator,SpeechRecognition:Recognition},{});speech.start();
 assert.equal(instances[0].lang,want);speech.stop();
});
test('availability installation and restarted recognition keep the same chosen English locale',async()=>{
 const navigator={language:'fr-FR',languages:['fr-FR','en-GB']},asked=[],installed=[],instances=[];
 class Recognition{
  static async available(options){asked.push(options);return 'downloadable';}
  static async install(options){installed.push(options);return true;}
  constructor(){instances.push(this);}start(){this.onstart?.();}abort(){this.onend?.();}
 }
 const speech=createSpeechInput({navigator,SpeechRecognition:Recognition},{});speech.start();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(instances[0].lang,'en-GB');assert.deepEqual(asked,[{langs:['en-GB'],processLocally:true}]);
 navigator.language='ja-JP';navigator.languages=['ja-JP','en-US'];
 assert.equal(await speech.installLocal(),true);assert.deepEqual(installed,[{langs:['en-GB'],processLocally:true}]);
 assert.equal(instances.at(-1).processLocally,true);assert.equal(instances.at(-1).lang,'en-GB');
 speech.stop();speech.start();assert.equal(instances.at(-1).lang,'en-GB');speech.stop();
});
