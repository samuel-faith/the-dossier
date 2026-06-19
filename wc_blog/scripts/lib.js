'use strict';

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr(str) {
  return escHtml(str).replace(/"/g, '&quot;');
}

/**
 * Builds a "Related previews" section.
 * Same-group posts score higher; ties broken by most-recent date.
 * Returns empty string when fewer than 1 other post exists.
 */
function buildRelatedMatchesHTML(currentSlug, allPosts, currentGroup) {
  const others = allPosts.filter(p => p.slug !== currentSlug);
  if (others.length === 0) return '';

  const scored = others
    .map(p => ({ ...p, _s: p.group === currentGroup ? 10 : 0 }))
    .sort((a, b) => b._s - a._s || new Date(b.date) - new Date(a.date));

  const picks = scored.slice(0, 3);

  const items = picks
    .map(p => {
      const label = p.type === 'recap' ? 'Match report' : 'Preview';
      return `    <li><a href="../posts/${escAttr(p.slug)}.html">${escHtml(p.fixture)} — ${label}</a></li>`;
    })
    .join('\n');

  return `
<section class="related-posts wrap">
  <h3 class="related-posts__heading">Related previews</h3>
  <ul class="related-posts__list">
${items}
  </ul>
</section>
`;
}

/**
 * Builds the recap → preview backlink paragraph.
 * Returns empty string when previewSlug is falsy.
 */
function buildPreviewBacklinkHTML(previewSlug, fixtureName, predictedScore) {
  if (!previewSlug) return '';
  const scoreNote = predictedScore ? ` — we predicted ${escHtml(predictedScore)}` : '';
  return `    <p class="preview-backlink">Before kick-off: <a href="../posts/${escAttr(previewSlug)}.html">read our preview of ${escHtml(fixtureName)}</a>${scoreNote}.</p>\n`;
}

module.exports = { escHtml, escAttr, buildRelatedMatchesHTML, buildPreviewBacklinkHTML };
