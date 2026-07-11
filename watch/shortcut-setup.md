# The Way on the Apple Watch Ultra (v1 — Siri Shortcut)

The watch is the everywhere voice channel: Action Button → dictate →
bridge → spoken reply. Cellular means it works with the phone absent.

## Build the Shortcut (once, in the Shortcuts app on iPhone)
1. New Shortcut → name it "The Way".
2. Add action **Dictate Text** (language English, stop listening: after pause).
3. Add action **Get Contents of URL**:
   - URL: `https://YOUR-TUNNEL-DOMAIN/agent?token=YOUR_FUEL_TOKEN`
   - Method: POST · Request Body: JSON
   - Field `text` = Dictated Text (magic variable)
   - Field `mode` = `watch`
4. Add action **Get Dictionary Value** → key `reply`.
5. Add action **Speak Text** → Dictionary Value.
6. In shortcut settings: enable **Show on Apple Watch**.

## Bind the Action Button (on the watch)
Settings → Action Button → Shortcut → The Way.

## Use
Press the Action Button anywhere: "log the smoothie" · "what's my band?"
· "how many balls do I pack?" — one exchange, spoken answer, done.
Replies are server-capped to a sentence or two in watch mode.
