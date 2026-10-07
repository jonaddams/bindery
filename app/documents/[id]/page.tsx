import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AppFrame } from '@/components/app-frame';
import { BI } from '@/components/bindery/icons';
import { DocumentTools } from '@/components/document-tools';
import { DocumentViewer } from '@/components/document-viewer';
import { RailSection } from '@/components/rail-section';
import { getDocumentWriteFilter, getEffectiveDocumentFilter, requireAuth } from '@/lib/auth';
import { nutrientConfig } from '@/lib/nutrient-config';
import { operationsForDocument, toOperationSummary } from '@/lib/operations';
import { prisma } from '@/lib/prisma';

type Params = {
  id: string;
};

const fileTypeBadge = (mimeType: string): { label: string; className: string } => {
  if (mimeType === 'application/pdf') return { label: 'PDF', className: '' };
  if (mimeType.includes('wordprocessingml') || mimeType === 'application/msword') {
    return { label: 'DOCX', className: 'docx' };
  }
  if (mimeType.startsWith('image/')) return { label: 'IMG', className: 'img' };
  return { label: 'FILE', className: '' };
};

export default async function DocumentView({ params }: { params: Promise<Params> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // Get the document with owner info
    const document = await prisma.document.findUnique({
      where: { id },
      include: {
        owner: {
          select: {
            name: true,
            email: true,
          },
        },
        // A redacted copy is a separate document, so without this the reader has
        // no way back to what it was made from.
        derivedFrom: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    if (!document) {
      notFound();
    }

    // Check if user can access this document based on role and impersonation
    const filter = getEffectiveDocumentFilter(session.user);
    const canAccess = await prisma.document.findFirst({
      where: {
        id,
        ...filter,
      },
    });

    if (!canAccess) {
      notFound();
    }

    // Whether this reader may *start* an operation, which is a narrower
    // permission than reading the document: it spends processing credits and
    // creates a document owned by the owner. The route enforces the same split
    // — this only decides whether to offer the control.
    const canRunTools =
      (await prisma.document.findFirst({
        where: { id, ...getDocumentWriteFilter(session.user) },
        select: { id: true },
      })) !== null;

    // Called here, not in the client component: DocumentTools must never import
    // nutrientConfig, so what this deployment offers is decided server-side and
    // handed down as plain data. Projected through toOperationSummary because
    // DocumentOperation.parse is a function — React cannot pass a function from
    // a server component to a Client Component, and this is not caught by
    // typecheck or build, only by actually loading the page.
    const operations = operationsForDocument({
      target: nutrientConfig().target,
      fileType: document.fileType,
    }).map(toOperationSummary);

    const formatFileSize = (bytes: bigint | null) => {
      if (!bytes || bytes === BigInt(0)) return '0 Bytes';
      const bytesNumber = Number(bytes);
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytesNumber) / Math.log(k));
      return `${Math.round((bytesNumber / k ** i) * 100) / 100} ${sizes[i]}`;
    };

    const formatDate = (date: Date) => {
      return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(date));
    };

    const formatDay = (date: Date) =>
      new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(
        new Date(date)
      );

    const badge = fileTypeBadge(document.fileType);
    const ownerName = document.owner.name || document.owner.email;

    // A derived copy is a separate document, made by any operation — not only
    // redaction — so the link back says "derived from", not what was done.
    const derivedFromLink = document.derivedFrom && (
      <Link href={`/documents/${document.derivedFrom.id}`}>{document.derivedFrom.title}</Link>
    );

    return (
      <AppFrame user={session.user} active="document">
        <div className="bnd-page" style={{ maxWidth: 1360 }}>
          <Link href="/dashboard" className="bnd-back">
            {BI.arrowL(14)} Documents
          </Link>

          <div className="bnd-dhead">
            <div className="l">
              <h1 className="bnd-h1">{document.title}</h1>
              <div className="meta">
                <span className={`bnd-ficon ${badge.className}`}>{badge.label}</span>
                <span>{formatFileSize(document.fileSize)}</span>
                <span>· Uploaded by {ownerName}</span>
                <span>· {formatDay(document.createdAt)}</span>
              </div>
              {derivedFromLink && (
                <div className="bnd-derived">
                  {BI.branch(13)} Derived from {derivedFromLink}
                </div>
              )}
            </div>
          </div>

          <div className="bnd-doc">
            <DocumentViewer documentId={document.id} />

            <aside className="bnd-rail">
              <DocumentTools
                documentId={document.id}
                canRunTools={canRunTools}
                operations={operations}
              />

              <RailSection title="Details">
                <dl className="bnd-dl">
                  <dt>Name</dt>
                  <dd>{document.title}</dd>
                  <dt>Type</dt>
                  <dd>{document.fileType}</dd>
                  <dt>Size</dt>
                  <dd>{formatFileSize(document.fileSize)}</dd>
                  <dt>Owner</dt>
                  <dd>{ownerName}</dd>
                  <dt>Created</dt>
                  <dd>{formatDate(document.createdAt)}</dd>
                  {document.author && (
                    <>
                      <dt>Author</dt>
                      <dd>{document.author}</dd>
                    </>
                  )}
                  {derivedFromLink && (
                    <>
                      <dt>Derived from</dt>
                      <dd>{derivedFromLink}</dd>
                    </>
                  )}
                </dl>
              </RailSection>
            </aside>
          </div>
        </div>
      </AppFrame>
    );
  } catch {
    redirect('/auth/signin');
  }
}
