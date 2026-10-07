import { describe, expect, test } from 'vitest';
import { signEmailAction, verifyEmailAction } from './email-token.js';

describe('approval links', () => {
  test('a signed token round-trips and a bad signature does not', () => {
    const token = signEmailAction({ projectId: 'sanctum', itemId: 'ig-1', action: 'approve' }, 'test-secret');
    expect(verifyEmailAction(token, 'test-secret')).toEqual({
      projectId: 'sanctum',
      itemId: 'ig-1',
      action: 'approve',
    });
    expect(verifyEmailAction(token, 'other-secret')).toBeNull();
    expect(verifyEmailAction(`${token}x`, 'test-secret')).toBeNull();
  });
});
