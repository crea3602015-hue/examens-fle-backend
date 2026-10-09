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
const HEADINGS_ES = {
  'Sujet / Thème': 'TEMAS', 'Grammaire': 'GRAMÁTICA', 'Verbes': 'VERBOS', 'Verbes / Conjugaison': 'VERBOS', 'Lexique / Vocabulaire': 'VOCABULARIO', 'Lecture': 'LECTURA', 'Chanson': 'CANCIONES',
  'Compréhension orale': 'COMPRENSIÓN ORAL', 'Compréhension écrite': 'COMPRENSIÓN ESCRITA', 'Production orale': 'EXPRESIÓN ORAL', 'Production écrite': 'EXPRESIÓN ESCRITA', 'Culture / Civilisation': 'CULTURA Y CIVILIZACIÓN',
  'Notion scientifique': 'NOCIONES CIENTÍFICAS', 'Vocabulaire scientifique': 'VOCABULARIO CIENTÍFICO', 'Lecture / Document': 'LECTURA Y DOCUMENTOS', 'Expérience': 'EXPERIMENTOS', 'Schéma / Graphique': 'ESQUEMAS Y GRÁFICOS',
  'Définition / Concept': 'DEFINICIONES Y CONCEPTOS', 'Exercices': 'EJERCICIOS', 'Vidéo': 'VIDEOS', 'Document': 'DOCUMENTOS', 'Autre': 'OTROS CONTENIDOS',
};
const HEADINGS_EN = {
  'Sujet / Thème': 'TOPICS', 'Grammaire': 'GRAMMAR', 'Verbes': 'VERBS', 'Verbes / Conjugaison': 'VERBS', 'Lexique / Vocabulaire': 'VOCABULARY', 'Lecture': 'READING', 'Chanson': 'SONGS',
  'Compréhension orale': 'LISTENING COMPREHENSION', 'Compréhension écrite': 'READING COMPREHENSION', 'Production orale': 'SPEAKING', 'Production écrite': 'WRITING', 'Culture / Civilisation': 'CULTURE AND CIVILIZATION',
  'Notion scientifique': 'SCIENTIFIC CONCEPTS', 'Vocabulaire scientifique': 'SCIENTIFIC VOCABULARY', 'Lecture / Document': 'READINGS AND DOCUMENTS', 'Expérience': 'EXPERIMENTS', 'Schéma / Graphique': 'DIAGRAMS AND GRAPHS',
  'Définition / Concept': 'DEFINITIONS AND CONCEPTS', 'Exercices': 'EXERCISES', 'Vidéo': 'VIDEOS', 'Document': 'DOCUMENTS', 'Autre': 'OTHER CONTENT',
};
const LANGS = ['fr', 'es', 'en'];
const L10N = {
  fr: { headings: HEADINGS, guide: 'GUIDE DE RÉVISION D\'EXAMEN', appr: 'APPRENTISSAGES ATTENDUS', exam: 'Examen trimestriel', teacher: 'Enseignant', group: 'Groupe', level: 'niveau', suite: '(suite)',
    thSubject: 'Sujet ou notion', thKnow: 'Ce que je dois savoir', thDo: 'Ce que je dois savoir faire', thRes: 'Pour réviser', thContent: 'Contenu', thLearn: 'Apprentissage attendu',
    book: 'Livre', workbook: 'Cahier', workbookFull: 'Cahier d\'activités', video: 'Vidéo de révision', toVideo: 'Accéder à la vidéo', link: 'Lien internet', toLink: 'Accéder au lien', doc: 'Document', docDefault: 'Document à consulter',
    ex: 'Exercices', exDefault: 'Exercices à revoir', page: 'page', pages: (d, f) => `pages ${d} à ${f}` },
  es: { headings: HEADINGS_ES, guide: 'GUÍA DE REPASO DEL EXAMEN', appr: 'APRENDIZAJES ESPERADOS', exam: 'Examen trimestral', teacher: 'Docente', group: 'Grupo', level: 'nivel', suite: '(continuación)',
    thSubject: 'Tema o noción', thKnow: 'Lo que debo saber', thDo: 'Lo que debo saber hacer', thRes: 'Para repasar', thContent: 'Contenido', thLearn: 'Aprendizaje esperado',
    book: 'Libro', workbook: 'Cuaderno', workbookFull: 'Cuaderno de actividades', video: 'Video de repaso', toVideo: 'Ver el video', link: 'Enlace de internet', toLink: 'Abrir el enlace', doc: 'Documento', docDefault: 'Documento por consultar',
    ex: 'Ejercicios', exDefault: 'Ejercicios por repasar', page: 'página', pages: (d, f) => `páginas ${d} a ${f}` },
  en: { headings: HEADINGS_EN, guide: 'EXAM REVISION GUIDE', appr: 'EXPECTED LEARNING OUTCOMES', exam: 'Term exam', teacher: 'Teacher', group: 'Group', level: 'level', suite: '(continued)',
    thSubject: 'Topic or concept', thKnow: 'What I must know', thDo: 'What I must be able to do', thRes: 'To revise', thContent: 'Content', thLearn: 'Expected learning outcome',
    book: 'Book', workbook: 'Workbook', workbookFull: 'Activity workbook', video: 'Revision video', toVideo: 'Watch the video', link: 'Web link', toLink: 'Open the link', doc: 'Document', docDefault: 'Document to read',
    ex: 'Exercises', exDefault: 'Exercises to review', page: 'page', pages: (d, f) => `pages ${d} to ${f}` },
};

