import { redirect } from 'next/navigation';
import { AppFrame } from '@/components/app-frame';
import { DocumentList } from '@/components/document-list';
import { MentionFeed } from '@/components/mention-feed';
import { requireAuth } from '@/lib/auth';

export default async function Dashboard() {
  try {
    const session = await requireAuth();

    return (
      <AppFrame user={session.user} active="dashboard">
        <div className="bnd-page">
          {/* Mentions, above the documents: being mentioned is the thing most
              likely to want attention. The card shows unread ones only, and
              renders nothing until loaded or when nothing is new. */}
          <MentionFeed variant="card" />
          <DocumentList />
        </div>
      </AppFrame>
    );
  } catch {
    redirect('/auth/signin');
  }
}
