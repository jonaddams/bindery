'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BI } from '@/components/bindery/icons';
import { CONSENT_DISCLOSURES, PROGRAM_LEGAL_URLS, PROGRAM_NAME } from '@/lib/sms-program';

type Channel = 'EMAIL' | 'SMS' | 'BOTH';

type NotificationSettingsProps = {
  initialPhone: string | null;
  initialVerified: boolean;
  initialChannel: Channel;
  /** Already formatted for display by `formatProgramNumber`. */
  programNumber: string;
};

/**
 * The "Text only" hint says what a text will not contain, because that choice
 * has a consequence the label does not suggest: a text names the document and
 * never quotes the comment, so choosing it alone means the comment body arrives
 * nowhere. Someone should learn that here rather than by receiving one.
 */
const CHANNEL_OPTIONS: ReadonlyArray<{ value: Channel; label: string; hint: string }> = [
  { value: 'EMAIL', label: 'Email only', hint: 'The default. No texts are sent.' },
  {
    value: 'SMS',
    label: 'Text only',
    hint: 'Requires a registered number. A text names the document but never quotes the comment — open the link to read it.',
  },
  { value: 'BOTH', label: 'Both email and text', hint: 'Requires a registered number.' },
];

/** How often the page asks whether the inbound text has arrived yet. */
const POLL_INTERVAL_MS = 5000;

/**
 * The opt-in surface for text notifications — "Settings → Notifications".
 *
 * This screen is the program's Call-to-Action. A carrier reviewing the A2P
 * campaign asks to see where consent is given and what it says, and the second
 * submission was rejected on that check because this screen did not exist: the
 * backend was complete, the published page described the flow, and there was no
 * page to walk through or screenshot. So the disclosures here are not decoration
 * — they are the artefact under review, and they must match
 * https://jonaddams.com/sms.
 *
 * Registration is deliberately inbound. The page shows a short code and the
 * number to text it to; the number is learned from the message that arrives.
 * Nobody is ever asked to type a phone number, so a number cannot be registered
 * by anyone but the person holding the handset — and the inbound message is the
 * consent record an audit wants to see. Nothing in the browser learns that the
 * text arrived, hence the poll.
 */
