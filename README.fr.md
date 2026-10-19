<div align="center">

<img src="./easy-speak/public/favicon.svg" width="76" height="76" alt="EasySpeak" />

# EasySpeak · 轻松说

[简体中文](./README.md) · [English](./README.en.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · **Français** · [Deutsch](./README.de.md)

**Pratiquez la langue que vous souhaitez parler, comme dans une conversation entre amis.**

</div>

EasySpeak (轻松说) est une application web de conversation avec une IA pour adultes, pensée d'abord pour les mobiles. Un interlocuteur principal anime l'échange et deux panneaux d'aide fonctionnent indépendamment : celui du haut propose quoi dire ensuite, celui du bas commente uniquement votre dernière intervention.

> **Code ouvert sous [Apache License 2.0](./LICENSE). L'utilisation commerciale, la modification et la distribution sont autorisées sous ses conditions.** Conservez les mentions de licence et d'attribution requises et signalez les modifications. Les dépendances gardent leurs propres licences.

Les liens ci-dessus permettent de changer la langue du README. La documentation technique détaillée est actuellement principalement en chinois.

## Fonctionnalités

- **Conversation vocale :** échanges en semi-duplex ; le micro s'ouvre après la fin de la parole de l'IA. Transcription, réponse en streaming et synthèse vocale s'enchaînent. La saisie de texte est aussi disponible.
- **Deux aides indépendantes :** idées, expressions et exemples à déplier en haut ; retour sur la dernière intervention de l'utilisateur en bas. Mise à jour et nouvelle tentative séparées pour chaque panneau.
- **Langues et niveaux :** choisissez une langue d'appui et une langue à pratiquer, échangez-les ou indiquez des codes de langue. A1–C1 sert de repère de difficulté.
- **Entraînement personnalisé :** décrivez une situation et ajoutez un article, un CV, du vocabulaire ou d'autres documents. Vérifiez l'importation avant de l'appliquer et enregistrez des modèles.
- **Fichiers et images :** TXT, Markdown, CSV, PDF contenant du texte, DOCX, PNG, JPG et WebP. Les documents sont convertis en texte localement ; les images choisies nécessitent un modèle de vision.
- **Fournisseurs :** MiniMax, DeepSeek, OpenAI, Qwen et API compatibles Chat Completions. Chaque aide peut utiliser un autre ID de modèle avec le même fournisseur et la même clé de conversation.
- **Voix et pauses :** douze voix MiniMax nommées avec préécoute, voix de l'appareil, ID personnalisés et attente de deux, trois ou cinq secondes.
- **Apprentissage :** douze activités de communication, expressions enregistrées, carnet de corrections, révision espacée, objectifs et statistiques par paire de langues. Quatre thèmes, sous-titres facultatifs, traduction à la demande, nouvel essai après correction et export texte.

**La caméra sert uniquement à l'aperçu local : l'IA ne reçoit pas ses images.** La compréhension vidéo en direct n'est pas implémentée. L'analyse d'une image choisie dans l'entraînement personnalisé est un envoi explicite distinct.

## Démarrage rapide

Prérequis : Node.js 22.13 ou plus récent (24 recommandé), npm et un navigateur moderne. Chrome / Edge sont recommandés pour la reconnaissance du navigateur ; les langues disponibles dépendent du service.

Depuis la racine du dépôt :

```sh
cd easy-speak
npm ci --cache .npm-cache
npm run dev
```

Ouvrez l'adresse indiquée, généralement <http://127.0.0.1:5173/>.

1. Dans les paramètres en haut à droite, choisissez un fournisseur et renseignez Base URL, votre clé API et l'ID du modèle.
2. Dans les préférences vocales, choisissez reconnaissance du navigateur / voix de l'appareil ou configurez MiniMax ASR / TTS.
3. Autorisez le micro et parlez après votre interlocuteur. En cas de blocage des permissions ou du son, suivez les indications ou écrivez.
4. Changez les langues ou la situation en haut. L'entraînement personnalisé se trouve dans le sélecteur de situations.

Sans clé, seule une démonstration locale signalée d'anglais avec aide en chinois est disponible. Les autres paires de langues, l'entraînement personnalisé et les vraies réponses exigent un fournisseur configuré. Aucune clé partagée ni quota gratuit n'est fourni ; les frais relèvent de votre compte.

### Facultatif : proxy MiniMax local

Dans le dossier de l'application, copiez l'exemple :

```sh
# macOS / Linux
cp .env.example .env.local
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env.local
```

Renseignez MINIMAX_API_KEY dans .env.local puis redémarrez le serveur. N'utilisez pas le préfixe VITE_ pour les secrets et ne versionnez pas .env.local. Le navigateur reçoit seulement l'état de connexion et une valeur de substitution.

Ce proxy accepte uniquement l'accès en boucle locale. Il sert au développement et n'accompagne pas l'hébergement statique ; ce n'est pas un backend public partagé. Voir les [fournisseurs](./easy-speak/docs/providers.md).

Sous Windows, après installation des dépendances, lancez en arrière-plan depuis la racine :

```powershell
.\Start-EasySpeak.ps1
```

Le script réutilise un serveur sain ou le lance sans fenêtre, avec les journaux dans le projet. Il ne configure pas de lancement automatique à l'ouverture de Windows.

## Architecture et confidentialité

Le flux vocal est **ASR → modèle de langage → TTS**. La réponse principale et la correction s'exécutent en parallèle ; les suggestions arrivent après la réponse. L'annulation et les versions empêchent les anciens résultats d'écraser une nouvelle session.

- Le micro est nécessaire pour parler. MiniMax ASR reçoit l'enregistrement courant ; la reconnaissance du navigateur dépend de son navigateur et de son service.
- La caméra est facultative et locale : aucun enregistrement ou envoi d'image. Elle est libérée à sa fermeture, à la fin de l'échange ou au passage en arrière-plan.
- Seuls les fichiers choisis sont lus. Les documents sont traités localement ; la vision envoie une image compressée. Les textes acceptés sont transmis au modèle au début de l'entraînement.
- Les clés directes sont stockées dans le sessionStorage de l'onglet, qui n'est pas un coffre sécurisé. La clé du proxy reste dans .env.local, ignoré par Git ; les préférences durables et exports n'incluent pas de clé.
- Historique, expressions et modèles explicitement enregistrés restent dans ce navigateur. Il n'y a ni comptes ni synchronisation cloud ; exportez avant d'effacer les données.

## Développement et documentation

L'application se trouve dans easy-speak/. src/ contient composants, hooks et modules ; server/ contient le proxy et les contrôles de build ; tests/ et docs/ regroupent tests et spécifications. Les anciennes clés de stockage restent compatibles avec les données existantes.

Dans le dossier de l'application :

```sh
npm run format:check
npm run lint
npm test
npm run build
npm run preview
```

Le build sort dans easy-speak/dist ; preview sert uniquement à la vérification locale. Créez une archive du code depuis la racine :

```powershell
.\Export-EasySpeak.ps1
```

release/easy-speak-source.zip contient une liste explicite de fichiers, contrôlée pour les clés connues et certains motifs de secrets. Environnements privés, dépendances, caches, journaux, builds et données du navigateur sont exclus. Le script ne téléverse rien.

[Fonctions](./easy-speak/docs/features.md) · [Architecture](./easy-speak/docs/architecture.md) · [Entraînement](./easy-speak/docs/custom-training.md) · [Langues](./easy-speak/docs/languages.md) · [Voix](./easy-speak/docs/voices.md) · [Apprentissage](./easy-speak/docs/learning.md) · [Permissions](./easy-speak/docs/permissions.md) · [Packaging](./easy-speak/docs/packaging.md) · [Déploiement](./easy-speak/DEPLOYMENT.md) · [Sécurité](./easy-speak/docs/security-review.md) · [Vérification](./easy-speak/docs/verification.md)

C'est actuellement une Web App, sans APK / IPA prêt ni projet mobile natif. Audio, Bluetooth et reprise en arrière-plan exigent des essais réels. L'authentification, les quotas par utilisateur et la protection de facturation d'un backend public ne sont pas implémentés. Modèles, langues, voix et CORS dépendent des fournisseurs. Les retours utilisent le texte transcrit et ne mesurent pas la prononciation ni l'aisance réelle.

## Contributions et licence

Consultez les [règles de développement](./easy-speak/CONTRIBUTING.md) et le [signalement de sécurité](./SECURITY.md). Retirez clés et documents privés des rapports.

Les parties originales sont sous [Apache License 2.0](./LICENSE), autorisant l'usage commercial, la modification et la distribution. Conservez les mentions applicables de [NOTICE](./NOTICE) et de copyright, fournissez la licence et signalez les fichiers modifiés. Aucun droit sur les marques ni garantie n'est accordé ; le texte anglais fait foi. Voir les [mentions tierces](./THIRD_PARTY_NOTICES.md).
