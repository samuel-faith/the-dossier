# THE DOSSIER — World Cup 2026 Match Preview Blog

A tactical match-preview blog built specifically as a writing portfolio piece,
a potential AdSense / content site, and a feeder into Foreshot. Plain HTML
and CSS — no build tools, no Node, no framework needed to run it.

## What's inside

```
wc_blog/
├── index.html               ← homepage (reads posts.json, renders cards)
├── posts.json                ← the list of all posts — edit this to add one
├── styles.css                 ← the whole design system, one file
├── posts/
│   ├── brazil-vs-haiti.html
│   ├── argentina-vs-austria.html
│   └── france-vs-iraq.html
├── CONTENT_AUTOMATION.md     ← spec for auto-generating future posts
└── README.md
```

## How to view it locally

Plain HTML can be double-clicked, but this version fetches `posts.json`
via JavaScript, and browsers block local file fetches for security. So
for this version, always run a local server:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## How to add a new match preview manually

1. Duplicate `posts/argentina-vs-austria.html`, rename it, and edit the
   headline, meta, body paragraphs, pull quote, and predicted score
2. Open `posts.json` and add a new entry to the array:
   ```json
   {
     "slug": "spain-vs-uruguay",
     "group": "Group H",
     "date": "2026-06-25",
     "dateLabel": "Jun 25",
     "fixture": "Spain vs Uruguay",
     "hook": "One sentence that makes someone want to click.",
     "predictedScore": "2-1",
     "type": "preview",
     "featured": false
   }
   ```
3. Save, push to GitHub — Vercel redeploys automatically

That's it. The homepage card grid and "Next Up" hero both render from
`posts.json` automatically — you never touch `index.html` again.

## How to automate this instead of writing by hand

See `CONTENT_AUTOMATION.md` for the full spec — it's written to hand
directly to Claude Code. It covers generating draft previews and recaps
automatically using the football-data.org API plus the Anthropic API,
with a manual review step before anything goes live.

## How to deploy it (so it has a real URL)

**Vercel (recommended — keep this as its own separate project, not part
of the Foreshot prediction app's codebase):**

1. Push this folder to its own new GitHub repository
2. Go to vercel.com → New Project → import that repository
3. Leave all settings as default (it's a static site, no build command
   needed) → Deploy
4. Add `dossier.foreshot.net` under Settings → Domains
5. In Namecheap, add a CNAME record: Host = `dossier`, Value = the
   target Vercel gives you

## Customizing the design

Every color, font, and spacing value lives in `styles.css` as a CSS
variable at the top of the file (`:root { ... }`).
