/**
 * Where an upload waits in Vercel Blob between the browser and the backend.
 *
 * Uploads are staged because a Vercel Function refuses any request body over
 * 4.5 MB before our code runs, answering a plain-text `413
 * FUNCTION_PAYLOAD_TOO_LARGE`. So the browser sends the file straight to a
 * private Blob store, and the upload route reads it from there — a function's
 * outbound requests carry no such limit.
 *
 * The client chooses the pathname, so this prefix is the only thing tying a
 * staged file to the person who staged it. Both the token route and the upload
 * route check it, and the upload route checks it before passing the value to
 * `get()`, which also accepts a full URL and would fetch it with our Blob
 * credentials attached.
 */

const stagedUploadPrefix = (uploaderId: string): string => `uploads/${uploaderId}/`;

export const stagedUploadPathname = (options: { uploaderId: string; filename: string }): string =>
  `${stagedUploadPrefix(options.uploaderId)}${options.filename}`;

// `..` is refused because the Blob SDK builds a URL from the pathname, and URL
// parsing would resolve `uploads/me/../them/x` into someone else's folder.
export const isOwnStagedUpload = (options: { pathname: string; uploaderId: string }): boolean =>
  options.pathname.startsWith(stagedUploadPrefix(options.uploaderId)) &&
  !options.pathname.split('/').includes('..');
