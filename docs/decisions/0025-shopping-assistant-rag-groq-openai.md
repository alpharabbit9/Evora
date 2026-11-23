# ADR 0025 — Shopping Assistant: Retrieval Over pgvector, Groq for Chat, OpenAI for Embeddings and Fallback

- **Status:** Accepted for development (2026-11-15). Built and tested against local stand-ins for
  both providers. It has not yet run against real Groq or OpenAI: that needs the owner's keys and
  the eval set (`docs/assistant-setup.md` §6). The policy text it answers from is still a draft
  (PRD §9), and sending chat text to Groq and OpenAI needs the privacy review listed in PRD §9.
- **Date:** 2026-11-14 (amended 2026-11-23: Groq-only mode, see below)
- **Related:** [ADR 0004](0004-inventory-policy.md), [ADR 0009](0009-identity-authorization-and-rate-limiting.md),
  [ADR 0012](0012-public-catalog-api-and-cart-ownership.md),
  [ADR 0019](0019-online-payments-sslcommerz.md), [ADR 0021](0021-outbox-worker-and-email-delivery.md),
  [ADR 0023](0023-end-to-end-tests-ci-and-hardening.md); plan: `docs/assistant-rag-plan.md`

## Context
Customers want to ask questions in their own words: "a linen shirt for a summer wedding under
৳3,000", "how much is delivery to Chattogram?", "where is my order?". The storefront answers these
only through filters, the FAQ and the order page. A chat assistant can answer them, but a language
model guesses unless it is given the facts. Retrieval-augmented generation (RAG) gives it the facts:
look up the relevant store data first, then have the model answer from what was found.

The store's invariants constrain how. Prices and stock are authoritative only in PostgreSQL at the
moment they are read (CLAUDE.md, PRD §6), customers see only their own orders (PRD §3), and an outside
provider's outage must not affect the shop (architecture.md §2). The project owner chose Groq for
chat and OpenAI as the second provider; there is no Anthropic dependency. Groq has no embeddings
API, so embeddings come from OpenAI.

## Decision
1. **Live facts come from tool calls, not from the index.** The model gets read-only tools that run
   the existing services when it answers: `listProducts`, `getPublicProduct` and `publicCardsByIds`
   (catalog), and `listOwnOrders` / `getOwnOrder` (orders). The user id comes from the session,
   never from the model's arguments. So a price, a stock state or an order status in an answer is
   the one PostgreSQL held when the answer was given.
2. **Retrieval covers text only, and returns ids.** pgvector holds embeddings of policy and FAQ
   chunks, and of each public product's name, description, category and colours, for searches by
   meaning. A product search returns product ids, which are re-read through `publicCardsByIds`: the
   publication rule (`catalog/publication.ts`) and live prices apply on every read, so a stale
   embedding can never show an unpublished product or an old price.
3. **pgvector inside the existing PostgreSQL.** No new datastore (ADR 0005's reasoning applies to a
   vector database too). Tables `knowledge_documents`, `knowledge_chunks`, `product_embeddings`
   with `vector(1536)` columns and HNSW cosine indexes, created by hand-written migration SQL like
   every other constraint and index Prisma cannot model. CI and staging use the `pgvector/pgvector`
   image; local development installs the extension into PostgreSQL 18.
4. **Groq answers; OpenAI embeds and stands in.** One adapter
   (`providers/openai-compatible.ts`) talks to both over plain `fetch`, because Groq's API is
   OpenAI-compatible. No SDK, like the SSLCOMMERZ adapter: the wire format is small and stable, there
   is no new dependency to audit, and the timeouts act on the socket directly. `ChatProvider` and `EmbeddingProvider` interfaces sit in
   front of them, the same shape as `payments/provider.ts`: every failure becomes one
   provider-neutral error, and a registry returns `null` when keys are missing, which switches the
   feature off. Model names come from environment variables, because Groq's model list changes.
5. **Fallback only before the first word.** If Groq fails (error, 429 or timeout) before it has
   streamed anything, the turn is retried once on OpenAI. A failure after text has reached the
   customer ends the turn with an error event; mixing two models' halves in one answer would be
   worse than a retry button. Both down: 503 `PROVIDER_UNAVAILABLE`, and the rest of the store is
   untouched.
6. **The assistant cannot change anything.** No tool writes. Cancelling, coupons, cart changes and
   account changes stay as buttons the customer presses on the page. That removes the worst outcome
   of prompt injection, which matters because product descriptions come from an importer and are
   untrusted text: tool results are passed to the model as tagged data, and descriptions are
   truncated.
7. **Guests may chat, about the catalog and policies.** Order tools are offered only with a session.
   A guest conversation is owned by a random token the browser keeps for the tab; the server stores
   only its hash, as it does for legacy guest carts.
