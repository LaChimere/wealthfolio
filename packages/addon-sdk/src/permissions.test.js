import { describe, expect, test } from 'bun:test';

import {
  getFunctionRiskLevel,
  getPermissionCategory,
  isPermissionRequired,
} from './permissions.ts';

describe('addon SDK permissions', () => {
  test('exposes market sync error listener as a low-risk event permission', () => {
    const events = getPermissionCategory('events');

    expect(events?.functions).toContain('onSyncError');
    expect(isPermissionRequired('onSyncError', 'events')).toBe(true);
    expect(getFunctionRiskLevel('onSyncError')).toBe('low');
  });
});
