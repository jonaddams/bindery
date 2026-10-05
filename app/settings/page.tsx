import { redirect } from 'next/navigation';
import { AppFrame } from '@/components/app-frame';
import { Avatar } from '@/components/bindery/avatar';
import { BI } from '@/components/bindery/icons';
import { NotificationSettings } from '@/components/notification-settings';
import { SignOutButton } from '@/components/sign-out-button';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { formatProgramNumber } from '@/lib/sms-program';

/**
 * Settings → Notifications.
 *
 * This route exists because the A2P 10DLC filing describes it. The campaign's
 * published Call-to-Action tells a reviewer to sign in and "open Settings →
 * Notifications", where a single-use code is displayed — and until now that
 * screen did not exist, which is why the CTA could not be verified. The
 * registration backend was already complete; only this was missing.
 *
 * Data is read here rather than in the client component, following the house
 * split: server components fetch, client components handle interaction.
 */
export default async function SettingsPage() {
  try {
    const session = await requireAuth();

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { phone: true, phoneVerifiedAt: true, notificationChannel: true },
    });

    const displayName = session.user.name || session.user.email;

    return (
      <AppFrame user={session.user} active="settings">
        <div className="bnd-page narrow">
          <div className="bnd-head">
            <div>
              <h1 className="bnd-h1">Settings</h1>
              <p className="bnd-sub">How Bindery reaches you when someone mentions you.</p>
            </div>
          </div>
          <div className="bnd-stack">
            <section className="bnd-card">
              <div className="bnd-card-h">
                <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>Account</h2>
              </div>
              <div
                className="bnd-card-b"
                style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}
              >
                <Avatar id={session.user.id} name={displayName} size="lg" />
                <div style={{ flex: 1, minWidth: 180 }}>
                  <b style={{ display: 'block', fontWeight: 600 }}>{displayName}</b>
                  <span className="bnd-hint">{session.user.email}</span>
                </div>
                <SignOutButton className="btn ghost sm" icon={BI.signout(14)} />
              </div>
            </section>
            <NotificationSettings
              initialPhone={user?.phone ?? null}
              initialVerified={Boolean(user?.phoneVerifiedAt)}
              initialChannel={user?.notificationChannel ?? 'EMAIL'}
              // The digits come from the environment so the screen always shows
              // the number the app actually receives on; the punctuation matches
              // what jonaddams.com/sms publishes.
              programNumber={formatProgramNumber(process.env.TWILIO_PHONE_NUMBER ?? '')}
            />
          </div>
        </div>
      </AppFrame>
    );
  } catch {
    redirect('/auth/signin');
  }
}
