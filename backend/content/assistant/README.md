# Assistant knowledge

Policy and help text the shopping assistant may quote (ADR 0025). Each `*.md` file except this one is
one document: frontmatter, then sections that start with `## `. `npm run assistant:index` (and the
worker's index sweep) embeds what changed.

```
---
title: Shipping
path: /shipping        # the store page the assistant links to
status: draft          # draft until the policy is decided (PRD §9); then confirmed
---
```

Keep these in step with the pages they describe (`frontend/src/app/(store)/…` and
`frontend/src/components/storefront/faq/faqs.ts`). Do not write prices or fees here: the assistant
reads delivery fees from the store settings when it answers, so they are never stale.