export function NotificationSettings({
  initialPhone,
  initialVerified,
  initialChannel,
  programNumber,
}: NotificationSettingsProps) {
  const [phone, setPhone] = useState(initialPhone);
  const [verified, setVerified] = useState(initialVerified);
  const [channel, setChannel] = useState<Channel>(initialChannel);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // Held in a ref so the polling effect does not restart on every render.
  const isAwaitingText = code !== null && !verified;
  const awaitingRef = useRef(isAwaitingText);
  awaitingRef.current = isAwaitingText;

  const checkStatus = useCallback(async () => {
    const response = await fetch('/api/user/phone');

    if (!response.ok) {
      return;
    }

    const status: { phone: string | null; verified: boolean } = await response.json();

    if (status.verified) {
      setPhone(status.phone);
      setVerified(true);
      setCode(null);
      setError(null);
    }
  }, []);

  useEffect(() => {
    if (!isAwaitingText) {
      return;
    }

    const interval = setInterval(() => {
      if (awaitingRef.current) {
        void checkStatus();
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isAwaitingText, checkStatus]);

  const startRegistration = async () => {
    setIsBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/user/phone', { method: 'POST' });

      if (!response.ok) {
        setError('Could not start registration. Please try again.');
        return;
      }

      const started: { code: string } = await response.json();
      setCode(started.code);
    } catch {
      setError('Could not start registration. Please try again.');
    } finally {
      setIsBusy(false);
    }
  };

  const forgetNumber = async () => {
    setIsBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/user/phone', { method: 'DELETE' });

      if (!response.ok) {
        setError('Could not remove that number. Please try again.');
        return;
      }

      setPhone(null);
      setVerified(false);
      setCode(null);
      // Texts can no longer be delivered, so the channel falls back rather than
      // pointing at a number that is gone.
      setChannel('EMAIL');
    } finally {
      setIsBusy(false);
    }
  };

  const chooseChannel = async (next: Channel) => {
    setError(null);

    const response = await fetch('/api/user/notification-channel', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: next }),
    });

    if (!response.ok) {
      const body: { error?: string } = await response.json();
      setError(body.error ?? 'Could not change where notifications go.');
      return;
    }

    setChannel(next);
  };

  return (
    <>
      {error ? (
        <div className="bnd-alert bad" role="alert">
          {BI.xcircle(18)}
          <p>{error}</p>
        </div>
      ) : null}

      <section className="bnd-card">
        <div className="bnd-card-h">
          <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>Notifications</h2>
        </div>
        <div className="bnd-card-b">
          <fieldset className="bnd-field" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="bnd-lbl" style={{ padding: 0, marginBottom: 10 }}>
              Where should notifications go?
            </legend>
            {CHANNEL_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`bnd-radio ${channel === option.value ? 'on' : ''}`}
              >
                <input
                  type="radio"
                  name="notification-channel"
                  value={option.value}
                  checked={channel === option.value}
                  onChange={() => chooseChannel(option.value)}
                  style={{ margin: '1px 0 0', width: 18, height: 18, accentColor: 'var(--bnd-hi)' }}
                />
                <span>
                  <b>{option.label}</b>
                  <small>{option.hint}</small>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      </section>

      <section className="bnd-card">
        <div className="bnd-card-h">
          <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>Text notifications</h2>
          {verified ? (
            <span className="bnd-pill">
              <span className="bnd-dot ok" />
              Verified
            </span>
          ) : null}
        </div>
        <div className="bnd-card-b bnd-stack">
          <p className="bnd-hint" style={{ margin: 0, fontSize: 13 }}>
            {verified
              ? `${PROGRAM_NAME} can text this number.`
              : `Text notifications are off. ${PROGRAM_NAME} never texts a number until that number has texted us first.`}
          </p>

          {verified && phone ? (
            <div className="bnd-reg">
              <span className="ic">{BI.phone(16)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="bnd-hint">Registered</span>
                <b className="bnd-mono" style={{ display: 'block', fontWeight: 500 }}>
                  {phone}
                </b>
              </div>
              <button
                type="button"
                className="btn sm ghost"
                onClick={forgetNumber}
                disabled={isBusy}
              >
                Forget this number
              </button>
            </div>
          ) : code ? (
            <div className="bnd-stack" style={{ gap: 10 }}>
              <p style={{ margin: 0 }}>
                From the mobile number you want to register, text this code to{' '}
                <b className="bnd-mono">{programNumber}</b>:
              </p>
              <div className="bnd-reg">
                <span className="ic">{BI.phone(16)}</span>
                <b
                  className="bnd-mono"
                  style={{ flex: 1, fontSize: 28, fontWeight: 500, letterSpacing: '0.2em' }}
                >
                  {code}
                </b>
                <button type="button" className="btn sm ghost" onClick={checkStatus}>
                  Check now
                </button>
              </div>
              <p className="bnd-hint" style={{ margin: 0 }}>
                The code is good for 10 minutes and can only be used once. We will reply once to
                confirm.
              </p>
            </div>
          ) : (
            <div>
              <button type="button" className="btn" onClick={startRegistration} disabled={isBusy}>
                Set up text notifications
              </button>
            </div>
          )}

          <ul className="bnd-legal">
            {CONSENT_DISCLOSURES.map((disclosure) => (
              <li key={disclosure}>
                <span>{disclosure}</span>
              </li>
            ))}
            <li>
              <span>
                See the <a href={PROGRAM_LEGAL_URLS.terms}>terms of service</a> and the{' '}
                <a href={PROGRAM_LEGAL_URLS.privacy}>privacy policy</a>.
              </span>
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}
