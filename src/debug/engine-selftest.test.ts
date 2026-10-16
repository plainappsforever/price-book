/** @jest-environment node */
import { runEngineSelfTest } from './engine-selftest';

it('the About self-test passes on Node (the device run proves Hermes)', () => {
  const checks = runEngineSelfTest();
  expect(checks.filter((c) => !c.ok)).toEqual([]);
  expect(checks.length).toBe(6);
});
