// Conversion d'un examen papier (texte extrait d'un Word ou d'un PDF) en examen numérique, par IA (Groq).
// L'IA propose ; le serveur vérifie et normalise chaque question ; tout ce qui n'est pas certain est marqué
// « réponse à confirmer » (aSaisir) pour que l'enseignant le valide avant de publier. Rien n'est publié automatiquement.

const TYPES = ['choix_unique', 'choix_multiple', 'vrai_faux', 'texte_court', 'texte_trous', 'association', 'classement', 'classification', 'correction_manuelle', 'dessin', 'production_orale'];
const AUTO = new Set(['choix_unique', 'choix_multiple', 'vrai_faux', 'texte_court', 'texte_trous', 'association', 'classement', 'classification']);
const t = v => String(v == null ? '' : v).trim();
const num = v => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const round2 = n => Math.round(n * 100) / 100;

function buildPrompt({ text, part, parts, niveau, matiere, imageCount }) {
  return `Tu convertis un examen papier (texte extrait d'un document Word ou PDF) en examen numérique pour une plateforme d'évaluation d'école.
Niveau : « ${niveau || 'Primaire'} ». Matière : « ${matiere || 'Français'} ». Partie ${part || 1} sur ${parts || 1} du document.
Le texte peut contenir : **du gras** (souvent la bonne réponse), des tableaux écrits « cellule | cellule », des puces « - », et des marqueurs [IMAGE n] à l'endroit où une image apparaît dans le document (${imageCount || 0} image(s) au total).

RÈGLES
1. Découpe en « sections » comme dans le document (ex. Compréhension orale, Compréhension écrite, Production écrite, Production orale, Grammaire…). "cible" = nombre de points annoncé pour la section, sinon null. "consigne" = la consigne générale de la section (ex. « Écoute et réponds »).
2. Chaque exercice devient une ou plusieurs questions. CONSERVE les points indiqués. Si les points d'un exercice sont donnés globalement, répartis-les entre ses questions : leur somme doit rester égale. Sans indication de points, mets 1 point par question.
3. Choisis le type le mieux adapté et respecte exactement ces formes :
- "choix_unique" : QCM, une seule bonne réponse. {"options":["…","…"],"correct":0}  (correct = numéro de la bonne option, en commençant à 0)
- "choix_multiple" : plusieurs bonnes réponses. {"options":[…],"correct":[0,2]}
- "vrai_faux" : {"correct":true}  ou false
- "texte_court" : réponse courte (mot, nombre, expression). {"correct":"réponse|variante acceptée"}
- "texte_trous" : phrase ou texte à compléter. {"textTemplate":"Il ___ au parc. Elle ___ une pomme.","correct":"va,mange"} (un « ___ » par blanc ; réponses séparées par des virgules, dans l'ordre)
- "association" : relier deux listes, un élément pour un seul. {"pairs":[{"left":"…","right":"…"}]}
- "classement" : remettre dans l'ordre. {"items":["premier","deuxième","…"]} (dans le BON ordre)
- "classification" : ranger des éléments dans des catégories. {"categories":["Un","Une","Des"],"elements":[{"texte":"ciseaux","categorie":"Des"}]}
- "correction_manuelle" : réponse rédigée (phrase, justification, production écrite). {"corrige":"éléments attendus, si connus"}
- "dessin" : dessiner, colorier, schématiser. {"corrige":"ce qui est attendu"}
- "production_orale" : épreuve orale notée à la main. Si une grille d'évaluation existe : {"criteres":[{"titre":"Prononciation","points":5}]}
Chaque question a aussi : "enonce" (texte fidèle de la question), "points" (nombre). Facultatif : "passage" (texte de lecture à lire avant de répondre), "media":"@img:n" si la question dépend de l'image [IMAGE n].
4. Pour toute question à correction automatique, ajoute "reponseSource" : "document" si la bonne réponse est écrite dans le document (en gras, corrigé, case cochée…), "deduite" si tu la déduis toi-même (d'un texte de lecture ou de tes connaissances), "inconnue" si elle dépend d'un audio, d'une vidéo, d'une image ou d'une information absente. N'invente JAMAIS : si tu ne connais pas la réponse, mets "inconnue" et ne mets pas "correct".
5. N'oublie aucune question. Ne résume pas, ne reformule pas les énoncés (corrige seulement les fautes de frappe évidentes). Une phrase d'introduction ou une consigne n'est pas une question.
6. Réponds UNIQUEMENT avec un JSON valide, sans texte autour, de cette forme :
{"titre":"titre de l'examen ou null","total":nombre total de points annoncé ou null,"sections":[{"titre":"…","consigne":"…","cible":null,"questions":[{"type":"…","enonce":"…","points":1}]}]}

TEXTE DU DOCUMENT
"""
${text}
"""`;
}

