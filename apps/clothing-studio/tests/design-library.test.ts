import assert from 'node:assert/strict';
import test from 'node:test';
import {validateDesignName,validateDesignReceipt} from '../src/design-library.ts';

test('design names trim outer whitespace while preserving literal Unicode and printable interior spaces',()=>{
 assert.equal(validateDesignName('  Navy 🌓  tee  '),'Navy 🌓  tee');
 assert.equal(validateDesignName('x'.repeat(80)).length,80);
 for(const value of ['', ' ', 'x'.repeat(81),'one\nother','bad\u0000','bad\u007f',42,null])assert.throws(()=>validateDesignName(value));
});
test('saved-design metadata is detached and exact bounded without unsafe fields',()=>{
 const receipt={id:'00000000-0000-4000-8000-000000000001',name:'Navy',savedAt:'2026-10-20T18:00:00.000Z',bytes:6*1024*1024};
 const safe=validateDesignReceipt(receipt);assert.deepEqual(safe,receipt);safe.name='Changed';assert.equal(receipt.name,'Navy');
 for(const value of [{...receipt,id:'../current'},{...receipt,savedAt:'yesterday'},{...receipt,savedAt:'2026-02-31T00:00:00.000Z'}, {...receipt,bytes:0},{...receipt,bytes:6*1024*1024+1},{...receipt,bytes:1.5},{...receipt,extra:1},{...receipt,name:' Navy '},null,[]])assert.throws(()=>validateDesignReceipt(value));
});
