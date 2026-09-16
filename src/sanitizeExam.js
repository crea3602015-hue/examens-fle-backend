// Ne JAMAIS envoyer les réponses correctes au navigateur de l'élève avant la
// correction : cette fonction construit une copie de l'examen sans les champs
// sensibles (correct, textTemplate attendu, etc.) pour chaque type de question.

function sanitizeQuestion(q) {
  const base = { id: q.id, type: q.type, enonce: q.enonce, points: q.points, media: q.media, passage: q.passage };
  switch (q.type) {
    case 'choix_unique':
    case 'choix_multiple':
      return { ...base, options: q.options || [] };
    case 'image_choix':
      return { ...base, options: (q.options || []).map(o => ({ image: o.image, label: o.label })) };
    case 'vrai_faux':
      return base; // pas d'options à cacher, juste ne pas envoyer q.correct
    case 'texte_court':
      return base;
    case 'texte_trous': {
      // On envoie le gabarit du texte (avec ___) mais jamais q.correct.
      return { ...base, textTemplate: q.textTemplate || '' };
    }
    case 'association':
      // On envoie les libellés de gauche et une liste mélangée de droite,
      // jamais l'association correcte elle-même.
      return {
        ...base,
        pairs: (q.pairs || []).map(p => ({ left: p.left })),
        rightPool: (q.pairs || []).map(p => p.right),
      };
    case 'association_images':
      return {
        ...base,
        pairs: (q.pairs || []).map(p => ({ id: p.id, left: p.left })),
        rightPool: (q.pairs || []).map(p => ({ id: p.id, right: p.right })),
      };
    case 'classement':
      return { ...base, items: (q.items || []) }; // le frontend mélange lui-même à l'affichage
    case 'texte_long':
    case 'correction_manuelle':
    case 'production_orale':
    case 'dessin':
      return base;
    default:
      return base;
  }
}

function sanitizeExam(exam) {
  return {
    id: exam.id, titre: exam.titre, niveau: exam.niveau, navMode: exam.navMode,
    duree: exam.duree, autoriserReprise: exam.autoriserReprise,
    sections: (exam.sections || []).map(sec => ({
      id: sec.id, titre: sec.titre, questions: (sec.questions || []).map(sanitizeQuestion),
    })),
  };
}

module.exports = { sanitizeExam };
