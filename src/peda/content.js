// Construit la liste de "blocs" typographiques d'un document pédagogique à partir de ses données.
// Aucune ressource (page, lien, vidéo...) n'est jamais inventée : tout vient de ce que l'utilisateur a saisi.

const HEADINGS = {
  'Sujet / Thème': 'SUJETS', 'Grammaire': 'GRAMMAIRE', 'Verbes': 'VERBES', 'Verbes / Conjugaison': 'VERBES',
  'Lexique / Vocabulaire': 'LEXIQUE', 'Lecture': 'LECTURE', 'Chanson': 'CHANSONS',
  'Compréhension orale': 'COMPRÉHENSION ORALE', 'Compréhension écrite': 'COMPRÉHENSION ÉCRITE',
  'Production orale': 'PRODUCTION ORALE', 'Production écrite': 'PRODUCTION ÉCRITE', 'Culture / Civilisation': 'CULTURE ET CIVILISATION',
  'Notion scientifique': 'NOTIONS SCIENTIFIQUES', 'Vocabulaire scientifique': 'VOCABULAIRE SCIENTIFIQUE',
  'Lecture / Document': 'LECTURE ET DOCUMENTS', 'Expérience': 'EXPÉRIENCES', 'Schéma / Graphique': 'SCHÉMAS ET GRAPHIQUES',
  'Définition / Concept': 'DÉFINITIONS ET CONCEPTS', 'Exercices': 'EXERCICES', 'Vidéo': 'VIDÉOS', 'Document': 'DOCUMENTS', 'Autre': 'AUTRES CONTENUS',
};

const t = v => String(v == null ? '' : v).trim();

function pagesText(debut, fin) {
  const d = t(debut), f = t(fin);
  if (d && f && d !== f) return `pages ${d} à ${f}`;
  if (d || f) return `page ${d || f}`;
  return '';
}

/** Lignes "Pour réviser" d'une ressource : uniquement les informations fournies. */
function resourceLines(r) {
  const out = []; // {text, link?, note?}
  const join = parts => parts.map(t).filter(Boolean).join(' — ');
  const url = t(r.url), com = t(r.commentaire);
  switch (r.type) {
    case 'livre': { const s = join([r.titre, r.chapitre, pagesText(r.debut, r.fin)]); out.push({ text: s ? `Livre : ${s}` : 'Livre' }); break; }
    case 'cahier': { const s = join([r.titre, r.chapitre, pagesText(r.debut, r.fin)]); out.push({ text: s ? `Cahier : ${s}` : 'Cahier d\'activités' }); break; }
    case 'video': out.push({ text: t(r.titre) || 'Vidéo de révision' }); if (url) out.push({ text: 'Accéder à la vidéo', link: url }); break;
    case 'lien': out.push({ text: t(r.titre) || 'Lien internet' }); if (url) out.push({ text: 'Accéder au lien', link: url }); break;
    case 'document': out.push({ text: t(r.titre) ? `Document : ${t(r.titre)}` : 'Document à consulter' }); break;
    case 'exercice': out.push({ text: t(r.titre) ? `Exercices : ${t(r.titre)}` : 'Exercices à revoir' }); break;
    default: if (t(r.titre)) out.push({ text: t(r.titre) });
  }
  if (com && out.length) out.splice(r.type === 'video' || r.type === 'lien' ? 1 : 1, 0, { text: com, note: true });
  return out;
}

function headerLine(info, type) {
  const niveau = [t(info.classe), t(info.section) && !t(info.classe) ? t(info.section) : ''].filter(Boolean).join(' ');
  const l2 = [t(info.matiere), niveau].filter(Boolean).join(' — ');
  return { l2: l2 + (t(info.niveauLinguistique) ? ` — Niveau ${t(info.niveauLinguistique)}` : ''), l3: [t(info.periode), t(info.annee)].filter(Boolean).join(' — ') };
}


const FILL_HEAD = [0.08, 0.13, 0.24], FILL_BAND = [0.90, 0.93, 0.97], WHITE = [1, 1, 1];

