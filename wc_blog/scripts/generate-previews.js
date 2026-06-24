'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
const { escHtml, escAttr, buildRelatedMatchesHTML } = require('./lib');

const FOOTBALL_API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const GROQ_API_KEY     = process.env.GROQ_API_KEY;

const ROOT        = path.join(__dirname, '..');
const DRAFTS_DIR  = path.join(ROOT, 'drafts');
const POSTS_JSON  = path.join(ROOT, 'posts.json');
const VOICE_GUIDE = fs.readFileSync(path.join(__dirname, 'voice-guide.md'), 'utf-8');

const groq = new Groq({ apiKey: GROQ_API_KEY });

// ── helpers ───────────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function matchSlug(home, away) {
  return `${slugify(home)}-vs-${slugify(away)}`;
}

function isWithinNextDays(utcDate, days) {
  const t = new Date(utcDate).getTime();
  const now = Date.now();
  return t >= now && t <= now + days * 86_400_000;
}

// Use US Eastern time for all date display — avoids UTC midnight cross-over
// for late-evening US kickoffs (e.g. 9 PM ET = 01:00 UTC next day)
function toEasternDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date); // returns YYYY-MM-DD
}

function toEasternDateLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric',
  }).format(date); // returns "Jun 20"
}

function toEasternLongDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(date); // returns "Saturday, June 20, 2026"
}

async function footballGet(endpoint) {
  const res = await fetch(`https://api.football-data.org/v4${endpoint}`, {
    headers: { 'X-Auth-Token': FOOTBALL_API_KEY },
  });
  if (!res.ok) throw new Error(`football-data.org ${endpoint} → ${res.status} ${res.statusText}`);
  return res.json();
}

function formatTeamForm(finishedMatches, teamName) {
  const played = (finishedMatches || []).filter(m =>
    m.homeTeam.name === teamName || m.awayTeam.name === teamName
  );
  if (played.length === 0) return '  No matches played yet in this tournament';
  return played.map(m => {
    const isHome    = m.homeTeam.name === teamName;
    const opponent  = isHome ? m.awayTeam.name : m.homeTeam.name;
    const goalsFor  = isHome ? m.score.fullTime.home : m.score.fullTime.away;
    const goalsAgt  = isHome ? m.score.fullTime.away : m.score.fullTime.home;
    const outcome   = goalsFor > goalsAgt ? 'Won' : goalsFor < goalsAgt ? 'Lost' : 'Drew';
    const dateLabel = toEasternDateLabel(new Date(m.utcDate));
    return `  ${outcome} ${goalsFor}–${goalsAgt} vs ${opponent} (${dateLabel})`;
  }).join('\n');
}

function formatStandings(standingsData, matchGroup) {
  if (!standingsData?.standings || !matchGroup) return '';
  const entry = standingsData.standings.find(s => s.group === matchGroup);
  if (!entry) return '';
  return entry.table
    .map(r => {
      const gd = r.goalDifference >= 0 ? `+${r.goalDifference}` : String(r.goalDifference);
      return `  ${r.position}. ${r.team.name} — P${r.playedGames} W${r.won} D${r.draw} L${r.lost} GD${gd} Pts${r.points}`;
    })
    .join('\n');
}

// ── Claude call ───────────────────────────────────────────────────────────────

