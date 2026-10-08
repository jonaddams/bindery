/**
 * Keeps the nav's Inbox badge in step with the mention feed without a shared
 * store: the feed announces the new unread count when it marks mentions read,
 * and the frame listens. A window event, because the two live in different
 * parts of the tree and nothing else needs the count.
 */

const UNREAD_MENTIONS_EVENT = 'bindery:unread-mentions';

export const announceUnreadMentions = (count: number): void => {
  window.dispatchEvent(new CustomEvent<number>(UNREAD_MENTIONS_EVENT, { detail: count }));
};

/** Listen for a new unread count; returns the function that stops listening. */
export const onUnreadMentions = (listener: (count: number) => void): (() => void) => {
  const handle = (event: Event) => {
    if (event instanceof CustomEvent && typeof event.detail === 'number') {
      listener(event.detail);
    }
  };
  window.addEventListener(UNREAD_MENTIONS_EVENT, handle);
  return () => window.removeEventListener(UNREAD_MENTIONS_EVENT, handle);
};
