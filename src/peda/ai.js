// Rédaction assistée par IA (Groq). L'IA ne rédige QUE les textes « apprentissage attendu » ou
// « ce que je dois savoir / savoir faire ». Les ressources (livres, pages, vidéos, liens, documents)
// ne lui sont jamais transmises : elles sont recopiées telles que saisies, l'IA ne peut donc rien inventer.

const { noDash } = require('./text');
const t = v => noDash(v).trim();

const FALLBACK_APPR = {
  'Sujet / Thème': n => `L'élève sera capable de comprendre et d'utiliser le vocabulaire et les expressions liés au thème : ${n}.`,
  'Grammaire': n => `L'élève sera capable d'identifier et d'utiliser correctement ${n} dans des phrases adaptées à son niveau.`,
  'Verbes': n => `L'élève sera capable de conjuguer et d'utiliser correctement les verbes suivants : ${n}.`,
  'Verbes / Conjugaison': n => `L'élève sera capable de conjuguer et d'utiliser correctement les verbes suivants : ${n}.`,
  'Lexique / Vocabulaire': n => `L'élève sera capable de comprendre, de retenir et de réutiliser le vocabulaire suivant : ${n}.`,
  'Lecture': n => `L'élève sera capable de lire et de comprendre le texte : ${n}.`,
  'Chanson': n => `L'élève sera capable de comprendre et de chanter : ${n}.`,
  'Compréhension orale': n => `L'élève sera capable de comprendre à l'oral : ${n}.`,
  'Compréhension écrite': n => `L'élève sera capable de comprendre à l'écrit : ${n}.`,
  'Production orale': n => `L'élève sera capable de s'exprimer à l'oral sur le sujet suivant : ${n}.`,
  'Production écrite': n => `L'élève sera capable de s'exprimer à l'écrit sur le sujet suivant : ${n}.`,
  'Culture / Civilisation': n => `L'élève sera capable de découvrir et de présenter des éléments de culture : ${n}.`,
  'Notion scientifique': n => `L'élève sera capable d'expliquer avec ses mots la notion suivante : ${n}.`,
  'Vocabulaire scientifique': n => `L'élève sera capable de définir et d'utiliser les mots scientifiques suivants : ${n}.`,
  'Lecture / Document': n => `L'élève sera capable de lire un document scientifique et d'en retirer les informations importantes : ${n}.`,
  'Expérience': n => `L'élève sera capable de décrire et de réaliser l'expérience suivante en respectant les étapes : ${n}.`,
  'Schéma / Graphique': n => `L'élève sera capable de lire, de compléter et d'expliquer le schéma ou le graphique suivant : ${n}.`,
  'Définition / Concept': n => `L'élève sera capable de définir le concept suivant et de l'illustrer par un exemple : ${n}.`,
  'Exercices': n => `L'élève sera capable de réaliser correctement les exercices suivants : ${n}.`,
};
function fallbackAppr(item) {
  const n = t(item.nom) || t(item.indication) || 'ce contenu';
  const f = FALLBACK_APPR[t(item.categorie)];
  return f ? f(n) : `L'élève sera capable de maîtriser et d'utiliser : ${n}.`;
}
function fallbackGuide(item) {
  const n = t(item.nom) || 'ce contenu';
  return {
    savoir: t(item.savoir) || `Je dois connaître : ${n}.`,
    savoirFaire: t(item.savoirFaire) || `Je dois être capable d'utiliser ce que j'ai appris sur : ${n}.`,
  };
}

/** Une réponse d'IA ne doit contenir ni lien, ni numéro de page, ni mention de ressource. */
function looksInvented(s) { return /https?:\/\/|www\.|\bpages?\s*\d|\bchapitre\s*\d|\bunité\s*\d/i.test(String(s || '')); }

function contextText(info) {
  return [
    `Matière : ${t(info.matiere) || 'non précisée'}`,
    `Section : ${t(info.section) || 'non précisée'}`,
    `Classe / niveau scolaire : ${t(info.classe) || 'non précisé'}`,
    t(info.niveauLinguistique) ? `Niveau linguistique (CECRL) : ${t(info.niveauLinguistique)}` : null,
    t(info.periode) ? `Période : ${t(info.periode)}` : null,
  ].filter(Boolean).join('\n');
}

