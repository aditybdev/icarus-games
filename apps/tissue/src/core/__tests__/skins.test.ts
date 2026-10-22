import { describe, expect, it } from 'vitest';
import { MEDAL_TARGETS_MS } from '../constants';
import { emptySave, normalizeSave } from '../save';
import { BOX_SKINS, hasMedalAtLeast, resolveSkin, SKIN_PULLS_UNLOCK, skinUnlocked } from '../skins';

describe('box skins data', () => {
  it('every skin has a complete palette and label set', () => {
    expect(BOX_SKINS.length).toBeGreaterThanOrEqual(4);
    for (const skin of BOX_SKINS) {
      expect(skin.label.length).toBeGreaterThan(0);
      expect(skin.sublabel.length).toBeGreaterThan(0);
      expect(skin.bodyTop).not.toBe(skin.bodyBottom);
      expect(skin.slot.length).toBeGreaterThan(0);
      expect(skin.dot).toContain('rgba');
    }
  });
});

describe('skin unlock rules', () => {
  it('classic is always unlocked; unknown indexes never are', () => {
    const save = emptySave();
    expect(skinUnlocked(0, save)).toBe(true);
    expect(skinUnlocked(1, save)).toBe(false);
    expect(skinUnlocked(2, save)).toBe(false);
    expect(skinUnlocked(3, save)).toBe(false);
    expect(skinUnlocked(99, save)).toBe(false);
  });

  it('Breezy unlocks at the lifetime-pulls threshold', () => {
    const under = normalizeSave({ stats: { totalPulled: SKIN_PULLS_UNLOCK - 1 } });
    expect(skinUnlocked(1, under)).toBe(false);
    const at = normalizeSave({ stats: { totalPulled: SKIN_PULLS_UNLOCK } });
    expect(skinUnlocked(1, at)).toBe(true);
  });

  it('Puffy needs any silver medal, Luxe needs any gold', () => {
    const bronze = normalizeSave({ bestMs: { 25: MEDAL_TARGETS_MS[25].bronze } });
    expect(hasMedalAtLeast(bronze, 'bronze')).toBe(true);
    expect(skinUnlocked(2, bronze)).toBe(false);
    expect(skinUnlocked(3, bronze)).toBe(false);

    const silver = normalizeSave({ bestMs: { 50: MEDAL_TARGETS_MS[50].silver } });
    expect(skinUnlocked(2, silver)).toBe(true);
    expect(skinUnlocked(3, silver)).toBe(false);

    const gold = normalizeSave({ bestMs: { 100: MEDAL_TARGETS_MS[100].gold } });
    expect(skinUnlocked(2, gold)).toBe(true); // gold implies silver-or-better
    expect(skinUnlocked(3, gold)).toBe(true);
  });
});

describe('resolveSkin', () => {
  it('keeps a valid unlocked selection and falls back to classic otherwise', () => {
    const save = normalizeSave({ skin: 1, stats: { totalPulled: SKIN_PULLS_UNLOCK } });
    expect(resolveSkin(save)).toBe(1);

    const locked = normalizeSave({ skin: 3 });
    expect(resolveSkin(locked)).toBe(0); // selected but not unlocked

    const bogus = normalizeSave({ skin: 42 });
    expect(resolveSkin(bogus)).toBe(0);
  });
});
