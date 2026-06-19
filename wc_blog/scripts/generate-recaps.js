'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
const { escHtml, escAttr, buildRelatedMatchesHTML, buildPreviewBacklinkHTML } = require('./lib');

const FOOTBALL_API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const GROQ_API_KEY     = process.env.GROQ_API_KEY;

const ROOT        = path.join(__dirname, '..');
const DRAFTS_DIR  = path.join(ROOT, 'drafts');
const POSTS_JSON  = path.join(ROOT, 'posts.json');
const VOICE_GUIDE = fs.readFileSync(path.join(__dirname, 'voice-guide.md'), 'utf-8');

const groq = new Groq({ apiKey: GROQ_API_KEY });

// Approximate pre-tournament top-10 for the upset check when API omits rankings
const TOP_10 = new Set([
  'France', 'Brazil', 'England', 'Belgium', 'Argentina',
  'Portugal', 'Netherlands', 'Spain', 'Germany', 'Italy',
]);

// ── helpers ───────────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function matchSlug(home, away) {
  return `${slugify(home)}-vs-${slugify(away)}`;
}

function wasWithinLastDays(utcDate, days) {
  const t = new Date(utcDate).getTime();
  return t <= Date.now() && t >= Date.now() - days * 86_400_000;
}

function toEasternDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function toEasternDateLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric',
  }).format(date);
}

function toEasternLongDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(date);
}

async function footballGet(endpoint) {
  const res = await fetch(`https://api.football-data.org/v4${endpoint}`, {
    headers: { 'X-Auth-Token': FOOTBALL_API_KEY },
  });
  if (!res.ok) throw new Error(`football-data.org ${endpoint} → ${res.status} ${res.statusText}`);
  return res.json();
}

function isRecapWorthy(match) {
  const home   = match.score?.fullTime?.home ?? 0;
  const away   = match.score?.fullTime?.away ?? 0;
  const winner = match.score?.winner; // 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW'

  if (Math.abs(home - away) >= 3) return true;

  const homeIsElite = TOP_10.has(match.homeTeam.name) || (match.homeTeam.ranking ?? 99) <= 10;
  const awayIsElite = TOP_10.has(match.awayTeam.name) || (match.awayTeam.ranking ?? 99) <= 10;

  if (homeIsElite && winner === 'AWAY_TEAM') return true;
  if (awayIsElite && winner === 'HOME_TEAM') return true;

  return false;
}

// ── Claude call ───────────────────────────────────────────────────────────────

