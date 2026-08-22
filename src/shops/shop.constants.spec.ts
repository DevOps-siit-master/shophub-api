import {
  AVAILABILITIES,
  DATABASE_TYPES,
  ownerHash,
  replicasFor,
  shopName,
  slugify,
} from './shop.constants';

describe('shop.constants', () => {
  describe('replicasFor', () => {
    it('maps high to 3 and standard to 2', () => {
      expect(replicasFor('high')).toBe(3);
      expect(replicasFor('standard')).toBe(2);
    });
  });

  describe('ownerHash', () => {
    it('is deterministic and a 10-char hex string', () => {
      expect(ownerHash('user-1')).toBe(ownerHash('user-1'));
      expect(ownerHash('user-1')).toMatch(/^[0-9a-f]{10}$/);
    });

    it('differs for different users', () => {
      expect(ownerHash('user-1')).not.toBe(ownerHash('user-2'));
    });
  });

  describe('slugify', () => {
    it('lowercases and collapses non-alphanumerics into single dashes', () => {
      expect(slugify('Healthy Food')).toBe('healthy-food');
      expect(slugify('Clothes & Shoes!')).toBe('clothes-shoes');
    });

    it('trims leading and trailing separators', () => {
      expect(slugify('  --Fresh--  ')).toBe('fresh');
    });

    it('caps length at 30 chars with no trailing dash', () => {
      const slug = slugify('a'.repeat(40));
      expect(slug.length).toBeLessThanOrEqual(30);
      expect(slug.endsWith('-')).toBe(false);
    });

    it('falls back to "shop" when nothing usable survives', () => {
      expect(slugify('!!!')).toBe('shop');
      expect(slugify('')).toBe('shop');
    });
  });

  describe('shopName', () => {
    it('combines the slug and the owner hash', () => {
      expect(shopName('Healthy Food', 'user-1')).toBe(
        `healthy-food-${ownerHash('user-1')}`,
      );
    });

    it('keeps names unique across users who pick the same shop name', () => {
      expect(shopName('Shop', 'user-1')).not.toBe(shopName('Shop', 'user-2'));
    });

    it('produces a DNS-1123 label', () => {
      expect(shopName('Wild + Name!!', 'user-1')).toMatch(
        /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/,
      );
    });
  });

  describe('catalog constants', () => {
    it('expose the supported enum values', () => {
      expect(AVAILABILITIES).toEqual(['standard', 'high']);
      expect(DATABASE_TYPES).toEqual(['standard', 'light']);
    });
  });
});
