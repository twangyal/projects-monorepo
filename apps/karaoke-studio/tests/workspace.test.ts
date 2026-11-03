import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTool, TOOLS } from '../src/workspace.ts';

test('the tool tabs move with the arrow keys, wrapping at the ends, and jump with Home and End', () => {
  assert.deepEqual([...TOOLS], ['song', 'lyrics', 'get', 'timing', 'practice', 'export']);
  assert.equal(nextTool('song', 'ArrowRight'), 'lyrics');
  assert.equal(nextTool('export', 'ArrowRight'), 'song');
  assert.equal(nextTool('song', 'ArrowLeft'), 'export');
  assert.equal(nextTool('timing', 'ArrowLeft'), 'get');
  assert.equal(nextTool('practice', 'Home'), 'song');
  assert.equal(nextTool('lyrics', 'End'), 'export');
  assert.equal(nextTool('lyrics', 'Enter'), null);
  assert.equal(nextTool('lyrics', 'ArrowDown'), null);
});
