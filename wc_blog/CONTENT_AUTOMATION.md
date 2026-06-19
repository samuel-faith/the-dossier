# The Dossier — Content Automation Spec

## What this builds
Two scripts that keep The Dossier publishing without you writing every
article by hand:

1. `generate-previews.js` — finds upcoming matches with no preview yet,
   drafts one in The Dossier's voice, saves it for review
2. `generate-recaps.js` — finds finished matches worth writing about
   (especially ones you already previewed), drafts a recap

**Important: this generates DRAFTS, not live posts.** Nothing publishes
automatically. You (or Claude Code, on your instruction) review each draft,
fix anything wrong, then run a separate `publish.js` to push it live. This
matters because AI-generated sports content WILL occasionally get a fact
wrong — a transfer, an injury update, a stat — and your credibility is the
thing that makes the Foreshot cross-link work. Never auto-publish unreviewed
content.

## Two API keys you need to get first

1. **football-data.org** — free tier, sign up at football-data.org/client/register
   Gives you real fixtures, results, and scores for World Cup 2026 (competition code `WC`)

2. **Anthropic API key** — console.anthropic.com → Settings → API Keys
   This is what writes the actual prose. Pay-as-you-go, costs roughly
   $0.01-0.03 per generated article at this length — i.e. effectively free
   at the volume of a 104-match tournament.

Add both to a `.env` file:
```
FOOTBALL_DATA_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here
```

## File structure to add

```
the-dossier/
├── posts.json                    ← already exists, the manifest
├── scripts/
│   ├── voice-guide.md            ← The Dossier's style rules (below)
│   ├── generate-previews.js
│   ├── generate-recaps.js
│   └── publish.js
├── drafts/                       ← new folder, generated drafts land here
│   └── (generated .html files, NOT yet in posts.json or live)
└── posts/                        ← live articles only
```

## scripts/voice-guide.md — paste this as the system prompt

```
You write for The Dossier, a tactical World Cup 2026 match preview blog
owned by Foreshot, a prediction-league platform.

VOICE: Confident sports journalist. Analytical but readable — never a
stat dump. Short, declarative sentences mixed with longer flowing ones.
No hedging ("could potentially maybe") — commit to a take.

STRUCTURE (always follow this exact shape):
1. Opening paragraph — hook the reader with the storyline, not the facts
2. H2 section on the more notable/favored team's situation
3. H2 section on the underdog/opponent's case
4. H2 "tactical battle" section — name a specific matchup or player duel
   that will decide it
5. One pull-quote — a punchy, opinionated one-liner, NOT a real quote
   from anyone, clearly framed as analysis
6. Predicted score, with one sentence justifying it

RULES:
- Never invent stats, injury news, or quotes attributed to real people
- Only use facts provided in the match data — do not hallucinate transfer
  history, recent form, or club details you're not given
- If you don't have enough real information about a team's recent form,
  write around tournament context (group, ranking, history) instead of
  making up specifics
- Keep total length to 500-700 words
- Output must be valid HTML matching the existing article template
  structure (article-eyebrow, article-title, article-meta, h2 sections,
  pull-quote, predict-box)
```

## generate-previews.js — logic

1. Fetch matches from football-data.org where `status === 'SCHEDULED'`
   and kickoff is within the next 4 days
