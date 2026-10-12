# MyCity

## UI/UX — applies to all frontend work

Before designing, building, or reviewing any UI (pages, components, styling, layout, accessibility, motion, charts), load the `ui-ux-pro-max` skill and follow its workflow:

1. If a persisted design system exists under `design-system/<project>/MASTER.md`, read it (plus any `pages/<page>.md` override) and follow it. Don't regenerate it with `--force` without explicit sign-off.
2. Use the skill's `--stack <stack>` search for implementation guidance on the stack the frontend uses.
3. Before calling UI work done, run the pre-delivery checklist in the skill's `references/pro-rules.md`.

Companion skills: `ui-styling` (shadcn/ui + Tailwind patterns), `design-system` (token architecture: primitive → semantic → component), and Anthropic's `frontend-design`.

These skills come from [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) and are installed on each person's Claude account, not in this repo. If they're missing from a session, ask before proceeding rather than designing without them.

## Components from 21st.dev

The 21st.dev MCP is connected as a claude.ai connector on each person's account; it isn't configured in this repo. Before building a component from scratch, use its `search` to look for an existing React/shadcn one, then `get_component` to fetch the code.

- Code retrieval is metered per account (the free tier allows 2 a day), so search and shortlist before fetching.
- Don't run the `npx shadcn add https://21st.dev/r/...` install commands it returns. They need direct network access to 21st.dev and an API key in the environment, which cloud sessions don't have.
- Treat fetched code as a starting point: adapt it to the design system and review it like any third-party code.