async function generatePreviewContent(match, standingsText, formData) {
  const homeName   = match.homeTeam.name;
  const awayName   = match.awayTeam.name;
  const kickoff    = new Date(match.utcDate);
  const dateLabel  = toEasternLongDate(kickoff);
  const groupLabel = match.group ? `Group ${match.group.replace('GROUP_', '')}` : 'Group Stage';
  const homeRank   = match.homeTeam.ranking ? ` (FIFA #${match.homeTeam.ranking})` : '';
  const awayRank   = match.awayTeam.ranking ? ` (FIFA #${match.awayTeam.ranking})` : '';

  const prompt = `Write a match preview for this World Cup 2026 fixture.

MATCH DATA:
- Team 1: ${homeName}${homeRank}
- Team 2: ${awayName}${awayRank}
- Competition: FIFA World Cup 2026, ${groupLabel}
- Kickoff: ${dateLabel}${match.venue ? `\n- Venue: ${match.venue}` : ''}
- Neutral venue: WC 2026 is hosted across the USA, Canada, and Mexico. Do not reference home advantage or home crowd for either side unless the team IS the USA, Canada, or Mexico playing in their own country.
${formData ? `\nTOURNAMENT FORM (actual results from the API — use these, do not invent results):\n${homeName}:\n${formData.home}\n${awayName}:\n${formData.away}` : ''}
${standingsText ? `\nGROUP STANDINGS:\n${standingsText}` : ''}

Return ONLY raw JSON (no markdown fences) with this exact shape:
{
  "headline": "match title",
  "metaLine": "one-sentence SEO description under 160 chars",
  "paragraphs": [
    {"type": "p",  "text": "opening paragraph"},
    {"type": "h2", "text": "favoured team section heading"},
    {"type": "p",  "text": "favoured team body"},
    {"type": "h2", "text": "underdog section heading"},
    {"type": "p",  "text": "underdog body"},
    {"type": "h2", "text": "The Tactical Battle to Watch"},
    {"type": "p",  "text": "tactical body"},
    {"type": "p",  "text": "closing sentence justifying the predicted score"}
  ],
  "pullQuote": "punchy one-liner — analysis, not a real attributed quote",
  "predictedHome": <integer>,
  "predictedAway": <integer>
}

PREDICTED SCORE RULES — read carefully:
- Base the scoreline on the actual team strengths, FIFA rankings, form data, and tactical setup above.
- World Cup group-stage scorelines are typically tight: 1-0, 1-1, 2-1, 0-0, and 2-0 are all common. 3+ goals is rarer and only fits if there is a clear mismatch.
- If the teams are evenly matched, a draw (0-0 or 1-1) is a valid and realistic prediction — do not default to a win.
- NEVER default to 2-0 out of habit. Each game must have a scoreline that reflects the specific matchup.
- Do not include the pull-quote or predict-box in the paragraphs array.`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: VOICE_GUIDE },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 2000,
  });
  const raw = completion.choices[0].message.content.trim()
    .replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(raw);
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildPreviewHTML(match, content, livePosts) {
  const homeName   = match.homeTeam.name;
  const awayName   = match.awayTeam.name;
  const slug       = matchSlug(homeName, awayName);
  const kickoff    = new Date(match.utcDate);
  const dateLabel  = toEasternLongDate(kickoff);
  const groupLabel = match.group ? `Group ${match.group.replace('GROUP_', '')}` : 'Group Stage';

  let bodyHTML = '';
  for (const block of content.paragraphs) {
    if (block.type === 'h2') bodyHTML += `\n    <h2>${escHtml(block.text)}</h2>\n\n`;
    else                     bodyHTML += `    <p>${block.text}</p>\n\n`;
  }

  const relatedHTML = buildRelatedMatchesHTML(slug, livePosts, groupLabel);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(content.headline)} — The Dossier</title>
<meta name="description" content="${escAttr(content.metaLine)}">
<link rel="stylesheet" href="../styles.css">
</head>
<body>

<nav class="site-nav">
  <div class="wrap" style="display:flex; align-items:center; justify-content:space-between;">
    <div class="brand-block">
      <a href="../index.html" class="brand">THE <span>DOSSIER</span></a>
      <span class="brand-sub">by <a href="https://foreshot.net">Foreshot</a></span>
    </div>
    <div class="nav-right">
      <span class="nav-tag">World Cup 2026 · Match Previews</span>
      <a href="https://foreshot.net" class="nav-cta">Play on Foreshot →</a>
    </div>
  </div>
</nav>

<header class="article-header">
  <div class="wrap">
    <p class="article-eyebrow">${escHtml(groupLabel)} · Match Preview</p>
    <h1 class="article-title">${escHtml(content.headline)}</h1>
    <p class="article-meta">${escHtml(dateLabel)}${match.venue ? ` · ${escHtml(match.venue)}` : ''}</p>
  </div>
</header>

<svg class="pitch-divider wrap" viewBox="0 0 880 28" preserveAspectRatio="none">
  <line x1="0" y1="14" x2="880" y2="14"/>
  <circle cx="440" cy="14" r="10"/>
</svg>

<article class="article-body">
  <div class="wrap">

${bodyHTML}
    <blockquote class="pull-quote">
      <span class="quote-mark">"</span>${content.pullQuote}<span class="quote-mark">"</span>
    </blockquote>

    <div class="predict-box">
      <p class="label">Predicted score</p>
      <div class="score-row">
        <span class="team-name">${escHtml(homeName)}</span>
        <span class="digits">${content.predictedHome}</span>
        <span style="font-family:var(--font-mono); color:var(--mist);">—</span>
        <span class="digits">${content.predictedAway}</span>
        <span class="team-name">${escHtml(awayName)}</span>
      </div>
    </div>

    <div class="foreshot-cta">
      <p class="text">Think you'd have called it differently? <strong>Lock in your own prediction</strong> for this match on Foreshot.</p>
      <a href="https://foreshot.net" class="cta-btn">Predict this match →</a>
    </div>

  </div>
