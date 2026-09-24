# Rumor Town — UI spec (steps 2–4)

Plain words everywhere. A first-time visitor must understand the page in ten seconds without reading.

## Pages

### `/` Landing
- Hero: title "Rumor Town", one line: "Start a rumor. Watch a whole town pass it on, twist it, doubt it, and set it straight."
- Under the hero: the live demo town (ReplayOracle playback of a recorded 30-person run, looped, muted controls). Characters must be moving within 2 s of load.
- Primary button "Start a Rumor" → `/play`. Secondary link "How it works" (three short lines: someone hears it, they tell others, some check the facts).
- Footer: "Made with Vercel AI Gateway". No safety line here.

### `/play` Setup sheet → live run
- Setup is a sheet over a dimmed town, not a separate page:
  - Rumor: choose a preset (chips) or "Write your own" (input, 140 chars, counter). Custom rumors are marked "Unverified" and the truth state is fixed to uncertain.
  - Town size: 30 / 50 (default) / 75.
  - Advanced (collapsed): starter (Random / pick a name), town mood: "More trusting / As is / More skeptical" (skepticismBias −1/0/+1), "Quieter / As is / Chattier" (sociabilityBias).
  - Button "Start the day". Pressing it with nothing changed must start the default scenario.
- HUD (top bar): clock "8:00 AM", rumor text (truncated, tap for full), counters "Heard 12 · Believe 5 · Told others 4", speed 1x/2x/5x, pause/resume, restart, "End day".
- Town canvas fills the space. Speech bubbles above heads; small signals (❗ heard, 🤨 doubts, ✅ set straight, … thinking). A character who knows the rumor gets a subtle tint on their name tag; a correction-holder gets a check.
- Clicking a character opens the inspector (sim slows to 0.5x while open): name, job, one-line persona, trait words (never numbers), belief band as a five-step meter, "Heard from: Mina at 9:12 AM", what they currently think it is (their variant text), who they told, whether they checked the facts. Close returns speed.
- Timeline (bottom strip, collapsible): milestones as dots on a day bar; clicking one pans the camera to the place and shows the sentence.
- When the run ends the results panel slides up over the town.

### Results (in `/play` and on `/r/[id]`)
- Headline: "By 6:40 PM, 31 of 50 people had heard it. 18 believed it." (numbers from stats).
- Original rumor vs the most widespread version, side by side. If they differ, a one-line note "It changed 4 times along the way."
- Chart: heard / believing / shared over the day (load the `dataviz` skill before building it).
- Family tree of variants: nodes show the mutation kind and the text; click a node to see who first said it, how many heard it, and its parent.
- Stats grid: people who heard it, believed at the end, rejected it, told someone, rumor conversations, versions, longest chain, first correction time, most changed version.
- Buttons: "Replay this day" (exact), "Run it again" (same setup, new run seed), "Change one thing" (opens setup with the same values), "Share" (copies the `/r/[id]` link after saving).
- Safety line, small, under the buttons: "This is a fictional AI simulation. Agent behavior should not be interpreted as a prediction of real human behavior."

### `/r/[id]` Share page
- Server-rendered from the stored record, results first, then a still of the town at the final tick (client-rendered from the replayed final state), then "Start your own rumor".
- OG image: headline stat, original vs dominant version, flat town silhouette from map data.

## Controls and pacing
- 1x = 4 sim-minutes per real second. A full day is 3:00 at 1x, 1:30 at 2x, 0:36 at 5x.
- Bubbles show at least 1.1 s each. At 5x show only the last line and the signal.
- While the engine waits for an answer past its deadline the clock eases toward 0.5x; the HUD shows a small "thinking…" dot, never a spinner over the town.
- Pause freezes everything including bubbles. Restart asks nothing; it rebuilds the same setup with a new run seed. "End day" jumps to results.

## Mobile (390 px)
- Canvas fits the width (integer scale, may be 1x). Controls collapse to a bottom bar (play/pause, speed, end). Inspector becomes a bottom sheet. Chart and tree scroll horizontally. Timeline collapses to a single "Latest: …" line with a tap to expand.

## Copy rules
- Sentences under 12 words in the HUD. Names before numbers. No jargon: "set straight" not "corrected", "checked the facts" not "verified", "version" not "variant" in the UI (code keeps `variant`).
- Never show prompts, probabilities, model names, or numeric traits.
