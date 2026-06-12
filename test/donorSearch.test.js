// Unit tests for donorMatchesSearch — the pure predicate behind the campaign
// donor-list search box. It lives in public/js/app.js so it is exercised in
// Node here and reused as a browser global by views/campaign.html.
//
// Regression guard: a confirmed anonymous CARD donation has a null donor_name
// and now appears in public reads (issues #6/#7). The old inline filter called
// `d.donor_name.toLowerCase()` directly, which threw a TypeError on such a row
// and broke the whole donations list the moment a visitor typed in the search
// box. The helper must treat a missing name as the displayed "Anonymous".
const { donorMatchesSearch } = require('../public/js/app');

describe('donorMatchesSearch', () => {
  test('an empty query matches every donation', () => {
    expect(donorMatchesSearch({ donor_name: 'Sara' }, '')).toBe(true);
    expect(donorMatchesSearch({ donor_name: null }, '')).toBe(true);
  });

  test('matches on a case-insensitive substring of the name', () => {
    // The query is already lower-cased by the caller (the search box handler).
    expect(donorMatchesSearch({ donor_name: 'Sara Khan' }, 'khan')).toBe(true);
    expect(donorMatchesSearch({ donor_name: 'Sara Khan' }, 'zzz')).toBe(false);
  });

  test('does NOT throw on a null donor_name (anonymous card donation)', () => {
    expect(() => donorMatchesSearch({ donor_name: null }, 'x')).not.toThrow();
    expect(() => donorMatchesSearch({}, 'x')).not.toThrow();
    expect(() => donorMatchesSearch({ donor_name: undefined }, 'x')).not.toThrow();
  });

  test('a null-named donation matches a search for "anonymous"', () => {
    // It renders as "Anonymous", so searching that term should find it.
    expect(donorMatchesSearch({ donor_name: null }, 'anon')).toBe(true);
    expect(donorMatchesSearch({ donor_name: null }, 'sara')).toBe(false);
  });
});
