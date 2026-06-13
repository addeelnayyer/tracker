// Unit tests for paymentLandingState — the pure helper that maps the Safepay
// redirect `?payment=` return param to a donor-facing landing banner (issue #7).
// It carries no DOM/browser dependency, so it is exercised directly in Node;
// the browser uses the same function as a global from public/js/app.js.
const { paymentLandingState } = require('../public/js/app');

describe('paymentLandingState', () => {
  test('returns null when there is no payment param', () => {
    expect(paymentLandingState(null)).toBeNull();
    expect(paymentLandingState(undefined)).toBeNull();
    expect(paymentLandingState('')).toBeNull();
  });

  test('returns null for an unrecognised param', () => {
    expect(paymentLandingState('bananas')).toBeNull();
  });

  test('success is a PENDING-AWARE confirmation, not a "confirmed" claim', () => {
    const state = paymentLandingState('success');
    expect(state).not.toBeNull();
    expect(state.type).toBe('success');
    expect(state.title).toBeTruthy();
    expect(state.message).toBeTruthy();
    // Must not assert the donation is already confirmed — the webhook may not
    // have landed yet. It should speak to "received / confirming".
    expect(state.message.toLowerCase()).toMatch(/confirm|received|process/);
    expect(state.message.toLowerCase()).not.toMatch(/\bconfirmed\b/);
  });

  test('cancelled tells the donor clearly they were not charged', () => {
    const state = paymentLandingState('cancelled');
    expect(state).not.toBeNull();
    expect(state.type).toBe('error');
    expect(state.title).toBeTruthy();
    expect(state.message.toLowerCase()).toMatch(/not.*charg|no.*charg|didn|did not/);
  });

  test('failed is treated like cancelled — a clear "did not go through" message', () => {
    const state = paymentLandingState('failed');
    expect(state).not.toBeNull();
    expect(state.type).toBe('error');
    expect(state.message.toLowerCase()).toMatch(/not.*charg|no.*charg|didn|did not/);
  });
});