async function generateRecapContent(match, previewSlug, priorPrediction) {
  const homeName  = match.homeTeam.name;
  const awayName  = match.awayTeam.name;
  const homeScore = match.score.fullTime.home;
  const awayScore = match.score.fullTime.away;
  const winner    =
    homeScore > awayScore ? homeName
    : awayScore > homeScore ? awayName
    : 'a draw';
  const dateLabel = toEasternLongDate(new Date(match.utcDate));
  const groupLabel = match.group ? `Group ${match.group.replace('GROUP_', '')}` : 'Group Stage';

  const predictionLine = priorPrediction
    ? `\nTHE DOSSIER PREDICTED: ${priorPrediction} (actual: ${homeScore}-${awayScore})`
    : '';

  const prompt = `Write a match REPORT for this completed World Cup 2026 fixture.

MATCH DATA:
- Team 1: ${homeName}
- Team 2: ${awayName}
- Result: ${homeName} ${homeScore}–${awayScore} ${awayName}
- Outcome: ${winner === 'a draw' ? 'Draw' : `${winner} win`}
- Competition: FIFA World Cup 2026, ${groupLabel}
- Date: ${dateLabel}${match.venue ? `\n- Venue: ${match.venue}` : ''}
- Neutral venue: WC 2026 is hosted across the USA, Canada, and Mexico. Do not reference home advantage or home crowd for either side unless the team IS the USA, Canada, or Mexico playing in their own country.
${predictionLine}

RECAP RULES (override preview rules for this article):
- Report what happened and why — result, key moments, tactical explanation
${previewSlug && priorPrediction ? `- Open with a "we predicted ${priorPrediction}, it finished ${homeScore}-${awayScore}" callback — be honest about whether you were right` : ''}
- No predicted score section
- No "predict on Foreshot" framing — the match is over
- Same voice, same 500-700 word target

Return ONLY raw JSON (no markdown fences) with this exact shape:
{
  "headline": "result-first past-tense headline",
  "metaLine": "one-sentence SEO description under 160 chars",
  "paragraphs": [
    {"type": "p",  "text": "opening${previewSlug ? ' — include the prediction callback here' : ''}"},
    {"type": "h2", "text": "heading for the dominant/winning side"},
    {"type": "p",  "text": "body"},
    {"type": "h2", "text": "heading for the other side"},
    {"type": "p",  "text": "body"},
    {"type": "h2", "text": "Why It Went This Way"},
    {"type": "p",  "text": "tactical explanation"},
    {"type": "p",  "text": "closing — what this means for the group"}
  ],
  "pullQuote": "punchy one-liner about the match"
}`;

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

function buildRecapHTML(match, content, previewSlug, priorPrediction, livePosts) {
  const homeName   = match.homeTeam.name;
  const awayName   = match.awayTeam.name;
  const homeScore  = match.score.fullTime.home;
  const awayScore  = match.score.fullTime.away;
  const recapSlug  = `${matchSlug(homeName, awayName)}-recap`;
  const fixtureName = `${homeName} vs ${awayName}`;
  const kickoff    = new Date(match.utcDate);
  const dateLabel  = toEasternLongDate(kickoff);
  const groupLabel = match.group ? `Group ${match.group.replace('GROUP_', '')}` : 'Group Stage';

  const backlinkHTML = buildPreviewBacklinkHTML(previewSlug, fixtureName, priorPrediction);

  let bodyHTML = '';
  for (const block of content.paragraphs) {
    if (block.type === 'h2') bodyHTML += `\n    <h2>${escHtml(block.text)}</h2>\n\n`;
    else                     bodyHTML += `    <p>${block.text}</p>\n\n`;
  }

  const relatedHTML = buildRelatedMatchesHTML(recapSlug, livePosts, groupLabel);

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
      <span class="nav-tag">World Cup 2026 · Match Reports</span>
      <a href="https://foreshot.net" class="nav-cta">Play on Foreshot →</a>
    </div>
  </div>
</nav>

<header class="article-header">
  <div class="wrap">
    <p class="article-eyebrow">${escHtml(groupLabel)} · Match Report</p>
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

    <div class="predict-box">
      <p class="label">Full-time result</p>
      <div class="score-row">
        <span class="team-name">${escHtml(homeName)}</span>
        <span class="digits">${homeScore}</span>
        <span style="font-family:var(--font-mono); color:var(--mist);">—</span>
        <span class="digits">${awayScore}</span>
        <span class="team-name">${escHtml(awayName)}</span>
      </div>
    </div>

${backlinkHTML}
${bodyHTML}
    <blockquote class="pull-quote">
      <span class="quote-mark">"</span>${content.pullQuote}<span class="quote-mark">"</span>
    </blockquote>

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
  const previewBySlug = new Map(
    livePosts.filter(p => p.type === 'preview').map(p => [p.slug, p])
  );
  const publishedSlugs = new Set(livePosts.map(p => p.slug));

  console.log('Fetching recently finished WC 2026 matches...');
  const { matches } = await footballGet('/competitions/WC/matches?status=FINISHED');

  const recent = (matches || []).filter(m => wasWithinLastDays(m.utcDate, 2));

  if (recent.length === 0) {
    console.log('No finished matches in the last 2 days.');
    return;
  }

  const toGenerate = [];

  for (const match of recent) {
    const homeName    = match.homeTeam.name;
    const awayName    = match.awayTeam.name;
    const previewSlug = matchSlug(homeName, awayName);
    const recapSlug   = `${previewSlug}-recap`;

    if (publishedSlugs.has(recapSlug)) {
      console.log(`  Skipping ${recapSlug} — already published`);
      continue;
    }
    if (fs.existsSync(path.join(DRAFTS_DIR, `${recapSlug}.html`))) {
      console.log(`  Skipping ${recapSlug} — draft already exists`);
      continue;
    }

    const preview = previewBySlug.get(previewSlug);

    if (preview) {
      toGenerate.push({ match, recapSlug, previewSlug, priorPrediction: preview.predictedScore });
    } else if (isRecapWorthy(match)) {
      toGenerate.push({ match, recapSlug, previewSlug: null, priorPrediction: null });
    } else {
      console.log(`  Skipping ${homeName} vs ${awayName} — not notable enough without a preview`);
    }
  }

  if (toGenerate.length === 0) {
    console.log('No recaps to generate.');
    return;
  }

  console.log(`\n${toGenerate.length} recap(s) to generate.\n`);

  const generated = [];
  const delay = ms => new Promise(res => setTimeout(res, ms));

  for (const [i, { match, recapSlug, previewSlug, priorPrediction }] of toGenerate.entries()) {
    const homeName = match.homeTeam.name;
    const awayName = match.awayTeam.name;
    const score    = `${match.score.fullTime.home}-${match.score.fullTime.away}`;

    if (i > 0) {
      console.log('  Waiting 5s (free-tier rate limit)...');
      await delay(5000);
    }

    console.log(`Generating recap: ${homeName} vs ${awayName} (${score})...`);

    try {
      const content = await generateRecapContent(match, previewSlug, priorPrediction);
      const html    = buildRecapHTML(match, content, previewSlug, priorPrediction, livePosts);

      fs.writeFileSync(path.join(DRAFTS_DIR, `${recapSlug}.html`), html, 'utf-8');

      const kickoff    = new Date(match.utcDate);
      const groupLabel = match.group ? `Group ${match.group.replace('GROUP_', '')}` : 'Group Stage';

      const meta = {
        slug:        recapSlug,
        group:       groupLabel,
        date:        toEasternDate(kickoff),
        dateLabel:   toEasternDateLabel(kickoff),
        fixture:     `${homeName} vs ${awayName}`,
        hook:        content.metaLine,
        result:      score,
        type:        'recap',
        featured:    false,
        venue:       match.venue || '',
        ...(previewSlug && { previewSlug }),
      };
      fs.writeFileSync(path.join(DRAFTS_DIR, `${recapSlug}.meta.json`), JSON.stringify(meta, null, 2), 'utf-8');

      generated.push({ slug: recapSlug, headline: content.headline });
      console.log(`  Saved → drafts/${recapSlug}.html`);
    } catch (err) {
      console.error(`  Failed for ${recapSlug}:`, err.message);
    }
  }

  if (generated.length) {
    console.log('\n--- Drafts ---');
    generated.forEach(({ slug, headline }) => console.log(`  ${slug} — "${headline}"`));
    console.log('\nReview, then: node scripts/publish.js <slug>');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