8. **Conversations are kept for 30 days.** `assistant_conversations` and `assistant_messages` let a
   customer resume a chat and let an administrator review failures. A recurring worker job deletes
   conversations 30 days after their last message, and every administrator view of a conversation is
   audited. Message text is never logged.
9. **Draft policy is labelled as draft.** Policy knowledge lives in `backend/content/assistant/*.md`
   with `status: draft | confirmed`. Every source is a draft today (the `/faq` and `/shipping` pages
   say so), so the assistant says an answer is provisional and the widget marks the source.
10. **Cost is capped in the database, not only in memory.** An `assistant` rate limiter (per
    instance, ADR 0009) plus a daily token budget per customer or per hashed IP, read from
    `assistant_messages`, a per-conversation message cap and a 1,000-character message limit.
11. **The reply streams.** `POST /assistant/messages` answers with server-sent events (`meta`,
    `delta`, `products`, `sources`, `done`, `error`). It is the first streaming route, so
    `compression()` skips `text/event-stream`; the Origin check and body limit still apply.
12. **Tests never reach a real provider.** A local OpenAI-compatible stand-in
    (`scripts/assistant/fake-llm.ts`) streams scripted answers and tool calls, returns deterministic
    embeddings and simulates outages, as `fake-sslcommerz.ts` does for payments. Answer quality is
    measured separately by an eval set run against the real providers on request.

## Amendment (2026-11-23): Groq alone
The owner has a Groq key and no OpenAI key, and chose to run the assistant on Groq alone rather than
wait for one. OpenAI is now optional:

- **The registry needs only a chat provider.** With no `OPENAI_API_KEY`, `embeddings` is `null`
  and the assistant is still on, with Groq as its only provider.
- **Policy text is found by PostgreSQL full-text search** (`searchKnowledgeText`: English stemming,
  any word may match, ranked by `ts_rank`) over the same `knowledge_chunks`, whose `embedding` is
  now nullable (migration `20261123000000_assistant_text_only_knowledge`). The indexer stores
  chunks without vectors and hashes them under the label `text-only`, so adding an OpenAI key later
  re-embeds every document on the next run. A search that matches nothing returns the list of
  policy pages, so the model can point the customer there instead of guessing.
- **`semantic_search_products` is not offered** and is refused if called; products are found by the
  catalog's keyword and filter search (`search_products`), which already applies the publication
  rule and live prices. Product embeddings are neither written nor read.
- **There is no fallback** (decision 5): a Groq failure before the first word answers 503
  `PROVIDER_UNAVAILABLE`, and the rest of the store is untouched.

Costs of the choice: searches by meaning ("something for a summer wedding") depend on the model
turning them into key words, and Groq's free tier (8,000 tokens a minute per model, about two
answers a minute for the whole store) is the effective capacity. Adding `OPENAI_API_KEY` and
`OPENAI_CHAT_MODEL` restores the original design with no code change; run `npm run
assistant:index` afterwards.

## Consequences
- The index lags edits by up to one sweep interval. Correctness does not depend on it, because
  every product read goes through the publication rule and live prices (decision 2); only search
  recall lags.
- Changing the embedding model means a migration: the vector size is in the column type.
- Chat text and minimal order data (number, status, dates, tracking, item names — never address,
  phone or email) leave the store for Groq or OpenAI. The privacy notice must say so before launch.
- A third outside provider joins payments and email in M12's monitoring and launch gates.

## Known limitations
- Policy answers are provisional until PRD §9 decides delivery, returns and refunds.
- The FAQ text exists twice, in `frontend/src/components/storefront/faq/faqs.ts` and in the
  knowledge files.
- The in-memory limiter is per instance; the database budget is the real cap.
- Retrieval quality is judged by an eval set, not proven by tests.

## Alternatives
- **A separate vector database (Pinecone, Qdrant):** another service to run, back up and secure,
  and a second copy of catalog data that can drift. Not needed at this catalog size.
- **Put prices and stock in the index:** simpler prompts, but answers would quote stale prices, which
  breaks the rule that the server's current data is the only price.
- **Let the bot act (cancel orders, apply coupons):** convenient, but any prompt injection becomes
  an action. Buttons with confirmations already exist.
- **OpenAI only:** simpler, but the owner chose Groq for speed and cost; OpenAI is kept as fallback.
- **Anthropic Claude:** not chosen by the owner.

## Revisit when
- PRD §9 confirms shipping and returns: mark the knowledge files `confirmed`.
- Customers ask for actions ("cancel my order"): design confirm-in-UI tool flows first.
- More than one API instance runs: move the limiter to a shared store (ADR 0005).
- The catalog passes ~50,000 products, or recall measurably drops: tune HNSW parameters or add
  hybrid keyword + vector ranking.