const { noDash } = require('./text');
/** Texte court (titres, en-têtes) : sans grands tirets, sans espaces en trop. */
const t = v => noDash(v).trim();
/** Texte libre saisi dans un tableau : on garde les lignes vides et les retraits voulus par l'utilisateur. */
const tx = v => noDash(v).replace(/\r/g, '').replace(/\u00a0/g, ' ').replace(/[ \t]+$/gm, '').replace(/^\n+/, '').replace(/\n{4,}/g, '\n\n\n').replace(/\s+$/, m => (m.includes('\n') ? '\n'.repeat(Math.min(2, (m.match(/\n/g) || []).length)) : ''));

/** Valeur d'un champ dans une langue : traduction si elle existe, sinon l'original français. */
function fieldOf(x, f, lang) {
  if (lang && lang !== 'fr') { const tr = x.tr && x.tr[lang]; if (tr && tr[f] != null && String(tr[f]).trim() !== '') return tr[f]; }
  return x[f];
}
const infoOf = (info, trInfo, lang, k) => (lang !== 'fr' && trInfo && trInfo[lang] && trInfo[lang][k]) ? trInfo[lang][k] : info[k];

function pagesText(debut, fin, Ln = L10N.fr) {
  const d = t(debut), f = t(fin);
  if (d && f && d !== f) return Ln.pages(d, f);
  if (d || f) return `${Ln.page} ${d || f}`;
  return '';
}

/** Lignes "Pour réviser" d'une ressource : uniquement les informations fournies. */
function resourceLines(r, Ln = L10N.fr) {
  const out = []; // {text, link?, note?}
  const join = parts => parts.map(t).filter(Boolean).join(', ');
  const url = t(r.url), com = t(r.commentaire);
  switch (r.type) {
    case 'livre': { const s = join([r.titre, r.chapitre, pagesText(r.debut, r.fin, Ln)]); out.push({ text: s ? `${Ln.book} : ${s}` : Ln.book }); break; }
    case 'cahier': { const s = join([r.titre, r.chapitre, pagesText(r.debut, r.fin, Ln)]); out.push({ text: s ? `${Ln.workbook} : ${s}` : Ln.workbookFull }); break; }
    case 'video': out.push({ text: t(r.titre) || Ln.video }); if (url) out.push({ text: Ln.toVideo, link: url }); break;
    case 'lien': out.push({ text: t(r.titre) || Ln.link }); if (url) out.push({ text: Ln.toLink, link: url }); break;
    case 'document': out.push({ text: t(r.titre) ? `${Ln.doc} : ${t(r.titre)}` : Ln.docDefault }); break;
    case 'exercice': out.push({ text: t(r.titre) ? `${Ln.ex} : ${t(r.titre)}` : Ln.exDefault }); break;
    default: if (t(r.titre)) out.push({ text: t(r.titre) });
  }
  if (com && out.length) out.splice(1, 0, { text: com, note: true });
  return out;
}

function headerLine(info, type, trInfo, lang, Ln) {
  const g = k => t(infoOf(info, trInfo, lang, k));
  const niveau = [g('classe'), g('section') && !g('classe') ? g('section') : ''].filter(Boolean).join(' ');
  const l2 = [g('matiere'), niveau].filter(Boolean).join(', ');
  return { l2: l2 + (t(info.niveauLinguistique) ? `, ${Ln.level} ${t(info.niveauLinguistique)}` : ''), l3: [g('periode'), g('annee')].filter(Boolean).join(', ') };
}


const FILL_HEAD = [0.08, 0.13, 0.24], FILL_BAND = [0.90, 0.93, 0.97], WHITE = [1, 1, 1];

/** Corps du document sous forme de tableau (même contenu, mêmes règles : rien n'est inventé).
 *  Chaque ligne porte une « ref » : c'est ce qui permet de modifier le texte directement sur la feuille. */
