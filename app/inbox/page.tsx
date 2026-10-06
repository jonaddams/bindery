import { redirect } from 'next/navigation';
import { AppFrame } from '@/components/app-frame';
import { MentionFeed } from '@/components/mention-feed';
import { requireAuth } from '@/lib/auth';

export default async function InboxPage() {
  try {
    const session = await requireAuth();

    return (
      <AppFrame user={session.user} active="inbox">
        <div className="bnd-page narrow">
          <MentionFeed variant="inbox" />
        </div>
      </AppFrame>
    );
  } catch {
    redirect('/auth/signin');
  }
}