/** Corps du document sous forme de tableau (même contenu, mêmes règles : rien n'est inventé). */
function buildTable(doc, P) {
  const items = doc.data.items || [];
  const guide = doc.type === 'guide';
  const it = (text, o = {}) => ({ text, size: P.body, color: P.ink, ...o });
  if (!guide) {
    const order = [], groups = {};
    items.forEach(x => { const c = t(x.categorie) || 'Autre'; if (!groups[c]) { groups[c] = []; order.push(c); } groups[c].push(x); });
    const rows = [];
    order.forEach(c => {
      const list = groups[c].filter(x => t(x.nom) || t(x.texte));
      if (!list.length) return; // une rubrique vide disparaît
      rows.push({ type: 'cat', cells: [[it(HEADINGS[c] || c.toUpperCase(), { bold: true, color: P.navy, size: P.label + 1 })]] });
      list.forEach(x => rows.push({ type: 'row', cells: [[it(t(x.nom), { bold: true })], [it(t(x.texte))]] }));
    });
    return { cols: [0.34, 0.66], titles: ['Contenu', 'Apprentissage attendu'], rows };
  }
  const rows = [];
  items.forEach(x => {
    const lines = (x.ressources || []).flatMap(resourceLines);
    if (!t(x.nom) && !t(x.savoir) && !t(x.savoirFaire) && !lines.length) return;
    rows.push({ type: 'row', cells: [
      [ ...(t(x.categorie) ? [it((HEADINGS[t(x.categorie)] || t(x.categorie)).toUpperCase(), { size: P.label - 1, color: P.gray, bold: true })] : []), it(t(x.nom), { bold: true }) ],
      [it(t(x.savoir))], [it(t(x.savoirFaire))],
      lines.map(l => l.link ? it(l.text, { link: l.link, color: P.link }) : it(l.text, { italic: !!l.note, color: l.note ? P.gray : P.ink, size: l.note ? P.body - 0.5 : P.body })),
    ] });
  });
  return { cols: [0.2, 0.27, 0.27, 0.26], titles: ['Sujet ou notion', 'Ce que je dois savoir', 'Ce que je dois savoir faire', 'Pour réviser'], rows };
}

