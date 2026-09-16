/**
 * What this product is called, in one place.
 *
 * The name appears in places that a carrier reviewer compares against each
 * other — the A2P 10DLC campaign, the page published at jonaddams.com/sms, and
 * the messages the app actually sends — and the campaign has been rejected
 * before over exactly that kind of disagreement. `PROGRAM_NAME` in
 * `lib/sms-program.ts` is now derived from this rather than being a second copy
 * of it, so the two cannot drift apart.
 *
 * **The value is effectively frozen.** The campaign is VERIFIED, and Twilio
 * refuses edits to a verified campaign — "Campaign update is allowed only for
 * FAILURE state(s)" — so the filing cannot be moved to meet a new name. Changing
 * this string would make the filing describe a program that no longer exists.
 *
 * Note what it is *not*: the repository, the package, or the deployment host.
 * All three now happen to say "bindery" too, which makes it easy to forget they
 * are separate things — they were renamed to match this, not the other way
 * round, and renaming any of them again does not license changing this.
 */
export const PRODUCT_NAME = 'Bindery';

/**
 * One line on what the product does, for the browser and for link previews.
 *
 * Deliberately says nothing about Nutrient. The app talks to either the hosted
 * DWS API or a self-hosted Document Engine, so naming one of them in the
 * product's own description would be both an implementation detail and, half the
 * time, wrong.
 */
export const PRODUCT_DESCRIPTION = 'Read, comment on, and redact documents with your team.';
