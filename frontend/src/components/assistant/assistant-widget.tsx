'use client';

import { Dialog } from '@base-ui/react/dialog';
import { MessageCircleIcon, RotateCcwIcon, SendIcon, SparklesIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useSession } from '@/lib/auth-client';
import {
  type ChatMessage,
  useAssistantChat,
  useAssistantStatus,
} from '@/lib/assistant/use-assistant';

import { AssistantReply } from './assistant-reply';

const MAX_CHARS = 1000;

const GUEST_SUGGESTIONS = [
  'A linen shirt for a summer wedding',
  'How much is delivery outside Dhaka?',
  'Can I pay with bKash?',
] as const;

const SIGNED_IN_SUGGESTIONS = [
  'Where is my latest order?',
  'A linen shirt for a summer wedding',
  'How much is delivery outside Dhaka?',
] as const;

/**
 * The shopping assistant (ADR 0025): a launcher in the corner of every storefront page and a chat
 * dialog. Hidden entirely while the API says the assistant is off, so there is never a button
 * that leads nowhere.
 *
 * Accessibility: the dialog traps focus and closes on Escape (Base UI), the message log is a
 * `log` region, and a separate polite live region announces each finished reply once, rather
 * than every streamed word.
 */
export function AssistantWidget() {
  const status = useAssistantStatus();
  const session = useSession();
  const userId = session.data?.user.id ?? null;
  const chat = useAssistantChat(session.isPending ? 'pending' : userId);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { resume } = chat;

  useEffect(() => {
    if (open) void resume();
  }, [open, resume]);

  // Keep the newest message in view while it streams.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chat.messages]);

  if (!status.data?.enabled) return null;

  const suggestions = userId ? SIGNED_IN_SUGGESTIONS : GUEST_SUGGESTIONS;
  const lastFailed = chat.messages.at(-1)?.status === 'failed';

  function submit(text: string) {
    if (text.trim() === '' || chat.busy) return;
    void chat.send(text);
    setDraft('');
    inputRef.current?.focus();
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        className="fixed right-4 bottom-4 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg shadow-foreground/15 transition-transform outline-none hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:right-6 sm:bottom-6"
        aria-label="Ask the shopping assistant"
        // Bands that end in this corner (the home hero's controls) keep clear of it while it
        // is on the page: `--launcher-reach` in globals.css (plan.md Phase 8).
        data-assistant-launcher=""
      >
        <MessageCircleIcon className="size-5" aria-hidden="true" />
        <span className="hidden sm:inline">Ask us</span>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0 sm:bg-black/10" />
        <Dialog.Popup
          data-lenis-prevent
          className="fixed inset-x-0 bottom-0 z-50 flex h-[min(88dvh,40rem)] flex-col overflow-hidden rounded-t-2xl bg-popover text-sm text-popover-foreground shadow-2xl ring-1 ring-foreground/10 transition-[opacity,translate] outline-none data-ending-style:translate-y-4 data-ending-style:opacity-0 data-starting-style:translate-y-4 data-starting-style:opacity-0 motion-reduce:transition-none sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[26rem] sm:rounded-2xl"
        >
          <header className="flex items-start gap-3 border-b border-border px-5 py-4">
            <SparklesIcon
              className="mt-0.5 size-5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold">Shopping assistant</Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground">
                Answers are written by AI and can be wrong. Prices and stock on the cards are live.
              </Dialog.Description>
            </div>
            {chat.messages.length > 0 ? (
              <button
                type="button"
                onClick={chat.reset}
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <RotateCcwIcon className="size-3.5" aria-hidden="true" />
                New chat
              </button>
            ) : null}
            <Dialog.Close
              aria-label="Close the assistant"
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <XIcon className="size-4" aria-hidden="true" />
            </Dialog.Close>
          </header>

          <div
            ref={logRef}
            role="log"
            aria-label="Conversation"
            aria-busy={chat.busy}
            className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4"
          >
            {chat.messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-muted-foreground">
                  Ask about products, delivery or payment
                  {userId ? ', or about your orders' : ''}. Try:
                </p>
                <ul className="flex flex-col gap-2">
                  {suggestions.map((suggestion) => (
                    <li key={suggestion}>
                      <button
                        type="button"
                        onClick={() => {
                          submit(suggestion);
                        }}
                        className="w-full rounded-lg border border-border px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {suggestion}
                      </button>
                    </li>
                  ))}
                </ul>
                {userId ? null : (
                  <p className="text-xs text-muted-foreground">Sign in to ask about your orders.</p>
                )}
              </div>
            ) : (
              chat.messages.map((message) => <Bubble key={message.id} message={message} />)
            )}
          </div>

          {chat.notice ? (
            <p role="status" className="border-t border-border bg-muted px-5 py-2 text-xs">
              {chat.notice}
            </p>
          ) : null}

          <form
            className="flex items-end gap-2 border-t border-border px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit(draft);
            }}
          >
            {lastFailed && !chat.busy ? (
              <button
                type="button"
                onClick={chat.retry}
                className="h-10 shrink-0 rounded-lg border border-border px-3 text-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Retry
              </button>
            ) : null}
            <label htmlFor="assistant-input" className="sr-only">
              Message the shopping assistant
            </label>
            <textarea
              id="assistant-input"
              ref={inputRef}
              rows={1}
              value={draft}
              maxLength={MAX_CHARS}
              placeholder="Ask a question…"
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit(draft);
                }
              }}
              className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <button
              type="submit"
              disabled={chat.busy || draft.trim() === ''}
              aria-label="Send"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            >
              <SendIcon className="size-4" aria-hidden="true" />
            </button>
          </form>

          <p className="sr-only" aria-live="polite">
            {chat.announcement}
          </p>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 whitespace-pre-wrap text-primary-foreground">
          <span className="sr-only">You: </span>
          {message.text}
        </p>
      </div>
    );
  }
  return <AssistantReply message={message} />;
}
