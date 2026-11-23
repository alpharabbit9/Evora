'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiGet } from '@/lib/api-client';
import { ApiErrorCode, errorMessage, isApiError } from '@/lib/api-error';
import type { ProductCard } from '@/lib/catalog/types';

import { type PolicySource, sendAssistantMessage } from './stream';

/**
 * The chat's state in the browser (ADR 0025). The server owns the conversation; the browser keeps
 * only which conversation is open, per tab, in `sessionStorage`, together with a guest's
 * conversation token. Storage can fail (private windows), so every access is guarded and the
 * chat still works for the length of the page.
 *
 * Conversations belong to one owner, so the stored one is keyed by who is signed in: signing in
 * or out starts a fresh chat instead of sending the server a conversation it would refuse.
 */

export interface AssistantStatus {
  readonly enabled: boolean;
  readonly providers: readonly string[];
}

export function useAssistantStatus() {
  return useQuery({
    queryKey: ['assistant-status'],
    queryFn: () => apiGet<AssistantStatus>('/assistant/status'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  text: string;
  products: ProductCard[];
  sources: PolicySource[];
  status: 'streaming' | 'done' | 'failed';
  error?: string;
}

interface Stored {
  readonly owner: string;
  readonly conversationId: string;
  readonly guestToken?: string;
}

const STORAGE_KEY = 'commercecore.assistant';

function readStored(owner: string): Stored | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Stored;
    return value.owner === owner && typeof value.conversationId === 'string' ? value : null;
  } catch {
    return null;
  }
}

function writeStored(value: Stored | null): void {
  try {
    if (value) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: the conversation simply lasts as long as the page.
  }
}

interface ConversationView {
  readonly messages: readonly {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    failed: boolean;
  }[];
}

let nextId = 0;
const localId = () => `local-${String((nextId += 1))}`;

export function useAssistantChat(ownerId: string | null) {
  const owner = ownerId ?? 'guest';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const stored = useRef<Stored | null>(null);
  const abort = useRef<AbortController | null>(null);
  const loadedFor = useRef<string | null>(null);

  // A different owner means a different conversation: drop what is on screen (React's
  // "adjust state when a prop changes" pattern, during render rather than in an effect).
  const [shownFor, setShownFor] = useState(owner);
  if (shownFor !== owner) {
    setShownFor(owner);
    setMessages([]);
    setNotice(null);
    setBusy(false);
  }

  useEffect(() => {
    abort.current?.abort();
    stored.current = readStored(owner);
    loadedFor.current = null;
  }, [owner]);

  useEffect(() => () => abort.current?.abort(), []);

  /** Loads the open conversation's history once, when the panel is first shown. */
  const resume = useCallback(async () => {
    const current = stored.current;
    if (!current || loadedFor.current === current.conversationId) return;
    loadedFor.current = current.conversationId;
    try {
      const conversation = await apiGet<ConversationView>(
        `/assistant/conversations/${encodeURIComponent(current.conversationId)}`,
        current.guestToken ? { headers: { 'x-assistant-token': current.guestToken } } : {},
      );
      setMessages(
        conversation.messages.map((message) => ({
          id: message.id,
          role: message.role,
          text: message.content,
          products: [],
          sources: [],
          status: message.failed ? 'failed' : 'done',
        })),
      );
    } catch (error) {
      if (isApiError(error) && error.code === ApiErrorCode.NOT_FOUND) {
        // Deleted after 30 days, or no longer ours: start afresh.
        stored.current = null;
        writeStored(null);
      }
    }
  }, []);

  const reset = useCallback(() => {
    abort.current?.abort();
    stored.current = null;
    loadedFor.current = null;
    writeStored(null);
    setMessages([]);
    setNotice(null);
    setBusy(false);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (message === '' || busy) return;

      const replyId = localId();
      setNotice(null);
      setBusy(true);
      setMessages((list) => [
        ...list,
        { id: localId(), role: 'user', text: message, products: [], sources: [], status: 'done' },
        {
          id: replyId,
          role: 'assistant',
          text: '',
          products: [],
          sources: [],
          status: 'streaming',
        },
      ]);

      const update = (change: (reply: ChatMessage) => ChatMessage) => {
        setMessages((list) => list.map((item) => (item.id === replyId ? change(item) : item)));
      };

      const controller = new AbortController();
      abort.current = controller;
      let finalText = '';

      try {
        await sendAssistantMessage({
          message,
          conversationId: stored.current?.conversationId,
          guestToken: stored.current?.guestToken,
          signal: controller.signal,
          onEvent: (event) => {
            switch (event.type) {
              case 'meta': {
                const next: Stored = {
                  owner,
                  conversationId: event.conversationId,
                  ...(event.guestToken
                    ? { guestToken: event.guestToken }
                    : stored.current?.guestToken
                      ? { guestToken: stored.current.guestToken }
                      : {}),
                };
                stored.current = next;
                loadedFor.current = next.conversationId;
                writeStored(next);
                break;
              }
              case 'delta':
                finalText += event.text;
                update((reply) => ({ ...reply, text: reply.text + event.text }));
                break;
              case 'products':
                update((reply) => ({ ...reply, products: [...reply.products, ...event.items] }));
                break;
              case 'sources':
                update((reply) => ({
                  ...reply,
                  sources: [
                    ...reply.sources,
                    ...event.items.filter(
                      (source) => !reply.sources.some((seen) => seen.path === source.path),
                    ),
                  ],
                }));
                break;
              case 'done':
                update((reply) => ({ ...reply, status: 'done' }));
                break;
              case 'error':
                update((reply) => ({ ...reply, status: 'failed', error: event.message }));
                break;
            }
          },
        });
        update((reply) => (reply.status === 'streaming' ? { ...reply, status: 'done' } : reply));
        setAnnouncement(finalText);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;

        if (isApiError(error) && error.code === ApiErrorCode.NOT_FOUND) {
          stored.current = null;
          writeStored(null);
        }
        const text =
          isApiError(error) && error.code === ApiErrorCode.PROVIDER_UNAVAILABLE
            ? 'The assistant is unavailable right now. Please try again in a few minutes.'
            : isApiError(error) && error.code === ApiErrorCode.NOT_FOUND
              ? 'That chat has ended. Send your message again to start a new one.'
              : errorMessage(error);
        update((reply) => ({ ...reply, status: 'failed', error: text }));
        setAnnouncement(text);
        if (isApiError(error) && error.code === ApiErrorCode.RATE_LIMITED) setNotice(error.message);
      } finally {
        if (abort.current === controller) abort.current = null;
        setBusy(false);
      }
    },
    [busy, owner],
  );

  /** Sends the customer's last message again, after a failed reply. */
  const retry = useCallback(() => {
    const lastUser = [...messages].reverse().find((item) => item.role === 'user');
    if (!lastUser) return;
    setMessages((list) => list.slice(0, -2));
    void send(lastUser.text);
  }, [messages, send]);

  return { messages, busy, notice, announcement, send, retry, reset, resume };
}