async function callGroq(prompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b', messages: [{ role: 'user', content: prompt }], temperature: 0.4 }),
  });
  if (!response.ok) { console.error('Erreur API Groq (peda) :', response.status, await response.text()); throw new Error('IA indisponible'); }
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '';
  try { return JSON.parse(raw); } catch (e) {
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a === -1 || b === -1) throw new Error('Réponse IA illisible.');
    return JSON.parse(raw.slice(a, b + 1));
  }
}

/** items : [{id, categorie, nom, indication?, savoir?, savoirFaire?}] -> { ia, items:[{id, texte | savoir, savoirFaire}] } */
async function generate(type, info, items) {
  const guide = type === 'guide';
  const fallback = () => items.map(it => guide ? { id: it.id, ...fallbackGuide(it) } : { id: it.id, texte: fallbackAppr(it) });
  if (!process.env.GROQ_API_KEY || !items.length) return { ia: false, items: fallback() };

  const list = items.map(it => ({ id: it.id, rubrique: t(it.categorie), contenu: t(it.nom), precisions: t(it.indication || ''), ...(guide ? { savoir_saisi: t(it.savoir), savoir_faire_saisi: t(it.savoirFaire) } : {}) }));
  const rules = guide
    ? `Pour chaque contenu, rédige deux phrases courtes, à la première personne, adaptées à l'âge de l'élève :
- "savoir" : ce que l'élève doit savoir (commence par « Je dois connaître » ou « Je dois comprendre »).
- "savoirFaire" : ce que l'élève doit savoir faire (commence par « Je dois être capable de »).
Si l'enseignant a déjà saisi un texte (savoir_saisi / savoir_faire_saisi), améliore-le sans en changer le sens. N'écris JAMAIS de numéro de page, de lien, de livre, de vidéo, de chapitre ni de ressource : ils sont gérés ailleurs.
Format de sortie : {"items":[{"id":"...","savoir":"...","savoirFaire":"..."}]}`
    : `Pour chaque contenu, rédige UN apprentissage attendu : une ou deux phrases courtes, concrètes, qui commencent par « L'élève sera capable de ». Pas de jargon, pas de phrase longue. N'utilise jamais de tiret long (— ou –). Base-toi uniquement sur le contenu et les précisions fournis, sans rien inventer.
Format de sortie : {"items":[{"id":"...","texte":"..."}]}`;
  const prompt = `Tu es un assistant pédagogique du Collège Albert Camus. Tu aides un coordinateur à rédiger la première version d'un document ; il relira et corrigera tout.
Contexte :
${contextText(info)}
Adapte le vocabulaire, la longueur, la complexité et la formulation à l'âge, au niveau scolaire et (pour le français) au niveau linguistique indiqués.
${rules}
Contenus :
${JSON.stringify(list)}
N'utilise jamais de tiret long (— ou –) dans tes réponses.
Réponds UNIQUEMENT avec un JSON valide, sans aucun texte autour.`;

  try {
    const parsed = await callGroq(prompt);
    const byId = new Map((parsed.items || []).map(x => [String(x.id), x]));
    const fb = new Map(fallback().map(x => [x.id, x]));
    const out = items.map(it => {
      const r = byId.get(String(it.id)), f = fb.get(it.id);
      if (!r) return f;
      if (guide) {
        const savoir = t(r.savoir), sf = t(r.savoirFaire);
        return { id: it.id, savoir: savoir && !looksInvented(savoir) ? savoir : f.savoir, savoirFaire: sf && !looksInvented(sf) ? sf : f.savoirFaire };
      }
      const texte = t(r.texte);
      return { id: it.id, texte: texte && !looksInvented(texte) ? texte : f.texte };
    });
    return { ia: true, items: out };
  } catch (e) {
    return { ia: false, items: fallback(), error: "L'IA n'a pas répondu : une rédaction automatique simple a été utilisée. Vous pouvez la modifier librement." };
  }
}