/** Réparation d'un JSON coupé (réponse trop longue) : on retire la fin incomplète et on referme les crochets. */
function repairJson(raw) {
  const start = raw.indexOf('{'); if (start === -1) throw new Error('Réponse IA illisible.');
  let s = raw.slice(start);
  try { return JSON.parse(s); } catch (e) { /* on tente la réparation */ }
  const end = s.lastIndexOf('}');
  if (end !== -1) { try { return JSON.parse(s.slice(0, end + 1)); } catch (e) { /* suite */ } }
  for (let k = s.length - 1, tries = 0; k > 0 && tries < 400; k--) {
    if (s[k] !== '}' && s[k] !== ']') continue; tries++;
    const cand = s.slice(0, k + 1);
    // état des crochets du candidat (en ignorant le contenu des chaînes)
    const stack = []; let inStr = false, esc = false;
    for (const ch of cand) {
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true; else if (ch === '{' || ch === '[') stack.push(ch); else if (ch === '}' || ch === ']') stack.pop();
    }
    if (inStr) continue;
    const closers = stack.reverse().map(c => (c === '{' ? '}' : ']')).join('');
    try { return JSON.parse(cand + closers); } catch (e) { /* on recule */ }
  }
  throw new Error('Réponse IA illisible.');
}

async function callGroq(prompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) { const e = new Error("La conversion par IA n'est pas configurée sur ce serveur (clé GROQ_API_KEY absente)."); e.status = 501; throw e; }
  const body = { model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b', messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 7000 };
  const send = async extra => fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ ...body, ...extra }) });
  let r = await send({ response_format: { type: 'json_object' } });
  if (r.status === 400) r = await send({}); // certains modèles n'acceptent pas le mode JSON
  if (!r.ok) { console.error('Erreur API Groq (conversion) :', r.status, await r.text()); const e = new Error("L'IA n'a pas pu convertir cette partie pour le moment. Réessayez dans un instant."); e.status = 502; throw e; }
  const data = await r.json();
  return repairJson(data.choices?.[0]?.message?.content || '');
}

