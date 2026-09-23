# Examens FLE — Backend

API réelle (Node.js + Express + PostgreSQL via Prisma) pour la plateforme d'examens
de français. Ce backend remplace le stockage local (localStorage) de la version
démo : plusieurs professeurs, sur plusieurs appareils, peuvent maintenant utiliser
l'application en même temps, avec des données partagées et persistantes.

## Ce que contient ce dossier

```
backend/
  prisma/schema.prisma   → structure de la base de données
  src/
    index.js             → point d'entrée du serveur Express
    db.js                → connexion à la base (Prisma)
    auth.js               → connexion, jetons de session (JWT), contrôle des rôles
    audit.js              → journal des actions (historique admin)
    grading.js             → correction automatique, recalculée côté serveur
    sanitizeExam.js        → ne renvoie jamais les bonnes réponses au navigateur élève
    seed.js                 → crée le tout premier compte administrateur
    routes/                → une route par domaine (examens, sessions, résultats, ...)
  .env.example             → variables à configurer
  package.json
```

## Pourquoi ce backend est nécessaire

La version précédente (page unique publiée par Claude) stockait tout dans le
navigateur (`localStorage`). Ça fonctionne pour tester le fonctionnement en solo,
mais :
- les données ne sont visibles que sur l'appareil où elles ont été créées ;
- un professeur sur sa tablette ne voit pas ce que l'administrateur a créé sur son
  ordinateur ;
- rien n'est sauvegardé si le navigateur efface ses données.

Ce backend est un vrai serveur, avec une vraie base de données, que tous les
appareils de l'établissement peuvent appeler par Internet.

