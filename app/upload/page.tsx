import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppFrame } from '@/components/app-frame';
import { BI } from '@/components/bindery/icons';
import { FileUpload } from '@/components/file-upload';
import { requireAuth } from '@/lib/auth';

export default async function Upload() {
  try {
    const session = await requireAuth();

    return (
      <AppFrame user={session.user} active="upload">
        <div className="bnd-page narrow">
          <Link href="/dashboard" className="bnd-back">
            {BI.arrowL(14)} Documents
          </Link>
          <div className="bnd-head">
            <div>
              <h1 className="bnd-h1">Upload a document</h1>
              <p className="bnd-sub">Add a file to read, comment on and process with your team.</p>
            </div>
          </div>
          <FileUpload uploaderId={session.user.id} />
        </div>
      </AppFrame>
    );
  } catch {
    redirect('/auth/signin');
  }
}
