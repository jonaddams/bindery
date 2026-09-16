// @vitest-environment node

/**
 * The product name is used in more than one place and all of them must agree.
 *
 * This is the same concern `lib/a2p-filing.test.ts` exists for, one level up:
 * that file pins what is filed with the campaign, and this one pins that the
 * app has a single notion of its own name rather than several copies that can
 * drift. The browser title said "Nutrient API CRUD App" for months while every
 * message the app sent said "Bindery".
 */

import { describe, expect, it } from 'vitest';
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from '@/lib/product';
import { PROGRAM_NAME } from '@/lib/sms-program';

describe('What the product is called', () => {
  it('is what the A2P campaign has filed, which cannot be re-filed', () => {
    // Twilio refuses edits to a VERIFIED campaign, so this string is frozen by
    // something outside this repository. Changing it makes the filing describe
    // a program that does not exist.
    expect(PRODUCT_NAME).toBe('Bindery');
  });

  it('is the same name the SMS program leads every message with', () => {
    expect(PROGRAM_NAME).toBe(PRODUCT_NAME);
  });

  it('describes the product rather than the vendor it is built on', () => {
    // The app talks to either DWS or a self-hosted Document Engine, so naming
    // one in the product description would be an implementation detail and,
    // half the time, wrong.
    expect(PRODUCT_DESCRIPTION).not.toMatch(/nutrient|CRUD/i);
    expect(PRODUCT_DESCRIPTION.length).toBeGreaterThan(0);
  });
});