**Important** : ce backend seul ne suffit pas. Il faut aussi que le **frontend**
(l'interface visuelle) soit hébergé en dehors de Claude, parce qu'une page publiée
par Claude ne peut pas appeler une API externe. Une fois ce backend déployé et
fonctionnel, dites-le moi et je vous prépare la version du frontend qui s'y
connecte, à héberger elle aussi (par exemple sur Vercel ou Netlify, gratuitement).

## Déploiement — étape par étape

### 1. Créer la base de données PostgreSQL (gratuit)

Choisissez un hébergeur de base de données PostgreSQL gratuit, par exemple :
- **Neon** (neon.tech) — recommandé, très simple
- **Supabase** (supabase.com)
- **Railway** (railway.app)

Créez un projet, puis récupérez l'URL de connexion (`postgresql://...`). Vous en
aurez besoin à l'étape suivante.

### 2. Configurer les variables d'environnement

Copiez `.env.example` en `.env` et remplissez :
- `DATABASE_URL` : l'URL récupérée à l'étape 1
- `JWT_SECRET` : une longue chaîne aléatoire — générez-la avec :
  ```
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` : les identifiants
  du tout premier compte administrateur
- `CORS_ORIGINS` : laissez vide pour l'instant, vous le remplirez avec l'adresse
  du frontend une fois qu'il sera déployé

### 3. Installer et préparer la base de données

```bash
npm install
npx prisma migrate deploy    # crée les tables dans votre base de données
npm run seed                  # crée le compte administrateur
```

### 4. Tester en local (optionnel mais recommandé)

```bash
npm run dev
```
Ouvrez `http://localhost:3000/api/health` dans votre navigateur : vous devez voir
`{"ok":true,...}`.

### 5. Déployer en ligne

**Option recommandée : Render.com (gratuit pour commencer)**
1. Créez un compte sur render.com et connectez votre dépôt de code (GitHub/GitLab —
   vous pouvez glisser ce dossier dans un nouveau dépôt).
2. « New → Web Service », sélectionnez le dépôt.
3. Build command : `npm install && npx prisma migrate deploy`
4. Start command : `npm start`
5. Ajoutez les mêmes variables d'environnement que dans votre `.env` (dans
   l'onglet « Environment » de Render).
6. Une fois déployé, Render vous donne une adresse du type
   `https://examens-fle-api.onrender.com` — c'est l'adresse que le frontend
   utilisera pour parler au serveur.

**Alternative : Railway.app** — fonctionne de façon très similaire (détecte
Node.js automatiquement, variables d'environnement dans l'onglet « Variables »).

### 6. Dernière étape

Une fois le backend en ligne et son adresse notée, revenez me voir avec cette
adresse : je préparerai le frontend (nouvelle version de l'application) pour
qu'il l'appelle, et vous n'aurez plus qu'à le déployer à son tour.

## Aperçu de l'API

Toutes les routes sous `/api/*`. Authentification par jeton (`Authorization: Bearer <token>`),
obtenu via `POST /api/auth/login`.

| Route | Accès | Description |
|---|---|---|
| `POST /api/auth/login` | public | Connexion admin/professeur |
| `POST /api/access-requests` | public | Formulaire de demande d'accès professeur |
| `GET/POST /api/access-requests` | admin | Traiter les demandes |
| `GET/POST/PUT/DELETE /api/exams` | admin (lecture: aussi professeur, filtrée) | Gestion des examens |
| `GET/POST/DELETE /api/assignments` | admin (lecture: aussi professeur) | Assignation examen ↔ professeur |
| `POST /api/sessions`, `POST /api/sessions/:id/start` | professeur/admin | Lancer une session, obtenir le code |
| `GET /api/sessions/by-token/:token` | public | Utilisé par l'écran d'accès élève |
| `POST /api/attempts` | public | L'élève rejoint une session |
| `PATCH /api/attempts/:id` | public (protégé par secret) | Sauvegarde automatique des réponses |
| `POST /api/attempts/:id/submit` | public (protégé par secret) | Envoi final de la copie |
| `GET/PATCH /api/results/:attemptId`, `POST .../release` | professeur/admin | Correction et publication du résultat |
| `GET /api/export/results.csv` | professeur/admin | Export CSV/Excel |
| `GET /api/analytics/dashboard`, `/class/:classe` | admin | Statistiques |
| `GET /api/audit` | admin | Historique des actions |

## Sécurité — ce qui est déjà fait

- Mots de passe hachés avec bcrypt (jamais stockés en clair)
- Jetons de session signés (JWT), expirant après 12h
- Chaque route vérifie le rôle ET, pour un professeur, que la ressource lui
  appartient bien (impossible d'accéder aux données d'un autre professeur en
  changeant un identifiant dans l'URL)
- Les bonnes réponses ne sont jamais envoyées au navigateur de l'élève
  (`sanitizeExam.js`)
- La note finale est toujours recalculée côté serveur, jamais acceptée telle
  quelle depuis le navigateur
- CORS restreint aux origines déclarées

## Ce qui reste à faire (à la charge de qui déploie)

- **Sauvegardes de la base de données** : configurez les sauvegardes automatiques
  proposées par votre hébergeur (Neon/Supabase les offrent).
- **Fichiers audio/images volumineux** : ce backend attend des URLs (hébergez vos
  fichiers audio ailleurs, ex. Google Drive en partage public, ou un service comme
  Cloudinary) plutôt que de les envoyer en base64 par l'API.
- **Emails** (réinitialisation de mot de passe, notifications) : nécessitent un
  service d'envoi d'emails (ex. Resend, SendGrid) — pas encore branché ici.

## Historique des ajouts (au fil des demandes)

- Rôles : promotion/rétrogradation professeur ↔ administrateur (`/api/admins`, `/api/teachers/:id/promote`)
- Matière par examen (Français / Sciences) sur le modèle `Exam`
- Module Quiz éphémère (rien en base de données), génération par IA gratuite via
  Groq (`GROQ_API_KEY` optionnelle) — voir `src/quizStore.js` et `src/routes/quiz.js`
- Texte de lecture (passage) optionnel par question, envoyé à l'élève sans les
  bonnes réponses (`src/sanitizeExam.js`)
- Exports Excel (.xlsx) et PDF réels, avec couleurs par note (rouge/orange/vert)
  et diagramme de réussite par section — `src/reports.js`, `src/scoreColors.js`,
  routes dans `src/routes/export.js` (`/results.xlsx`, `/results.pdf`,
  `/attempt/:id/xlsx`, `/attempt/:id/pdf`) ; le nom de fichier inclut
  automatiquement la classe/groupe ou le niveau quand c'est déterminable
- Champ `groupe` sur les demandes d'accès ; champ `code` retiré (inutile en
  déploiement mono-établissement)
- Présence en direct des élèves pendant un examen (actif/a quitté la page) —
  `Attempt.away`, route `PATCH /api/attempts/:id/presence`, exposée dans
  `GET /api/sessions/:id/live` (liste nominative, pas seulement un compteur)
- Export PDF groupé — une feuille par élève dans un seul fichier, à imprimer et
  séparer : `GET /api/export/results-bulk.pdf`
- Correctif d'un bug d'alignement dans les PDF individuels (le texte des
  questions dérivait vers la droite après le diagramme de réussite)
- Module **Projets** — grille d'évaluation notée à la main (critères et points
  définis par l'admin, saisie manuelle par le professeur, sans passation en
  ligne) : `Project`, `ProjectAssignment`, `ProjectEntry`, routes
  `/api/projects`, `/api/project-assignments`, `/api/project-entries`, exports
  `/api/export/project-results.xlsx|pdf`
- Présence en direct enrichie : bannière d'alerte visible même pendant la
  projection, listant nommément chaque élève ayant quitté la page
- PDF (individuel et groupé) : les images ajoutées à une question sont
  maintenant intégrées directement dans le fichier, pas seulement leur lien
- Export PDF groupé enrichi : chaque élève a maintenant sa copie complète
  (question par question), pas seulement un résumé
- Lien d'invitation professeur partageable (`?access=1`) depuis la page
  « Professeurs »
- Import de fichiers (images/audio) stocké en base de données — `UploadedFile`,
  routes `POST/GET /api/uploads` — pour ne plus dépendre de liens externes
  fragiles (imgur, etc.) qui ne s'affichaient pas dans les exports
- Logo de l'établissement (réglage global) — `Settings`, routes
  `/api/settings` — intégré automatiquement dans les Word et PDF générés
- Audio par section (en plus de l'audio par question), joué à la présentation
- Module Projets : import d'image, export Word, export PDF individuel avec
  espacement correct, export PDF groupé (`/api/export/project-entry*`,
  `/api/export/project-entries-bulk.pdf`)
- Rapport pédagogique global en PDF coloré, pour la direction
  (`/api/export/global-report.pdf`)
- Présence : la session passe automatiquement à « Terminé » quand tous les
  élèves ont soumis ; couleur orange pour « terminé », rouge pour « a quitté
  la page », avec bannière clignotante + bip sonore répété côté professeur
- QR code pour le lien d'invitation professeur
- Suppression d'une session (et de son historique) à la demande de l'admin ou
  du professeur — `DELETE /api/sessions/:id`
- Code de session visible sur l'écran d'examen de l'élève

**Important** : ce schéma a changé plusieurs fois depuis la version initiale. Le
Build Command `npx prisma db push --accept-data-loss` (voir étape 5 plus haut)
applique automatiquement ces changements à chaque déploiement — aucune action
manuelle nécessaire de votre part au-delà d'un redéploiement normal.
