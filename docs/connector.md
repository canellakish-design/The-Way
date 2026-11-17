# The Way as a connector for Claude

Built 17 Nov 2026 so Harry's Claude projects (Cycling Coach, Chief of Staff) read and write The Way directly instead of
driving a browser. Code: `bridge/mcp.js`, tests: `node bridge/mcp.test.js`.

## The address

    https://thewayforward.netlify.app/mcp

with the request header `Authorization: Bearer <key>`. Where a client cannot send a header, the key goes in the address
instead: `https://thewayforward.netlify.app/mcp/<key>`.

The key is the Netlify environment variable `WAY_MCP_KEY` (24 characters or more). Harry sets it himself; it is never in
this repository and never printed. Until it is set the connector answers 503 and does nothing. A changed key needs a new
deploy before it takes effect.

On the copy of the site only (the sandbox, its own store), `/mcp/copy` with the site's own header is a second way in, so
the tools can be tried without his key. That door does not exist on the real site.

## What it does

Reads: `get_day` (today or any date: the timeline, rides, lifts, the meal plan with planned and logged macros,
supplements, medicines, drives), `get_week`, `get_recovery_and_sleep`, `get_weight`, `get_fitness`, `get_notebook`,
and `read_site` for any other page the coach may read.

Writes: `log_meal` (with his own macros when he has them), `log_weight`, `log_sleep`, `log_wellness`, `mark_taken`
(a medicine or a supplement), `move_workout`, `remove_workout`, `schedule_workout`, `move_event`, `add_note`, and
`do_action` for the rest of what the app does (a nap, a lift done, a race, a route, the Garmin).

Every write goes through `voice.js run()` in the quick coach's own action shape, the one function the buttons and both
coaches use, so the site's own checks hold (nothing before the earliest session time, no meal logged twice). Every write
answers with exactly what changed: the entry as stored, or the session before and after. Two sessions of one name on a
day are never guessed between: the answer lists them and asks for `session_id` or `at`.

Nothing here reaches another person. Events on shared calendars are not moved from here.

## Adding it in claude.ai

1. Netlify, the thewayforward project, Project configuration, Environment variables: add `WAY_MCP_KEY` with a long
   random value (a password manager's generator, 32 characters or more, letters and digits). Then Deploys, Trigger
   deploy, Deploy project.
2. claude.ai, Customize, Connectors, Add, Add custom connector.
3. Name: The Way. URL: `https://thewayforward.netlify.app/mcp`. Continue.
4. Authentication: No sign in. Request headers: name `Authorization`, value `Bearer ` followed by the key. Add.
5. In the Cycling Coach and Chief of Staff projects, open a chat, the + button, Connectors, switch The Way on.

## Test calls

1. "Use The Way: what is on my day today?" (get_day)
2. "What does my week look like?" (get_week)
3. "How did I sleep and what is my recovery?" (get_recovery_and_sleep)
4. "What is my weight trend?" (get_weight) and "Where is my fitness?" (get_fitness)
5. "What is in the coach's notebook?" (get_notebook)
6. "Log a glass of water, 500 ml." (log_meal as a drink; it answers with the entry, and it shows on the Food page)
7. "Add a note: testing the connector." (add_note)
8. "Mark my morning eye drops taken." (mark_taken; a second time it says it was already marked)
