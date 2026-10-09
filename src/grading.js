// Logique de correction automatique — recalculée côté serveur (jamais fait confiance
// à un score envoyé par le navigateur) pour éviter qu'un élève ou un professeur
// puisse falsifier une note en modifiant les données envoyées à l'API.

function sectionPoints(sec) {
  return Math.round((sec.questions || []).reduce((a, q) => a + Number(q.points || 0), 0) * 100) / 100;
}

function examTotalPoints(exam) {
  return Math.round((exam.sections || []).reduce((s, sec) => s + sectionPoints(sec), 0) * 100) / 100;
}

const MANUAL_TYPES = ['texte_long', 'correction_manuelle', 'dessin'];
const ORAL_TYPE = 'production_orale';

/** Normalise un texte pour comparer des réponses : minuscules, sans accents ni ponctuation. */
function norm(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`´]/g, ' ').replace(/[^a-z0-9\u0153 ]/g, ' ').replace(/\s+/g, ' ').trim().replace(/(\d) h\b/g, '$1h');
}
/** Une réponse attendue peut proposer des variantes séparées par « | » (ex. « 8 heures|8h|8h00 »). */
/** Retire un pronom sujet au début (« je suis » -> « suis », « j'ai » -> « ai »), pour accepter le verbe conjugué avec son pronom. */
function stripPronoun(n) {
  return n.replace(/^(je|j|tu|il|elle|on|nous|vous|ils|elles) /, '').trim();
}
function matchesAny(given, spec) {
  const alts = String(spec == null ? '' : spec).split('|').map(norm).filter(a => a !== '');
  const g = norm(given);
  if (alts.includes(g)) return true;
  // Tolérance : la réponse donnée contient en plus le pronom sujet (« je m'appelle » pour « m'appelle »),
  // ou la réponse attendue contient le pronom et l'élève ne l'a pas écrit (« suis » pour « je suis »).
  const gs = stripPronoun(g);
  return gs !== '' && alts.some(a => a === gs || stripPronoun(a) === gs);
}

/** Arrondi à 2 décimales (les notes peuvent être décimales : 3,5 / 5). */
function round2(n) { return Math.round(Number(n) * 100) / 100; }
/** Borne une note entre 0 et le maximum de la question. */
function clamp(v, max) { return Math.max(0, Math.min(Number(max), Number(v))); }

/** Note d'une production orale évaluée par une grille de critères.
    breakdown : { [critereId]: pointsDonnés }. Si la somme des critères diffère des
    points de la question (ex. grille sur 30 pour une partie sur 25), la note est
    ramenée proportionnellement aux points de la question. */
function oralFromCriteria(q, breakdown) {
  const criteres = q.criteres || [];
  const maxSum = criteres.reduce((a, c) => a + Number(c.points || 0), 0);
  if (!maxSum) return 0;
  let got = 0;
  criteres.forEach(c => {
    const v = Number((breakdown || {})[c.id]);
    if (Number.isFinite(v)) got += clamp(v, c.points);
  });
  return round2((got * Number(q.points || 0)) / maxSum);
}

/** Auto-grade a single question given the student's answer. Returns {correct, points}. */
function gradeAuto(q, given) {
  const pts = Number(q.points || 0);
  if (given === undefined || given === null || given === '') return { correct: false, points: 0 };

  switch (q.type) {
    case 'choix_unique':
    case 'image_choix': {
      const ok = Number(given) === Number(q.correct);
      return { correct: ok, points: ok ? pts : 0 };
    }
    case 'choix_multiple': {
      const g = (given || []).slice().sort().join(',');
      const c = (q.correct || []).slice().sort().join(',');
      const ok = g === c && g !== '';
      return { correct: ok, points: ok ? pts : 0 };
    }
    case 'vrai_faux': {
      const ok = given === q.correct;
      return { correct: ok, points: ok ? pts : 0 };
    }
    case 'texte_court': {
      const ok = matchesAny(given, q.correct);
      return { correct: ok, points: ok ? pts : 0 };
    }
    case 'texte_trous': {
      const expected = (q.correct || '').split(',').map(s => s.trim());
      const givenArr = (given || []).map(s => String(s));
      let good = 0;
      expected.forEach((e, i) => { if (matchesAny(givenArr[i], e)) good++; });
      const ratio = expected.length ? good / expected.length : 0;
      return { correct: ratio === 1, points: round2(ratio * pts) };
    }
    case 'association': {
      const pairs = q.pairs || [];
      if (pairs.length === 0) return { correct: false, points: 0 };
      let good = 0;
      pairs.forEach(p => { if ((given || {})[p.left] === p.right) good++; });
      const ratio = good / pairs.length;
      return { correct: ratio === 1, points: round2(ratio * pts) };
    }
    case 'association_images': {
      const pairs = q.pairs || [];
      if (pairs.length === 0) return { correct: false, points: 0 };
      let good = 0;
      const g = given || {};
      pairs.forEach(p => { if (g[p.id] === p.id) good++; });
      const ratio = good / pairs.length;
      return { correct: ratio === 1, points: round2(ratio * pts) };
    }
    case 'classification': {
      const els = q.elements || [];
      if (els.length === 0) return { correct: false, points: 0 };
      const g = given || {};
      let good = 0;
      els.forEach((e, i) => { if (norm(g[i]) === norm(e.categorie)) good++; });
      const ratio = good / els.length;
      return { correct: ratio === 1, points: round2(ratio * pts) };
    }
    case 'classement': {
      const expected = q.items || [];
      if (expected.length === 0) return { correct: false, points: 0 };
      const g = given || [];
      const ok = expected.length === g.length && expected.every((v, i) => v === g[i]);
      return { correct: ok, points: ok ? pts : 0 };
    }
    default:
      return { correct: false, points: 0 };
  }
}

/**
 * Compute full scoring for an attempt.
 * manualOverrides: { [questionId]: pointsAwarded } — professor-entered points for
 * manually-graded questions (texte_long, correction_manuelle, dessin).
 * oralOverride: number | null — professor-entered oral production score.
 */
function computeResult(exam, reponses, manualOverrides = {}, oralOverride = null) {
  const sectionScores = {};
  const autoDetail = {};
  let total = 0;
  let manualPending = false;
  let oralNote = null;

  exam.sections.forEach(sec => {
    let secScore = 0;
    sec.questions.forEach(q => {
      if (q.type === ORAL_TYPE) {
        let v;
        const breakdown = manualOverrides['crit:' + q.id];
        if ((q.criteres || []).length && breakdown && typeof breakdown === 'object') {
          v = oralFromCriteria(q, breakdown); // la note est calculée par le serveur à partir de la grille
        } else {
          v = oralOverride !== null && oralOverride !== undefined ? clamp(oralOverride, q.points) : 0;
        }
        oralNote = v;
        secScore += v;
        return;
      }
      if (MANUAL_TYPES.includes(q.type)) {
        const v = manualOverrides[q.id];
        if (v === undefined || v === null || v === '') {
          manualPending = true;
        } else {
          secScore += clamp(v, q.points);
        }
        return;
      }
      let g = gradeAuto(q, reponses[q.id]);
      // Le professeur peut corriger la note d'une question corrigée automatiquement (ex. réponse jugée bonne malgré tout).
      const ov = manualOverrides[q.id];
      if (ov !== undefined && ov !== null && ov !== '' && Number.isFinite(Number(ov))) {
        const pv = round2(clamp(ov, q.points));
        g = { correct: pv >= Number(q.points || 0), points: pv, overridden: true, auto: gradeAuto(q, reponses[q.id]).points };
      }
      autoDetail[q.id] = g;
      secScore += g.points;
    });
    sectionScores[sec.id] = round2(secScore);
    total += secScore;
  });

  const max = examTotalPoints(exam);
  total = round2(total);
  const pct = max ? Math.round((100 * total) / max) : 0;

  return { sectionScores, autoDetail, total, max, pct, manualPending, oralNote };
}

module.exports = { sectionPoints, examTotalPoints, gradeAuto, computeResult, oralFromCriteria, MANUAL_TYPES, ORAL_TYPE };
