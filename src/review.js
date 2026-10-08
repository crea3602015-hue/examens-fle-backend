// Circuit de relecture : l'administrateur assigne, le professeur valide ou demande des corrections,
// l'administrateur corrige puis réassigne. Statuts : assigné | validé | corrections | corrigé.
const t = v => String(v == null ? '' : v).trim().slice(0, 2000);
const notesOf = x => (Array.isArray(x) ? x : []);

/** Le professeur répond. Retourne les champs à enregistrer, ou { error }. */
function teacherReply(current, action, note) {
  const text = t(note);
  if (action === 'valider') {
    return { reviewStatus: 'validé', reviewNotes: text ? [...notesOf(current), { de: 'prof', texte: text, at: new Date().toISOString() }] : notesOf(current) };
  }
  if (action === 'corrections') {
    if (!text) return { error: 'Écrivez vos observations pour que l\'administrateur sache quoi corriger.' };
    return { reviewStatus: 'corrections', reviewNotes: [...notesOf(current), { de: 'prof', texte: text, at: new Date().toISOString() }] };
  }
  return { error: 'Action inconnue.' };
}

/** L'administrateur réassigne après corrections (ou assigne pour la première fois). */
function adminReassign(currentStatus, current, note) {
  const text = t(note);
  const status = currentStatus === 'corrections' || currentStatus === 'validé' ? 'corrigé' : 'assigné';
  return { reviewStatus: status, reviewNotes: text ? [...notesOf(current), { de: 'admin', texte: text, at: new Date().toISOString() }] : notesOf(current) };
}

module.exports = { teacherReply, adminReassign };
