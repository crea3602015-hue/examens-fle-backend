// Nettoyage du texte des documents : pas de grands tirets, pas de caractères invisibles.
function noDash(s) {
  return String(s == null ? '' : s)
    .replace(/[\uE000-\uF8FF\u200b-\u200f\u2028\u2029\u00ad\ufeff\ufe0f]/g, '')
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, '$1-$2')
    .replace(/^[ \t]*[\u2013\u2014][ \t]*/gm, '')
    .replace(/[ \t]*[\u2013\u2014][ \t]*/g, ', ')
    .replace(/,\s*,/g, ',');
}
module.exports = { noDash };
