import { test, expect } from 'bun:test';
import { animationsEnabled } from '../src/settings';

test('animation choice overrides reduced motion, while the default follows the device', () => {
  expect(animationsEnabled(null, true)).toBe(false);
  expect(animationsEnabled(null, false)).toBe(true);
  expect(animationsEnabled('on', true)).toBe(true);
  expect(animationsEnabled('on', false)).toBe(true);
  expect(animationsEnabled('off', true)).toBe(false);
  expect(animationsEnabled('off', false)).toBe(false);
});
