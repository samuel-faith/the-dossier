'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..');
const POSTS_JSON = path.join(ROOT, 'posts.json');
const SITEMAP    = path.join(ROOT, 'sitemap.xml');

const SITE_URL = (process.env.SITE_URL || 'https://dossier.foreshot.net').replace(/\/$/, '');

function generateSitemap() {
  const posts = JSON.parse(fs.readFileSync(POSTS_JSON, 'utf-8'));
  const today = new Date().toISOString().slice(0, 10);

  const postEntries = posts
    .map(p => `
  <url>
    <loc>${SITE_URL}/posts/${p.slug}.html</loc>
    <lastmod>${p.date || today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${p.featured ? '0.9' : '0.7'}</priority>
  </url>`)
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>${postEntries}
</urlset>`;

  fs.writeFileSync(SITEMAP, xml, 'utf-8');
  return posts.length;
}

// Callable as a module (from publish.js) or directly
if (require.main === module) {
  const count = generateSitemap();
  console.log(`sitemap.xml updated — ${count} post(s) listed`);
}

module.exports = { generateSitemap };