/** profile : tailles de base (en points) selon la version. */
function buildBlocks(doc, P) {
  const info = doc.data.info || {}, items = doc.data.items || [];
  const guide = doc.type === 'guide';
  const hl = headerLine(info, doc.type);
  const B = [];
  B.push({ kind: 'title', text: guide ? 'GUIDE DE RÉVISION D\'EXAMEN' : 'APPRENTISSAGES ATTENDUS', size: P.title, bold: true, color: P.navy, header: true, after: 3 });
  if (hl.l2) B.push({ kind: 'subtitle', text: hl.l2, size: P.subtitle, bold: true, color: P.ink, header: true, after: 2 });
  if (hl.l3) B.push({ kind: 'meta2', text: hl.l3, size: P.subtitle - 1, color: P.ink, header: true, after: 2 });
  if (guide) B.push({ kind: 'meta2', text: t(info.examenLabel) || 'Examen trimestriel', size: P.subtitle - 1, color: P.ink, header: true, after: 2 });
  const who = [t(info.enseignant) && `Enseignant : ${t(info.enseignant)}`, t(info.groupe) && `Groupe : ${t(info.groupe)}`].filter(Boolean).join('    ');
  if (who) B.push({ kind: 'meta', text: who, size: P.meta, color: P.gray, header: true, after: 2 });
  B.push({ kind: 'rule', size: 1, color: P.navy, before: 4, after: 6 });

  if (doc.data.presentation !== 'liste') {
    B.push({ kind: 'table', table: buildTable(doc, P) });
    return B;
  }
  if (!guide) {
    // Rubriques regroupées ; une rubrique sans élément disparaît automatiquement.
    const order = [], groups = {};
    items.forEach(it => { const c = t(it.categorie) || 'Autre'; if (!groups[c]) { groups[c] = []; order.push(c); } groups[c].push(it); });
    order.forEach(c => {
      const list = groups[c].filter(it => t(it.nom) || t(it.texte));
      if (!list.length) return;
      B.push({ kind: 'cat', text: HEADINGS[c] || c.toUpperCase(), size: P.cat, bold: true, color: P.navy, before: 7, after: 2, keep: true });
      list.forEach(it => {
        if (t(it.nom)) B.push({ kind: 'item', text: t(it.nom), size: P.item, bold: true, color: P.ink, before: 3, after: 1, keep: !!t(it.texte) });
        if (t(it.texte)) B.push({ kind: 'para', text: t(it.texte), size: P.body, color: P.ink, after: 2 });
      });
    });
  } else {
    items.forEach(it => {
      const cat = HEADINGS[t(it.categorie)] ? t(it.categorie) : t(it.categorie);
      const head = [ (t(it.categorie) || '').split(' / ')[0].toUpperCase(), t(it.nom).toUpperCase() ].filter(Boolean).join(' — ');
      if (!head && !t(it.savoir) && !t(it.savoirFaire) && !(it.ressources || []).length) return;
      B.push({ kind: 'cat', text: head, size: P.cat, bold: true, color: P.navy, before: 8, after: 2, keep: true });
      if (t(it.savoir)) { B.push({ kind: 'label', text: 'Ce que je dois savoir', size: P.label, bold: true, color: P.gray, before: 2, after: 0, keep: true }); B.push({ kind: 'para', text: t(it.savoir), size: P.body, color: P.ink, after: 2 }); }
      if (t(it.savoirFaire)) { B.push({ kind: 'label', text: 'Ce que je dois savoir faire', size: P.label, bold: true, color: P.gray, before: 2, after: 0, keep: true }); B.push({ kind: 'para', text: t(it.savoirFaire), size: P.body, color: P.ink, after: 2 }); }
      const lines = (it.ressources || []).flatMap(resourceLines);
      if (lines.length) {
        B.push({ kind: 'label', text: 'Pour réviser', size: P.label, bold: true, color: P.gray, before: 2, after: 0, keep: true });
        lines.forEach(l => B.push(l.link
          ? { kind: 'link', text: l.text, link: l.link, size: P.body, color: P.link, indent: 8, after: 0 }
          : { kind: 'res', text: l.text, size: l.note ? P.body - 0.5 : P.body, italic: !!l.note, color: l.note ? P.gray : P.ink, indent: 8, after: 0 }));
      }
    });
  }
  return B;
}

const PROFILES = {
  parents: { navy: [0.08, 0.13, 0.24], ink: [0.12, 0.12, 0.14], gray: [0.38, 0.40, 0.45], link: [0.12, 0.35, 0.65],
    title: 20, subtitle: 12, meta: 9, cat: 12, item: 11, body: 10.5, label: 9.5,
    page: { w: 612, h: 792 }, margin: { l: 54, r: 54, t: 54, b: 54 }, frame: { w: 504, h: 684 }, logo: 62, minScale: 0.78, maxScale: 1.2, headerReserve: 76, copies: 1, padX: 5, padY: 4 },
  eleves: { navy: [0.08, 0.13, 0.24], ink: [0.12, 0.12, 0.14], gray: [0.38, 0.40, 0.45], link: [0.12, 0.35, 0.65],
    title: 14, subtitle: 9.5, meta: 7.5, cat: 9.5, item: 9, body: 8.5, label: 7.5,
    page: { w: 612, h: 396 }, margin: { l: 36, r: 36, t: 22, b: 18 }, frame: { w: 540, h: 352 }, logo: 40, minScale: 0.8, maxScale: 1.15, headerReserve: 52, copies: 2, padX: 3.5, padY: 2.5 },
};

module.exports = { buildBlocks, PROFILES, HEADINGS, resourceLines, pagesText, FILL_HEAD, FILL_BAND, WHITE };
