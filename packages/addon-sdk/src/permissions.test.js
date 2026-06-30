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

  test('exposes query cache helpers as medium-risk query permissions', () => {
    const query = getPermissionCategory('query');

    expect(query?.functions).toEqual([
      'getClient',
      'invalidateQueries',
      'refetchQueries',
    ]);
    expect(isPermissionRequired('invalidateQueries', 'query')).toBe(true);
    expect(isPermissionRequired('refetchQueries', 'query')).toBe(true);
    expect(getFunctionRiskLevel('invalidateQueries')).toBe('medium');
  });
});