function buildTable(doc, P, lang, Ln) {
  const items = doc.data.items || [];
  const guide = doc.type === 'guide';
  const pre = lang === 'fr' ? '' : `tr.${lang}.`;
  const it = (text, o = {}) => ({ text, size: P.body, color: P.ink, ...o });
  const fv = (x, f) => tx(fieldOf(x, f, lang));
  const head = c => HEAD(Ln, c);
  if (!guide) {
    const order = [], groups = {};
    items.forEach(x => { const c = t(x.categorie) || 'Autre'; if (!groups[c]) { groups[c] = []; order.push(c); } groups[c].push(x); });
    const rows = [];
    order.forEach(c => {
      const list = groups[c].filter(x => fv(x, 'nom').trim() || fv(x, 'texte').trim());
      if (!list.length) return; // une rubrique vide disparaît
      rows.push({ type: 'cat', cells: [[it(head(c), { bold: true, color: P.navy, size: P.label + 1 })]] });
      list.forEach(x => rows.push({ type: 'row', ref: { id: x.id, fields: [pre + 'nom', pre + 'texte'], raw: [fv(x, 'nom'), fv(x, 'texte')] }, cells: [[it(fv(x, 'nom'), { bold: true })], [it(fv(x, 'texte'))]] }));
    });
    return { cols: [0.34, 0.66], titles: [Ln.thContent, Ln.thLearn], rows };
  }
  const GENERIC = new Set(['', 'Sujet / Thème', 'Autre', 'Notion', 'Sujets']);
  const resText = x => { const libre = tx(fieldOf(x, 'resLibre', lang)); return libre.trim() ? libre : null; };
  const lines = x => resText(x) != null ? resText(x).split('\n').map(text => ({ text })) : (x.ressources || []).flatMap(r => resourceLines(r, Ln));
  const rawRes = x => resText(x) != null ? resText(x) : lines(x).map(l => l.text).join('\n');
  const kept = items.filter(x => fv(x, 'nom').trim() || fv(x, 'savoir').trim() || fv(x, 'savoirFaire').trim() || lines(x).length);
  // Une colonne entièrement vide disparaît : la feuille reste pleine, sans trou.
  const hasSav = kept.some(x => fv(x, 'savoir').trim()), hasSf = kept.some(x => fv(x, 'savoirFaire').trim()), hasRes = kept.some(x => lines(x).length);
  const colDefs = [{ title: Ln.thSubject, w: 2, on: true }, { title: Ln.thKnow, w: 3, on: hasSav }, { title: Ln.thDo, w: 3, on: hasSf }, { title: Ln.thRes, w: 2.4, on: hasRes }].filter(c => c.on);
  const sum = colDefs.reduce((a, c) => a + c.w, 0);
  const rows = [];
  let lastCat = null;
  kept.forEach(x => {
    const cat = t(x.categorie);
    if (cat !== lastCat) {
      lastCat = cat;
      if (!GENERIC.has(cat)) rows.push({ type: 'cat', cells: [[it(head(cat), { bold: true, color: P.navy, size: P.label + 1 })]] });
    }
    const cells = [[it(fv(x, 'nom'), { bold: true, color: P.navy })]], fields = [pre + 'nom'], raw = [fv(x, 'nom')];
    if (hasSav) { cells.push([it(fv(x, 'savoir'))]); fields.push(pre + 'savoir'); raw.push(fv(x, 'savoir')); }
    if (hasSf) { cells.push([it(fv(x, 'savoirFaire'))]); fields.push(pre + 'savoirFaire'); raw.push(fv(x, 'savoirFaire')); }
    if (hasRes) {
      cells.push(resText(x) != null ? lines(x).map(l => it(l.text)) : lines(x).map(l => l.link ? it(l.text, { link: l.link, color: P.link }) : it(l.text, { italic: !!l.note, color: l.note ? P.gray : P.ink, size: l.note ? P.body - 0.5 : P.body })));
      fields.push(pre + 'resLibre'); raw.push(rawRes(x));
    }
    rows.push({ type: 'row', ref: { id: x.id, fields, raw }, cells });
  });
  return { cols: colDefs.map(c => c.w / sum), titles: colDefs.map(c => c.title), rows };
}
const HEAD = (Ln, c) => (Ln.headings[c] || String(c).toUpperCase());

