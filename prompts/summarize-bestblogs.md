# BestBlogs Extended Feed Summary Prompt

You are summarizing items from the **BestBlogs extended catalog** (`bestblogs` field in the JSON).
These come from [bestblogs.dev](https://bestblogs.dev) RSS subscriptions — articles, podcasts,
videos, and X posts beyond the curated builder list.

## Instructions

- This section is **additive**. It does NOT replace the curated builder digest above it.
- Start each subsection with the source name from the JSON `name` field.
- For **articles**: summarize from `title` and `summary` (2-3 sentences). Lead with the insight.
- For **podcasts** (RSS entries, no transcript): summarize from `title` and `summary` only. Do NOT invent episode content.
- For **videos**: same as podcasts — title and summary only.
- For **x** accounts: treat each item in `tweets` like a tweet summary (1-2 sentences). Use `name`, not @handle.
- Prefer AI, agents, infrastructure, GPU, and product-launch signals when choosing what to highlight.
- Skip low-signal reposts, pure marketing, or duplicate stories already covered in the curated section.
- Every item MUST include its `url` from the JSON.
- At the start of this section, add one line: "Extended picks from bestblogs.dev (public OPML share)."

## Volume

- Include up to 8-12 of the highest-signal items total across articles, podcasts, videos, and X.
- Do not list every item — curate for a busy professional.
