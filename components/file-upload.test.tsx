import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileUpload } from '@/components/file-upload';

const stageInBlob = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock('@vercel/blob/client', () => ({
  upload: (...a: unknown[]) => stageInBlob(...a),
}));

const getMockFile = (name = 'quarterly-report.pdf') =>
  new File(['%PDF-1.7 fake'], name, { type: 'application/pdf' });

const getFileInput = () => screen.getByLabelText(/click to upload/i);

const dropFile = (file: File) => {
  // The drop handler lives on the surrounding drop zone; React's synthetic
  // events bubble, so dropping on the prompt text reaches it.
  fireEvent.drop(screen.getByText(/or drag and drop/i), {
    dataTransfer: { files: [file] },
  });
};

describe('Choosing a file to upload', () => {
  it('exposes the upload prompt as a labelled file input, not a second button', () => {
    render(<FileUpload uploaderId="user_jon" />);

    expect(getFileInput()).toHaveAttribute('type', 'file');
    expect(screen.queryByRole('button', { name: /drag and drop/i })).not.toBeInTheDocument();
  });

  it('shows the name of the chosen file', async () => {
    render(<FileUpload uploaderId="user_jon" />);

    await userEvent.upload(getFileInput(), getMockFile());

    expect(screen.getByText('quarterly-report.pdf')).toBeInTheDocument();
  });

  it('prefills the title with the file name minus its extension', async () => {
    render(<FileUpload uploaderId="user_jon" />);

    await userEvent.upload(getFileInput(), getMockFile());

    expect(screen.getByLabelText(/document title/i)).toHaveValue('quarterly-report');
  });

  it('accepts a file dropped onto the upload area', () => {
    render(<FileUpload uploaderId="user_jon" />);

    dropFile(getMockFile('dropped-contract.pdf'));

    expect(screen.getByText('dropped-contract.pdf')).toBeInTheDocument();
    expect(screen.getByLabelText(/document title/i)).toHaveValue('dropped-contract');
  });

  it('lets the user discard the chosen file and start over', async () => {
    render(<FileUpload uploaderId="user_jon" />);
    await userEvent.upload(getFileInput(), getMockFile());

    await userEvent.click(screen.getByRole('button', { name: /choose different file/i }));

    expect(screen.queryByText('quarterly-report.pdf')).not.toBeInTheDocument();
    expect(getFileInput()).toBeInTheDocument();
  });
});

describe('Offering OCR while uploading', () => {
  it('leaves OCR off for a PDF, which may well have text already', async () => {
    render(<FileUpload uploaderId="user_jon" />);

    await userEvent.upload(getFileInput(), getMockFile());

    expect(screen.getByLabelText(/make searchable/i)).not.toBeChecked();
  });

  // A photo of a page never has a text layer.
  it('turns OCR on for an image', async () => {
    render(<FileUpload uploaderId="user_jon" />);

    await userEvent.upload(getFileInput(), new File(['png'], 'receipt.png', { type: 'image/png' }));

    expect(screen.getByLabelText(/make searchable/i)).toBeChecked();
  });

  it('does not offer OCR for an Office document, which is text already', async () => {
    render(<FileUpload uploaderId="user_jon" />);

    await userEvent.upload(
      getFileInput(),
      new File(['docx'], 'minutes.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    );

    expect(screen.queryByLabelText(/make searchable/i)).not.toBeInTheDocument();
  });
});

describe('Upload readiness', () => {
  it('cannot be submitted before a file is chosen', () => {
    render(<FileUpload uploaderId="user_jon" />);

    expect(screen.getByRole('button', { name: /upload document/i })).toBeDisabled();
  });

  it('can be submitted once a file supplies a title', async () => {
    render(<FileUpload uploaderId="user_jon" />);

    await userEvent.upload(getFileInput(), getMockFile());

    expect(screen.getByRole('button', { name: /upload document/i })).toBeEnabled();
  });

  it('cannot be submitted when the title has been cleared', async () => {
    render(<FileUpload uploaderId="user_jon" />);
    await userEvent.upload(getFileInput(), getMockFile());

    await userEvent.clear(screen.getByLabelText(/document title/i));

    expect(screen.getByRole('button', { name: /upload document/i })).toBeDisabled();
  });

  it('says why it cannot be submitted when the title has been cleared', async () => {
    render(<FileUpload uploaderId="user_jon" />);
    await userEvent.upload(getFileInput(), getMockFile());

    await userEvent.clear(screen.getByLabelText(/document title/i));

    expect(screen.getByLabelText(/document title/i)).toHaveAccessibleDescription(
      'Give the document a title.'
    );
  });
});

describe('Uploading', () => {
  const STAGED_PATHNAME = 'uploads/user_jon/quarterly-report-x9y8.pdf';

  beforeEach(() => {
    stageInBlob.mockResolvedValue({ pathname: STAGED_PATHNAME });
  });

  const chooseAndUpload = async () => {
    render(<FileUpload uploaderId="user_jon" />);
    await userEvent.upload(getFileInput(), getMockFile());
    await userEvent.click(screen.getByRole('button', { name: /upload document/i }));
  };

  it('stages the file privately in the uploader’s own folder, bypassing the function body limit', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ document: { id: 'doc_1' } }, { status: 201 })
    );

    await chooseAndUpload();

    expect(stageInBlob).toHaveBeenCalledWith(
      'uploads/user_jon/quarterly-report.pdf',
      expect.any(File),
      expect.objectContaining({
        access: 'private',
        handleUploadUrl: '/api/documents/upload-token',
        multipart: true,
      })
    );
  });

  it('then registers the staged file as a document', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ document: { id: 'doc_1' } }, { status: 201 }));

    await chooseAndUpload();

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/documents');
    expect(JSON.parse(String(init?.body))).toEqual({
      pathname: STAGED_PATHNAME,
      filename: 'quarterly-report.pdf',
      title: 'quarterly-report',
      author: '',
    });
    expect(await screen.findByText(/upload successful/i)).toBeInTheDocument();
  });

  it('asks for OCR in the chosen language when the uploader wants the file searchable', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ document: { id: 'doc_1' } }, { status: 201 }));
    render(<FileUpload uploaderId="user_jon" />);
    await userEvent.upload(getFileInput(), getMockFile());

    await userEvent.click(screen.getByLabelText(/make searchable/i));
    await userEvent.selectOptions(screen.getByLabelText(/ocr language/i), 'german');
    await userEvent.click(screen.getByRole('button', { name: /upload document/i }));

    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual(
      expect.objectContaining({ ocrLanguage: 'german' })
    );
  });

  it('shows the reason the server gives for refusing the document', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ error: 'Files of type text/plain are not accepted.' }, { status: 415 })
    );

    await chooseAndUpload();

    expect(
      await screen.findByText('Files of type text/plain are not accepted.')
    ).toBeInTheDocument();
  });

  it('shows a readable error when the server answers with something other than JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Request Entity Too Large', { status: 413 })
    );

    await chooseAndUpload();

    expect(await screen.findByText('Upload failed (413)')).toBeInTheDocument();
  });

  it('shows why staging failed and never registers a document', async () => {
    stageInBlob.mockRejectedValue(new Error('Content type mismatch'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await chooseAndUpload();

    expect(await screen.findByText('Content type mismatch')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