/** profile : tailles de base (en points) selon la version ; lang : 'fr' | 'es' | 'en'. */
function buildBlocks(doc, P) {
  const lang = LANGS.includes(doc.lang) ? doc.lang : 'fr', Ln = L10N[lang];
  const info = doc.data.info || {}, items = doc.data.items || [], trInfo = doc.data.trInfo || {};
  const guide = doc.type === 'guide';
  const fv = (x, f) => tx(fieldOf(x, f, lang));
  const hl = headerLine(info, doc.type, trInfo, lang, Ln);
  const B = [];
  B.push({ kind: 'title', text: guide ? Ln.guide : Ln.appr, size: P.title, bold: true, color: P.navy, header: true, after: 3, suite: Ln.suite });
  if (hl.l2) B.push({ kind: 'subtitle', text: hl.l2, size: P.subtitle, bold: true, color: P.ink, header: true, after: 2 });
  if (hl.l3) B.push({ kind: 'meta2', text: hl.l3, size: P.subtitle - 1, color: P.ink, header: true, after: 2 });
  if (guide) { const exFr = t(info.examenLabel) || 'Examen trimestriel', exTr = t(trInfo[lang] && trInfo[lang].examenLabel); B.push({ kind: 'meta2', text: lang === 'fr' ? exFr : (exTr || (exFr === 'Examen trimestriel' ? Ln.exam : exFr)), size: P.subtitle - 1, color: P.ink, header: true, after: 2 }); }
  const who = [t(info.enseignant) && `${Ln.teacher} : ${t(info.enseignant)}`, t(info.groupe) && `${Ln.group} : ${t(info.groupe)}`].filter(Boolean).join('    ');
  if (who) B.push({ kind: 'meta', text: who, size: P.meta, color: P.gray, header: true, after: 2 });
  B.push({ kind: 'rule', size: 1, color: P.navy, before: 4, after: 6 });

  if (doc.data.presentation !== 'liste') {
    B.push({ kind: 'table', table: buildTable(doc, P, lang, Ln) });
    return B;
  }
  const pre = lang === 'fr' ? '' : `tr.${lang}.`;
  if (!guide) {
    // Rubriques regroupées ; une rubrique sans élément disparaît automatiquement.
    const order = [], groups = {};
    items.forEach(x => { const c = t(x.categorie) || 'Autre'; if (!groups[c]) { groups[c] = []; order.push(c); } groups[c].push(x); });
    order.forEach(c => {
      const list = groups[c].filter(x => fv(x, 'nom').trim() || fv(x, 'texte').trim());
      if (!list.length) return;
      B.push({ kind: 'cat', text: HEAD(Ln, c), size: P.cat, bold: true, color: P.navy, before: 7, after: 2, keep: true });
      list.forEach(x => {
        if (fv(x, 'nom').trim()) B.push({ kind: 'item', text: fv(x, 'nom'), size: P.item, bold: true, color: P.ink, before: 3, after: 1, keep: !!fv(x, 'texte').trim(), ref: { id: x.id, fields: [pre + 'nom'], raw: [fv(x, 'nom')] } });
        if (fv(x, 'texte').trim()) B.push({ kind: 'para', text: fv(x, 'texte'), size: P.body, color: P.ink, after: 2, ref: { id: x.id, fields: [pre + 'texte'], raw: [fv(x, 'texte')] } });
      });
    });
  } else {
    items.forEach(x => {
      const head = [(t(x.categorie) || '').split(' / ')[0].toUpperCase(), fv(x, 'nom').trim().toUpperCase()].filter(Boolean).join(', ');
      const lines = (x.ressources || []).flatMap(r => resourceLines(r, Ln));
      if (!head && !fv(x, 'savoir').trim() && !fv(x, 'savoirFaire').trim() && !lines.length) return;
      B.push({ kind: 'cat', text: head, size: P.cat, bold: true, color: P.navy, before: 8, after: 2, keep: true });
      if (fv(x, 'savoir').trim()) { B.push({ kind: 'label', text: Ln.thKnow, size: P.label, bold: true, color: P.gray, before: 2, after: 0, keep: true }); B.push({ kind: 'para', text: fv(x, 'savoir'), size: P.body, color: P.ink, after: 2, ref: { id: x.id, fields: [pre + 'savoir'], raw: [fv(x, 'savoir')] } }); }
      if (fv(x, 'savoirFaire').trim()) { B.push({ kind: 'label', text: Ln.thDo, size: P.label, bold: true, color: P.gray, before: 2, after: 0, keep: true }); B.push({ kind: 'para', text: fv(x, 'savoirFaire'), size: P.body, color: P.ink, after: 2, ref: { id: x.id, fields: [pre + 'savoirFaire'], raw: [fv(x, 'savoirFaire')] } }); }
      if (lines.length) {
        B.push({ kind: 'label', text: Ln.thRes, size: P.label, bold: true, color: P.gray, before: 2, after: 0, keep: true });
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

module.exports = { buildBlocks, PROFILES, HEADINGS, L10N, LANGS, resourceLines, pagesText, FILL_HEAD, FILL_BAND, WHITE };
