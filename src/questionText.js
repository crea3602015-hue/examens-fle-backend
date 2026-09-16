// Version texte simple des réponses/bonnes réponses, pour les exports
// PDF/Excel (pas d'images ni de mise en forme riche possible côté serveur).

function describeCorrectText(q) {
  switch (q.type) {
    case 'choix_unique': return (q.options || [])[q.correct] ?? '—';
    case 'choix_multiple': return (q.correct || []).map(i => (q.options || [])[i]).join(', ') || '—';
    case 'vrai_faux': return q.correct ? 'Vrai' : 'Faux';
    case 'texte_court': return q.correct || '—';
    case 'texte_trous': return q.correct || '—';
    case 'association': return (q.pairs || []).map(p => `${p.left} → ${p.right}`).join(' ; ') || '—';
    case 'classement': return (q.items || []).join(' → ') || '—';
    case 'image_choix': return (q.options || [])[q.correct]?.label || (q.options || [])[q.correct]?.image || '—';
    case 'association_images': return (q.pairs || []).map(p => `${p.left.label || p.left.image} → ${p.right.label || p.right.image}`).join(' ; ') || '—';
    default: return '—';
  }
}

function formatGivenText(q, given) {
  if (given === undefined || given === null || given === '') return '(sans réponse)';
  switch (q.type) {
    case 'choix_unique': return (q.options || [])[given] ?? String(given);
    case 'choix_multiple': return (given || []).map(i => (q.options || [])[i]).join(', ');
    case 'vrai_faux': return given ? 'Vrai' : 'Faux';
    case 'association': return Object.entries(given || {}).map(([l, r]) => `${l} → ${r}`).join(' ; ') || '(sans réponse)';
    case 'classement': return (given || []).join(' → ');
    case 'image_choix': { const o = (q.options || [])[given]; return o ? (o.label || o.image) : String(given); }
    case 'association_images': {
      const g = given || {};
      return (q.pairs || []).map(p => {
        const matched = (q.pairs || []).find(pp => pp.id === g[p.id]);
        return `${p.left.label || p.left.image || ''} → ${matched ? (matched.right.label || matched.right.image) : '—'}`;
      }).join(' ; ') || '(sans réponse)';
    }
    case 'dessin': return given ? '(dessin fourni)' : '(pas de dessin)';
    default: return String(given);
  }
}

const MANUAL_TYPES = ['texte_long', 'correction_manuelle', 'dessin', 'production_orale'];

/** Builds the {enonce, detail, isCorrect} rows for one section, for the exports. */
function describeSectionQuestions(sec, reponses, autoDetail, manualScores, oralNote) {
  return sec.questions.map(q => {
    const given = reponses[q.id];
    if (q.type === 'production_orale') {
      return { enonce: q.enonce || 'Production orale', detail: `Note manuelle : ${oralNote ?? '—'}/${q.points}`, isCorrect: null };
    }
    if (MANUAL_TYPES.includes(q.type)) {
      const pts = manualScores ? manualScores[q.id] : undefined;
      return { enonce: q.enonce, detail: `Réponse : ${formatGivenText(q, given)} — Points : ${pts !== undefined && pts !== null ? pts : '—'}/${q.points}`, isCorrect: null };
    }
    const auto = autoDetail ? autoDetail[q.id] : null;
    return {
      enonce: q.enonce,
      detail: `Réponse : ${formatGivenText(q, given)} — Bonne réponse : ${describeCorrectText(q)} (${auto ? auto.points : 0}/${q.points})`,
      isCorrect: auto ? auto.correct : null,
    };
  });
}

module.exports = { describeCorrectText, formatGivenText, describeSectionQuestions };
