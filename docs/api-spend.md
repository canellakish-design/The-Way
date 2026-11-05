# API spend and the prompt cache (5 Nov 2026)

Every call the site makes to the Claude API goes through `fetch` in one of these modules. The API bills
every token sent, every time, unless the start of the request is the same as a request seen in the last
five minutes: that part is then read from the cache at a twentieth of the price (Opus 5.5). Writing the
cache costs a quarter more than sending the text plain, so a cached block pays for itself on the second
request inside five minutes and loses a little when a call stands alone.

| Caller | Model | Calls | What is cached |
|---|---|---|---|
| `bridge/coach.js` (questions, debriefs) | Opus 5.5 | up to 16 steps a question, each re-sending the whole conversation | the system prompt and the tools, and the conversation at its last block, since 3 Nov |
| `bridge/food.js` `analyze` (a plate) | Opus 5.5 | one per logged meal or correction | `READER`: the standing instructions, as a system block; the day's targets, plan and journal follow in the message |
| `bridge/voice.js` `understand` | Opus 5.5 | one per utterance | `systemText()`: the brief, the action types and the reply rules; the day's state and his words follow |
| `bridge/agent.js` (the old Ride-page chat) | Sonnet 4.6 | up to 4 hops | the system prompt (the tools follow it, so they sit inside the cached prefix) |
| `bridge/food.js` `recheckDay` | Haiku 5.5 | one after a log | nothing: one short call, the day's journal is most of it |
| `bridge/advisor.js` | Opus 5.5 | one per ask | nothing: the standing part is under the 512-token minimum, so a marker would do nothing |
| `bridge/kitchen.js`, `bridge/batches.js` | Sonnet 4.6 | rare | nothing: short single calls |

## Reading the result
- A coach job records `in / cached / out` per step in `job.debug` and the total in `job.usage` (shown on the Coach page as the question's cost).
- `analyze` and `understand` log one line each to the function log on Netlify: `food reader usage {...}` and
  `voice usage {...}`, with `cache_creation_input_tokens` (written) and `cache_read_input_tokens` (read).
  A second plate inside five minutes should show the reader's ~750 tokens as read, not written.
- Anthropic's usage page shows the hit rate for the key as a whole. Its estimate of the saving covers the
  whole period it looks back over, including the coach's traffic before 3 Nov, when every step bought the
  whole conversation again.

## Rules kept
- The cached block must come first and must not change between calls: no clock, no date, no journal in it.
  The clock is in the message ("Current time of day where he is").
- Order on the wire is tools, then system, then messages: anything that varies goes after the marker.
- Changing the model, the schema or a word of the block starts a new cache; that is expected after a deploy.
