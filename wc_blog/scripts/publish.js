'use strict';

/**
 * publish.js — promote a reviewed draft to a live post and rebuild the sitemap.
 *
 * Manual (one slug):
 *   node scripts/publish.js brazil-vs-haiti
 *
 * CI batch mode (all drafts, used by the GitHub Actions workflow):
 *   node scripts/publish.js --all --stage-only
 *
 * --stage-only suppresses the git reminder — the Action's create-pull-request
 * step handles the commit.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const { generateSitemap } = require('./generate-sitemap');

const ROOT       = path.join(__dirname, '..');
const DRAFTS_DIR = path.join(ROOT, 'drafts');
const POSTS_DIR  = path.join(ROOT, 'posts');
const POSTS_JSON = path.join(ROOT, 'posts.json');

const args      = process.argv.slice(2);
const allMode   = args.includes('--all');
const stageOnly = args.includes('--stage-only');
const slug      = args.find(a => !a.startsWith('--'));

// ── validation ────────────────────────────────────────────────────────────────

if (!allMode && !slug) {
  console.error('Usage:');
  console.error('  node scripts/publish.js <slug>');
  console.error('  node scripts/publish.js --all --stage-only');
  process.exit(1);
}

// ── core: publish one draft ───────────────────────────────────────────────────

function publishOne(targetSlug, posts) {
  const draftHTML = path.join(DRAFTS_DIR, `${targetSlug}.html`);
  const draftMeta = path.join(DRAFTS_DIR, `${targetSlug}.meta.json`);
  const liveHTML  = path.join(POSTS_DIR,  `${targetSlug}.html`);

  if (!fs.existsSync(draftHTML)) {
    console.error(`  Draft not found: drafts/${targetSlug}.html`);
    return false;
  }
  if (!fs.existsSync(draftMeta)) {
    console.error(`  Metadata missing: drafts/${targetSlug}.meta.json`);
    return false;
  }
  if (fs.existsSync(liveHTML)) {
    console.error(`  Already live: posts/${targetSlug}.html — delete it first to overwrite`);
    return false;
  }
  if (posts.some(p => p.slug === targetSlug)) {
    console.error(`  "${targetSlug}" already exists in posts.json`);
    return false;
  }

  const meta = JSON.parse(fs.readFileSync(draftMeta, 'utf-8'));

  if (!fs.existsSync(POSTS_DIR)) fs.mkdirSync(POSTS_DIR, { recursive: true });

  fs.copyFileSync(draftHTML, liveHTML);
  fs.unlinkSync(draftHTML);
  fs.unlinkSync(draftMeta);

  const entry = {
    slug:       meta.slug,
    group:      meta.group,
    date:       meta.date,
    dateLabel:  meta.dateLabel,
    fixture:    meta.fixture,
    hook:       meta.hook,
    type:       meta.type,
    featured:   meta.featured ?? false,
    ...(meta.predictedScore && { predictedScore: meta.predictedScore }),
    ...(meta.result          && { result:         meta.result }),
    ...(meta.venue           && { venue:           meta.venue }),
    ...(meta.kickoffLabel    && { kickoffLabel:    meta.kickoffLabel }),
    ...(meta.previewSlug     && { previewSlug:     meta.previewSlug }),
  };

  // Newest first
  posts.unshift(entry);

  console.log(`  Published: drafts/${targetSlug}.html → posts/${targetSlug}.html`);
  return true;
}

// ── main ──────────────────────────────────────────────────────────────────────

const posts = JSON.parse(fs.readFileSync(POSTS_JSON, 'utf-8'));

if (allMode) {
  const drafts = fs.readdirSync(DRAFTS_DIR)
    .filter(f => f.endsWith('.html') && f !== '.gitkeep')
    .map(f => f.replace('.html', ''));

  if (drafts.length === 0) {
    console.log('No drafts to publish.');
    process.exit(0);
  }

  console.log(`Publishing ${drafts.length} draft(s)...`);
  let ok = 0;
  for (const s of drafts) {
    if (publishOne(s, posts)) ok++;
  }

  if (ok > 0) {
    fs.writeFileSync(POSTS_JSON, JSON.stringify(posts, null, 2) + '\n', 'utf-8');
    const count = generateSitemap();
    console.log(`\nposts.json updated (${ok} added). sitemap.xml rebuilt (${count} total).`);
  }

  if (!stageOnly) {
    console.log('\nDone. Commit and push:\n  git add . && git commit -m "publish: batch" && git push');
  }
} else {
  // Single-slug mode
  const ok = publishOne(slug, posts);
  if (!ok) process.exit(1);

  fs.writeFileSync(POSTS_JSON, JSON.stringify(posts, null, 2) + '\n', 'utf-8');
  const count = generateSitemap();

  console.log(`posts.json updated. sitemap.xml rebuilt (${count} total).`);

  if (!stageOnly) {
    console.log(`
Done. Commit and push:
  git add posts/${slug}.html posts.json sitemap.xml
  git commit -m "publish: ${posts[0].fixture} ${posts[0].type}"
  git push`);
  }
}