/** Vérifie et normalise la réponse de l'IA : chaque question devient valide, ou est signalée « à confirmer ». */
function normalize(raw, imageCount) {
  const out = { titre: t(raw.titre) || null, total: num(raw.total), sections: [] };
  const sections = Array.isArray(raw.sections) ? raw.sections : [];
  sections.forEach(sec => {
    const qs = [];
    (Array.isArray(sec.questions) ? sec.questions : []).forEach(q => {
      const enonce = t(q.enonce || q.question || q.texte);
      let type = TYPES.includes(q.type) ? q.type : null;
      if (!type) type = 'correction_manuelle';
      if (!enonce && type !== 'production_orale') return;
      let points = num(q.points); const pointsEstimes = !(points && points > 0); if (pointsEstimes) points = 1;
      const nq = { type, enonce: enonce || 'Production orale', points: round2(points) };
      if (t(q.passage)) nq.passage = t(q.passage).slice(0, 6000);
      const m = /^@img:(\d+)$/.exec(t(q.media));
      if (m && Number(m[1]) >= 1 && Number(m[1]) <= (imageCount || 0)) nq.media = `@img:${m[1]}`;
      const known = t(q.reponseSource) === 'document';
      let unsure = !known; // une réponse déduite ou inconnue doit être confirmée par l'enseignant
      const toManual = () => { nq.type = 'correction_manuelle'; unsure = false; };

      switch (type) {
        case 'choix_unique': case 'choix_multiple': {
          const options = (Array.isArray(q.options) ? q.options : []).map(t).filter(Boolean);
          if (options.length < 2) { toManual(); break; }
          nq.options = options;
          if (type === 'choix_unique') {
            const c = Number.isInteger(Number(q.correct)) && q.correct !== null && q.correct !== '' ? Number(q.correct) : null;
            if (c !== null && c >= 0 && c < options.length) nq.correct = c; else unsure = true;
          } else {
            const c = (Array.isArray(q.correct) ? q.correct : []).map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < options.length);
            if (c.length) nq.correct = [...new Set(c)]; else unsure = true;
          }
          break;
        }
        case 'vrai_faux':
          if (q.correct === true || q.correct === false) nq.correct = q.correct;
          else if (/^(vrai|true|oui)$/i.test(t(q.correct))) nq.correct = true; else if (/^(faux|false|non)$/i.test(t(q.correct))) nq.correct = false; else unsure = true;
          break;
        case 'texte_court':
          if (t(q.correct)) nq.correct = t(q.correct); else unsure = true;
          break;
        case 'texte_trous': {
          const tpl = t(q.textTemplate || q.enonce);
          const blanks = (tpl.match(/___/g) || []).length;
          if (!blanks) { toManual(); break; }
          nq.textTemplate = tpl;
          const ans = (Array.isArray(q.correct) ? q.correct.map(t).join(',') : t(q.correct));
          if (ans && ans.split(',').filter(x => x.trim()).length === blanks) nq.correct = ans; else { unsure = true; if (ans) nq.correct = ans; }
          break;
        }
        case 'association': {
          const pairs = (Array.isArray(q.pairs) ? q.pairs : []).map(p => ({ left: t(p && p.left), right: t(p && p.right) })).filter(p => p.left && p.right);
          if (pairs.length < 2) { toManual(); break; }
          nq.pairs = pairs; if (known) unsure = false; // l'association est la réponse elle-même
          break;
        }
        case 'classement': {
          const items = (Array.isArray(q.items) ? q.items : []).map(t).filter(Boolean);
          if (items.length < 2) { toManual(); break; }
          nq.items = items; break;
        }
        case 'classification': {
          const categories = (Array.isArray(q.categories) ? q.categories : []).map(t).filter(Boolean);
          const elements = (Array.isArray(q.elements) ? q.elements : []).map(e => ({ texte: t(e && e.texte), categorie: t(e && e.categorie) })).filter(e => e.texte);
          if (categories.length < 2 || elements.length < 2) { toManual(); break; }
          nq.categories = categories; nq.elements = elements.map(e => ({ texte: e.texte, categorie: categories.includes(e.categorie) ? e.categorie : '' }));
          if (nq.elements.some(e => !e.categorie)) unsure = true;
          break;
        }
        case 'production_orale': {
          const criteres = (Array.isArray(q.criteres) ? q.criteres : []).map(c => ({ titre: t(c && c.titre), points: num(c && c.points) })).filter(c => c.titre && c.points > 0);
          if (criteres.length) nq.criteres = criteres;
          unsure = false; break;
        }
        default: // correction_manuelle, dessin
          if (t(q.corrige)) nq.corrige = t(q.corrige).slice(0, 2000);
          unsure = false;
      }
      if (AUTO.has(nq.type) && unsure) nq.aSaisir = true;
      if (pointsEstimes) nq.pointsEstimes = true;
      qs.push(nq);
    });
    if (!qs.length) return;
    const s = { titre: t(sec.titre) || 'Partie', questions: qs };
    if (t(sec.consigne)) s.consigne = t(sec.consigne).slice(0, 1500);
    const cible = num(sec.cible); if (cible && cible > 0) s.cible = cible;
    out.sections.push(s);
  });
  return out;
}

async function convertChunk(params) {
  const raw = await callGroq(buildPrompt(params));
  const norm = normalize(raw, params.imageCount);
  const nq = norm.sections.reduce((a, s) => a + s.questions.length, 0);
  if (!nq) { const e = new Error("L'IA n'a trouvé aucune question dans cette partie du document."); e.status = 422; throw e; }
  return norm;
}

module.exports = { convertChunk, normalize, repairJson, buildPrompt };