</article>
${relatedHTML}
<div class="wrap">
  <a href="../index.html" class="back-link">← Back to all previews</a>
</div>

<footer class="site-footer">
  <p>THE DOSSIER — tactical match previews, every matchday.</p>
  <p>Part of <a href="https://foreshot.net">Foreshot</a> — predict scores, win cash.</p>
</footer>

</body>
</html>`;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!FOOTBALL_API_KEY) { console.error('Missing FOOTBALL_DATA_API_KEY in .env'); process.exit(1); }
  if (!GROQ_API_KEY)     { console.error('Missing GROQ_API_KEY in .env'); process.exit(1); }

  if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });

  const livePosts    = JSON.parse(fs.readFileSync(POSTS_JSON, 'utf-8'));
  const existingSlugs = new Set(livePosts.map(p => p.slug));

  console.log('Fetching scheduled WC 2026 matches...');
  const { matches } = await footballGet('/competitions/WC/matches?status=SCHEDULED');

  const toGenerate = (matches || []).filter(m => {
    if (!isWithinNextDays(m.utcDate, 4)) return false;
    const slug = matchSlug(m.homeTeam.name, m.awayTeam.name);
    if (existingSlugs.has(slug)) return false;
    if (fs.existsSync(path.join(DRAFTS_DIR, `${slug}.html`))) {
      console.log(`  Skipping ${slug} — draft already exists`);
      return false;
    }
    return true;
  });

  if (toGenerate.length === 0) {
    console.log('No new matches to preview in the next 4 days.');
    return;
  }

  console.log(`${toGenerate.length} match(es) need previews.\n`);

  let standingsData = null;
  try {
    standingsData = await footballGet('/competitions/WC/standings');
  } catch (e) {
    console.warn('Standings unavailable (tournament may not have started):', e.message);
  }

  let finishedMatches = [];
  try {
    const { matches: fm } = await footballGet('/competitions/WC/matches?status=FINISHED');
    finishedMatches = fm || [];
    console.log(`  ${finishedMatches.length} finished match(es) loaded for form context.`);
  } catch (e) {
    console.warn('Finished matches unavailable:', e.message);
  }

  const generated = [];
  const delay = ms => new Promise(res => setTimeout(res, ms));

  for (const [i, match] of toGenerate.entries()) {
    const homeName = match.homeTeam.name;
    const awayName = match.awayTeam.name;
    const slug     = matchSlug(homeName, awayName);

    if (i > 0) {
      console.log('  Waiting 5s (free-tier rate limit)...');
      await delay(5000);
    }

    console.log(`Generating: ${homeName} vs ${awayName}...`);

    try {
      const standingsText = formatStandings(standingsData, match.group);
      const formData = {
        home: formatTeamForm(finishedMatches, homeName),
        away: formatTeamForm(finishedMatches, awayName),
      };
      const content = await generatePreviewContent(match, standingsText, formData);
      const html          = buildPreviewHTML(match, content, livePosts);

      fs.writeFileSync(path.join(DRAFTS_DIR, `${slug}.html`), html, 'utf-8');

      const kickoff    = new Date(match.utcDate);
      const groupLabel = match.group ? `Group ${match.group.replace('GROUP_', '')}` : 'Group Stage';

      const meta = {
        slug,
        group:          groupLabel,
        date:           toEasternDate(kickoff),
        dateLabel:      toEasternDateLabel(kickoff),
        fixture:        `${homeName} vs ${awayName}`,
        hook:           content.metaLine,
        predictedScore: `${content.predictedHome}-${content.predictedAway}`,
        type:           'preview',
        featured:       false,
        venue:          match.venue || '',
        kickoffLabel:   toEasternLongDate(kickoff),
      };
      fs.writeFileSync(path.join(DRAFTS_DIR, `${slug}.meta.json`), JSON.stringify(meta, null, 2), 'utf-8');

      generated.push({ slug, headline: content.headline });
      console.log(`  Saved → drafts/${slug}.html`);
    } catch (err) {
      console.error(`  Failed for ${slug}:`, err.message);
    }
  }

  if (generated.length) {
    console.log('\n--- Drafts ---');
    generated.forEach(({ slug, headline }) => console.log(`  ${slug} — "${headline}"`));
    console.log('\nReview, then: node scripts/publish.js <slug>');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
