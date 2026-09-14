/**
 * The keywords US carriers require every A2P number to honour.
 *
 * Matched only when the keyword is the entire message. "Please stop by later" is
 * a comment, not an opt-out, and unsubscribing somebody who was talking to a
 * colleague is both wrong and the kind of bug nobody reports — they simply stop
 * hearing from us.
 */

// These lists are filed with the A2P 10DLC campaign. Honouring fewer keywords
// than the filing promises is a compliance failure a carrier can test directly,
// and it fails badly rather than quietly: an unrecognised keyword falls through
// to the reply path and gets posted into a document as a comment.
const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'REVOKE'];

// START, YES and UNSTOP are what carriers mandate and what this program would
// have chosen. VERIFY and VERIFICATION are here because the campaign actually
// files *them* as its opt-in keywords — Twilio's placeholder text went in
// unedited on the third submission — and that cannot be corrected: a campaign
// may only be updated while it is FAILED, and this one is VERIFIED, so approval
// itself closed the edit window. Changing it means deleting and re-registering,
// which restarts vetting.
//
// So the code is reconciled to the filing instead. Without this, a carrier
// reviewer following the filing's own instructions would text VERIFY, get no
// confirmation, and silently post a comment into a document.
const START_WORDS = ['START', 'YES', 'UNSTOP', 'VERIFY', 'VERIFICATION'];

const HELP_WORDS = ['HELP', 'INFO'];

export type SmsKeyword = 'stop' | 'start' | 'help';

export const classifyKeyword = (body: string): SmsKeyword | null => {
  const word = body.trim().toUpperCase();

  if (STOP_WORDS.includes(word)) return 'stop';
  if (START_WORDS.includes(word)) return 'start';
  if (HELP_WORDS.includes(word)) return 'help';

  return null;
};