2. Filter out any match whose slug already exists in `posts.json`
3. For each remaining match, build a prompt containing:
   - Both team names, the group, venue, kickoff date
   - Each team's FIFA ranking if available from the API response
   - Group standings so far (so the model knows what's at stake)
4. Send to Claude API (model: `claude-sonnet-4-6`) with the voice-guide
   as system prompt, asking for structured JSON output:
   ```json
   {
     "headline": "...",
     "metaLine": "...",
     "paragraphs": [{"type": "p", "text": "..."}, {"type": "h2", "text": "..."}],
     "pullQuote": "...",
     "predictedHome": 2,
     "predictedAway": 0
   }
   ```
5. Take that JSON and inject it into the existing HTML article template
   (copy the structure from `posts/argentina-vs-austria.html` — same
   classes, same layout, same Foreshot CTA banner)
6. Save the generated file to `drafts/{slug}.html` — NOT to `posts/`
7. Print a summary to the terminal: which matches got drafts, with a
   one-line excerpt of each headline, so you know what to review

## generate-recaps.js — logic

1. Fetch matches from football-data.org where `status === 'FINISHED'`
   in the last 2 days
2. For each, check `posts.json` for a matching slug:
   - **If a preview exists**: this is automatically recap-worthy. Pull
     the original `predictedScore` from posts.json and pass it to the
     prompt so the model can write the "we called it X, it finished Y"
     callback line
   - **If no preview exists**: only flag as recap-worthy if the goal
     difference is 3 or more, OR if either team was a pre-tournament
     top-10 ranked side losing
3. For flagged matches, generate a recap draft the same way as previews,
   but using a recap-specific instruction: report what happened, why,
   and (if a prior prediction exists) how it compared — no predicted
   score box, no "predict on Foreshot" framing for a match that's over
4. Save to `drafts/{slug}-recap.html`

## publish.js — logic

Simple CLI tool you run after reviewing a draft:
```bash
node scripts/publish.js brazil-vs-haiti
```
This:
1. Moves `drafts/brazil-vs-haiti.html` to `posts/brazil-vs-haiti.html`
2. Appends the matching entry to `posts.json`
3. Prints a reminder to `git add . && git commit && git push`

## Running it

**Manual trigger (recommended while you're learning the system):**
```bash
node scripts/generate-previews.js
node scripts/generate-recaps.js
```
Run these once a day, review what lands in `/drafts`, publish what's good.

**Scheduled trigger (once you trust the output quality):**
Set up a GitHub Action at `.github/workflows/daily-drafts.yml` that runs
`generate-previews.js` and `generate-recaps.js` every morning and opens a
Pull Request with the new files in `/drafts` — NOT a direct commit to
main. You still review and merge manually. Ask Claude Code to scaffold
this workflow file once the two scripts above are working locally.

## The approval flow — GitHub Pull Request (recommended)

This is the version that feels "automatic" without ever risking an
unreviewed article going live. Instead of running scripts manually and
publishing yourself, let GitHub do the scheduling and the review happens
as a single click.

**Set up `.github/workflows/daily-drafts.yml`** to run on a schedule
(e.g. every morning at 7am UTC):

```yaml
name: Daily content drafts
on:
  schedule:
    - cron: '0 7 * * *'
  workflow_dispatch: {}

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: node scripts/generate-previews.js
        env:
          FOOTBALL_DATA_API_KEY: ${{ secrets.FOOTBALL_DATA_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      - run: node scripts/generate-recaps.js
        env:
          FOOTBALL_DATA_API_KEY: ${{ secrets.FOOTBALL_DATA_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      - run: node scripts/publish.js --all --stage-only
      - uses: peter-evans/create-pull-request@v6
        with:
          branch: auto-drafts
          title: "New Dossier drafts — review and merge"
          commit-message: "Add generated match content"
```

Add your two API keys as GitHub repo secrets (Settings → Secrets and
variables → Actions → New repository secret) — never put real keys
directly in the workflow file.

**What this means day to day:**

1. Every morning, the Action runs on its own — you don't lift a finger
2. If there's new content, it shows up as a Pull Request on your repo
3. You open the PR on GitHub.com, read the new file(s) in the diff view
4. Looks good → click **Merge pull request**. That's your approval.
5. Merging to `main` triggers Vercel's existing GitHub integration,
   which deploys automatically — same as any normal push
6. Nothing wrong → close the PR without merging, no harm done

The only manual step in the entire pipeline is reading the diff and
clicking one button. Everything else — fetching fixtures, writing
drafts, updating `posts.json`, deploying — runs unattended.

## Internal linking (automate this) vs backlinks (can't be automated)

**Internal linking — build this into the generation scripts:**

1. **Recap → preview link.** When `generate-recaps.js` finds a match that
   already has a preview in `posts.json`, the recap's opening section
   must include a direct link back to that preview article and quote
   the original predicted score for the "we called it X, it finished Y"
   line.

2. **Related matches footer.** Every generated article (preview or
   recap) gets a "Related previews" block before the footer, linking to
   2-3 other posts — prioritise same-group matches first, then most
   recent posts. Pull these from `posts.json`, don't hardcode them.

3. **sitemap.xml.** Add a `generate-sitemap.js` script (or fold this
   into `publish.js`) that rebuilds `sitemap.xml` at the repo root every
   time a post is published, listing every URL in `posts.json` plus the
   homepage. Submit this once to Google Search Console after your first
   real batch of posts — after that it stays current automatically.

**Backlinks are not a code problem — don't try to automate them.**
Backlinks come from real people linking to your articles from elsewhere:
Facebook shares, WhatsApp forwards, someone quoting a prediction. No
script can manufacture that. The honest growth path is the same
distribution you're already doing for Foreshot itself — post the article
link on Facebook and WhatsApp groups every time one goes live, and
consider cross-posting summaries to football communities where
self-promotion is allowed. Internal linking and the sitemap simply make
sure that when people DO arrive, Google can find and rank every page.

## What NOT to automate

Never let the workflow auto-merge its own Pull Request — that defeats
the entire point of the review step. A wrong score, a misspelled player
name, or a hallucinated stat undermines the one thing this blog is
selling — that you know football well enough to be trusted with
predictions. That trust is also what makes someone click through to
Foreshot. The five seconds it takes to read a diff and click Merge
protects the entire funnel.
