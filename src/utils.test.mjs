import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { nearlyEqual, firstNumberPx, parseRgba, colorClose } from './utils.mjs';

test('nearlyEqual: within tolerance', () => {
  assert.ok(nearlyEqual(10, 11, 2));
  assert.ok(nearlyEqual(10, 12, 2));
  assert.ok(!nearlyEqual(10, 13, 2));
});

test('firstNumberPx: parses px values', () => {
  assert.equal(firstNumberPx('16px'), 16);
  assert.equal(firstNumberPx('0px'), 0);
  assert.equal(firstNumberPx('normal'), null);
  assert.equal(firstNumberPx(null), null);
});

test('parseRgba: parses rgb and rgba', () => {
  assert.deepEqual(parseRgba('rgb(255, 0, 0)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseRgba('rgba(0,0,0,0.5)'), { r: 0, g: 0, b: 0, a: 0.5 });
  assert.equal(parseRgba('transparent'), null);
});

test('colorClose: matches similar colors', () => {
  assert.ok(colorClose('rgb(255,0,0)', 'rgba(255, 0, 0, 1)'));
  assert.ok(colorClose('rgb(250,0,0)', 'rgba(255, 0, 0, 1)', 8));
  assert.ok(!colorClose('rgb(200,0,0)', 'rgba(255, 0, 0, 1)', 8));
});
