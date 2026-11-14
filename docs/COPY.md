# The copy of The Way

This branch exists only to give Netlify a test address for the site: the draft pull request "Copy of The Way: never merge" builds a deploy preview, which runs with THE_WAY_SANDBOX=1 (netlify.toml).

- Its own store, opened on a snapshot of the real data; every write stays in the copy.
- Writes to intervals.icu and Google Calendar are held back on the server (bridge/sandbox.js).
- An amber banner on every page.

Never merge this pull request. To refresh the copy with the latest site, merge main into this branch.