/* ---------- Génération à partir d'un document Word ou PDF ---------- */
const RES_TYPES = ['livre', 'cahier', 'video', 'lien', 'document', 'exercice'];
const fold = x => String(x == null ? '' : x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');

/** Une ressource n'est gardée que si ce qu'elle dit figure réellement dans le document source. */
function verifiedResource(r, source) {
  const src = fold(source);
  const keep = v => { const x = t(v); return x && src.includes(fold(x)) ? x : ''; };
  const out = { type: RES_TYPES.includes(t(r.type)) ? t(r.type) : 'document', titre: keep(r.titre), chapitre: keep(r.chapitre), debut: keep(r.debut), fin: keep(r.fin), url: keep(r.url), commentaire: keep(r.commentaire) };
  return out.titre || out.url || out.debut || out.chapitre ? out : null;
}

function fallbackFromText(type, text) {
  const guide = type === 'guide';
  const lines = String(text).split(/\n+/).map(l => t(l.replace(/^[\s*•\-\d.)]+/, '').replace(/\*\*/g, ''))).filter(l => l.length > 2 && l.length < 160);
  return lines.slice(0, 40).map(nom => {
    const it = { categorie: 'Sujet / Thème', nom, indication: '' };
    return guide ? { ...it, savoir: '', savoirFaire: '', ressources: [] } : { ...it, texte: '' };
  });
}

/** text : contenu extrait du document. Retourne { ia, items:[{categorie, nom, indication, savoir, savoirFaire, texte, ressources}] } */
async function fromDocument(type, info, text, categories) {
  const guide = type === 'guide';
  const source = String(text || '').slice(0, 14000);
  if (!source.trim()) return { ia: false, items: [] };
  const fb = () => ({ ia: false, items: fallbackFromText(type, source), error: "L'IA n'est pas configurée ou n'a pas répondu : les lignes du document ont été reprises telles quelles. Complétez-les puis cliquez sur la génération." });
  if (!process.env.GROQ_API_KEY) return fb();
  const cats = (categories && categories.length ? categories : ['Sujet / Thème', 'Autre']).join(' | ');
  const fields = guide
    ? '"savoir" (commence par « Je dois connaître » ou « Je dois comprendre »), "savoirFaire" (commence par « Je dois être capable de »)'
    : '"texte" (un apprentissage attendu : une ou deux phrases courtes qui commencent par « L\'élève sera capable de »)';
  const prompt = `Tu aides le coordinateur du Collège Albert Camus à préparer un ${guide ? 'guide de révision d\'examen' : 'document d\'apprentissages attendus'}.
Contexte :
${contextText(info)}
Voici le contenu d'un document fourni par un enseignant. Repère les sujets, notions et contenus à réviser, regroupe-les logiquement, puis rédige chaque élément.
Règles :
- Une entrée par sujet ou notion. Ne copie pas les phrases du document telles quelles : reformule en phrases courtes adaptées à l'âge de l'élève.
- "categorie" doit être exactement une de ces valeurs : ${cats}.
- "nom" : intitulé court du sujet ou de la notion.
- ${fields}.
- Si le document mentionne des ressources (livre, cahier d'activités, pages, chapitre, vidéo, lien, fiche, exercices), sépare-les du contenu et mets-les dans "ressources" avec type parmi ${RES_TYPES.join(', ')}. Recopie les titres, pages et liens EXACTEMENT comme dans le document. N'invente jamais une ressource, un numéro de page, un lien ou un chapitre. S'il n'y en a pas, "ressources" est une liste vide.
- N'utilise jamais de tiret long (— ou –).
Sortie : {"items":[{"categorie":"","nom":"","indication":"",${guide ? '"savoir":"","savoirFaire":"",' : '"texte":"",'}"ressources":[{"type":"","titre":"","chapitre":"","debut":"","fin":"","url":"","commentaire":""}]}]}
Réponds UNIQUEMENT avec ce JSON valide.

DOCUMENT :
"""
${source}
"""`;
  try {
    const parsed = await callGroq(prompt);
    const okCats = new Set(categories || []);
    const items = (parsed.items || []).slice(0, 80).map(x => ({
      categorie: okCats.size && !okCats.has(t(x.categorie)) ? (okCats.has('Autre') ? 'Autre' : [...okCats][0]) : (t(x.categorie) || 'Autre'),
      nom: t(x.nom).slice(0, 300), indication: t(x.indication).slice(0, 500),
      ...(guide ? { savoir: looksInvented(x.savoir) ? '' : t(x.savoir), savoirFaire: looksInvented(x.savoirFaire) ? '' : t(x.savoirFaire) } : { texte: looksInvented(x.texte) ? '' : t(x.texte) }),
      ressources: (Array.isArray(x.ressources) ? x.ressources : []).map(r => verifiedResource(r || {}, source)).filter(Boolean).slice(0, 10),
    })).filter(x => x.nom);
    if (!items.length) return fb();
    return { ia: true, items };
  } catch (e) { return fb(); }
}

module.exports = { generate, fromDocument, fallbackAppr, fallbackGuide, looksInvented };
