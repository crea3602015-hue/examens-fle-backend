// Logique de correction automatique — recalculée côté serveur (jamais fait confiance
// à un score envoyé par le navigateur) pour éviter qu'un élève ou un professeur
// puisse falsifier une note en modifiant les données envoyées à l'API.

function sectionPoints(sec) {
  return (sec.questions || []).reduce((a, q) => a + Number(q.points || 0), 0);
}

function examTotalPoints(exam) {
  return (exam.sections || []).reduce((s, sec) => s + sectionPoints(sec), 0);
}

const MANUAL_TYPES = ['texte_long', 'correction_manuelle', 'dessin'];
const ORAL_TYPE = 'production_orale';

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
      const ok = String(given).trim().toLowerCase() === String(q.correct || '').trim().toLowerCase();
      return { correct: ok, points: ok ? pts : 0 };
    }
    case 'texte_trous': {
      const expected = (q.correct || '').split(',').map(s => s.trim().toLowerCase());
      const givenArr = (given || []).map(s => String(s).trim().toLowerCase());
      let good = 0;
      expected.forEach((e, i) => { if (givenArr[i] === e) good++; });
      const ratio = expected.length ? good / expected.length : 0;
      return { correct: ratio === 1, points: Math.round(ratio * pts) };
    }
    case 'association': {
      const pairs = q.pairs || [];
      if (pairs.length === 0) return { correct: false, points: 0 };
      let good = 0;
      pairs.forEach(p => { if ((given || {})[p.left] === p.right) good++; });
      const ratio = good / pairs.length;
      return { correct: ratio === 1, points: Math.round(ratio * pts) };
    }
    case 'association_images': {
      const pairs = q.pairs || [];
      if (pairs.length === 0) return { correct: false, points: 0 };
      let good = 0;
      const g = given || {};
      pairs.forEach(p => { if (g[p.id] === p.id) good++; });
      const ratio = good / pairs.length;
      return { correct: ratio === 1, points: Math.round(ratio * pts) };
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
        const v = oralOverride !== null && oralOverride !== undefined ? Number(oralOverride) : 0;
        oralNote = v;
        secScore += v;
        return;
      }
      if (MANUAL_TYPES.includes(q.type)) {
        const v = manualOverrides[q.id];
        if (v === undefined || v === null || v === '') {
          manualPending = true;
        } else {
          secScore += Number(v);
        }
        return;
      }
      const g = gradeAuto(q, reponses[q.id]);
      autoDetail[q.id] = g;
      secScore += g.points;
    });
    sectionScores[sec.id] = secScore;
    total += secScore;
  });

  const max = examTotalPoints(exam);
  const pct = max ? Math.round((100 * total) / max) : 0;

  return { sectionScores, autoDetail, total, max, pct, manualPending, oralNote };
}

module.exports = { sectionPoints, examTotalPoints, gradeAuto, computeResult, MANUAL_TYPES, ORAL_TYPE };
