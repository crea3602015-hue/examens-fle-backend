// Bandes de couleur pour les notes, cohérentes partout dans l'application :
//   0–60  → rouge
//   61–80 → orange
//   81–100 → vert

function scoreColorHex(pct) {
  if (pct === null || pct === undefined) return '#9AA3B2'; // gris — pas encore corrigé
  if (pct <= 60) return '#B3261E';
  if (pct <= 80) return '#D97706';
  return '#2F7D46';
}

// Même couleur, au format ARGB attendu par exceljs (avec canal alpha FF).
function scoreColorArgb(pct) {
  return 'FF' + scoreColorHex(pct).replace('#', '').toUpperCase();
}

function scoreLabel(pct) {
  if (pct === null || pct === undefined) return 'Non corrigé';
  return pct >= 50 ? 'Réussi' : 'Échec';
}

module.exports = { scoreColorHex, scoreColorArgb, scoreLabel };
