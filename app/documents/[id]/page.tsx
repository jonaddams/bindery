import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AppFrame } from '@/components/app-frame';
import { DocumentTools } from '@/components/document-tools';
import { DocumentViewer } from '@/components/document-viewer';
import { getDocumentWriteFilter, getEffectiveDocumentFilter, requireAuth } from '@/lib/auth';
import { nutrientConfig } from '@/lib/nutrient-config';
import { operationsFor, toOperationSummary } from '@/lib/operations';
import { prisma } from '@/lib/prisma';

type Params = {
  id: string;
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
    const operations = operationsFor(nutrientConfig().target).map(toOperationSummary);

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

    return (
      <AppFrame user={session.user} active="document">
        <div className="bnd-page">
          <Link href="/dashboard" className="bnd-back">
            Documents
          </Link>
          {/* Document metadata - Compact table format */}
          <div className="bg-background shadow rounded-lg border border-border p-3 mb-3">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="py-1.5 font-medium text-muted w-20">Title</td>
                  <td className="py-1.5 text-foreground font-medium" colSpan={3}>
                    {document.title}
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 font-medium text-muted w-20">Size</td>
                  <td className="py-1.5 text-foreground w-20">
                    {formatFileSize(document.fileSize)}
                  </td>
                  <td className="py-1.5 font-medium text-muted w-24">Uploaded by</td>
                  <td className="py-1.5 text-foreground">
                    {document.owner.name || document.owner.email}
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 font-medium text-muted">Created</td>
                  <td className="py-1.5 text-foreground" colSpan={3}>
                    {formatDate(document.createdAt)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 font-medium text-muted">Type</td>
                  <td className="py-1.5 text-foreground break-all" colSpan={3}>
                    {document.fileType}
                  </td>
                </tr>
                {document.derivedFrom && (
                  <tr>
                    <td className="py-1.5 font-medium text-muted">Redacted from</td>
                    <td className="py-1.5" colSpan={3}>
                      <Link
                        href={`/documents/${document.derivedFrom.id}`}
                        className="text-primary hover:text-primary-hover transition-colors"
                      >
                        {document.derivedFrom.title}
                      </Link>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <DocumentTools
            documentId={document.id}
            canRunTools={canRunTools}
            operations={operations}
          />

          {/* Document viewer */}
          <DocumentViewer documentId={document.id} className="h-[calc(100vh-240px)]" />
        </div>
      </AppFrame>
    );
  } catch {
    redirect('/auth/signin');
  }
}
