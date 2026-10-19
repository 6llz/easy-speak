<div align="center">

<img src="./easy-speak/public/favicon.svg" width="76" height="76" alt="EasySpeak" />

# EasySpeak · 轻松说

[简体中文](./README.md) · **English** · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

**Practice the language you want to speak, as naturally as chatting with a friend.**

</div>

EasySpeak is a mobile-first AI conversation practice Web App for adults. A main partner keeps the conversation going, while two fixed coaching panels help independently: the upper panel suggests what to say next; the lower panel reviews only your latest utterance.

> **Open source under [Apache License 2.0](./LICENSE). Commercial use, modification and distribution are allowed subject to its terms.** Keep required license and attribution notices and identify modifications. Third-party components retain their own licenses.

Use the language links above to switch README versions. Detailed engineering documents are currently mostly in Chinese.

## Features

| Feature                   | What it does                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Natural voice turns       | Half-duplex speech: listen while AI speaks, then talk; transcription, streamed replies and speech playback follow. Text input is also available.           |
| Two independent coaches   | Ideas, useful phrases and optional examples above; feedback on your latest utterance below. Each panel updates and retries independently.                  |
| Language pairs and levels | Choose a familiar language and a practice language, swap them or enter language codes; A1–C1 levels guide difficulty.                                      |
| Custom training           | Describe any scenario and add articles, a résumé, vocabulary or other material. Preview imports before applying them and save reusable templates.          |
| Files and images          | TXT, Markdown, CSV, text PDFs, DOCX, PNG, JPG and WebP. Documents become text locally; selected images require a vision-capable model.                     |
| Model providers           | MiniMax, DeepSeek, OpenAI, Qwen and compatible custom Chat Completions endpoints. Coaches may use separate model IDs under the same chat provider and key. |
| Voices and pacing         | Twelve named MiniMax voice presets with previews, device voices, custom voice IDs and two-, three- or five-second pause settings.                          |
| Learning and review       | Twelve communication lessons, saved expressions, a correction notebook, spaced review, personal goals and statistics by language pair.                     |
| Focused interface         | Four themes, optional captions, on-demand translation, correction rehearsal and text exports.                                                              |

**The camera is local preview only. AI does not receive camera frames.** Live video understanding is not implemented. Image reading in custom training is a separate, explicit upload.

## Quick start

Requirements: Node.js 22.13+ (24 recommended), npm and a modern browser. Chrome / Edge are recommended for browser speech recognition; available languages depend on the selected service.

From the repository root:

```sh
cd easy-speak
npm ci --cache .npm-cache
npm run dev
```

Open the address printed in the terminal, normally <http://127.0.0.1:5173/>.

1. Open settings at the top right. Under model settings, choose a provider and enter your Base URL, personal API key and model ID.
2. Select browser recognition / device speech or configure MiniMax ASR / TTS in speech preferences.
3. Allow microphone access and speak after the partner finishes. Follow recovery prompts if permissions or playback are blocked, or type instead.
4. Change languages or scenes at the top. Custom training is inside the scene picker.

Without a key, a clearly marked local demo supports Chinese-assisted English practice. Other language pairs, custom training and real AI replies require a configured provider. No shared key or free API quota is included; provider charges belong to your account.

### Optional local MiniMax proxy

In the application directory, copy the example environment file:

```sh
# macOS / Linux
cp .env.example .env.local
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env.local
```

Set only MINIMAX_API_KEY in .env.local and restart the development server. Never use the VITE_ prefix for secrets or commit .env.local. The browser receives a placeholder and connection status, not the server key.

The proxy accepts loopback access only. It is for local development, is absent from static hosting and is not a public shared backend. See [provider setup](./easy-speak/docs/providers.md).

### Background startup on Windows

After installing dependencies, run this from the repository root:

```powershell
.\Start-EasySpeak.ps1
```

It reuses a healthy server or starts it hidden, with logs inside the project. It does not configure startup at Windows login.

## Architecture and privacy

The voice pipeline is **ASR → language model → TTS**, with half-duplex turns. The main reply and latest-utterance review run in parallel; the suggestion coach updates after the main reply. Cancellation and version checks isolate outdated work.

- **Microphone:** needed only for voice input. MiniMax ASR receives the current recording; browser recognition follows its browser/service data handling.
- **Camera:** optional local preview; no recording or image upload. Closing, ending or backgrounding the conversation releases it.
- **Material:** only selected files are read. Documents are parsed locally; image understanding uploads a compressed image. Accepted text is sent to the model when training starts.
- **Keys:** direct API keys use the current tab's sessionStorage, not a secure device vault. Local proxy credentials stay in the ignored .env.local file; exports and long-term preferences exclude keys.
- **Progress:** conversations, saved expressions and explicitly saved training templates stay in this browser. There is no account system or cloud sync; export before clearing browser data.

The application lives in easy-speak/. Component, hook and library layers are under src/; server/ contains the local proxy and build guard; tests/ and docs/ contain validation and specifications. Legacy browser storage keys remain compatible.

## Development and source exports

Inside the application directory:

```sh
npm run format:check
npm run lint
npm test
npm run build
npm run preview
```

Build output is easy-speak/dist. Preview is for local inspection, not a production server. Generate a shareable source ZIP from the repository root:

```powershell
.\Export-EasySpeak.ps1
```

The script writes release/easy-speak-source.zip from an explicit file list and checks for known credentials and common secret patterns. Environment secrets, dependencies, caches, logs and build artifacts are excluded. It does not upload anything or include browser learning data.

## Documentation and current limits

- [Features](./easy-speak/docs/features.md) · [Architecture](./easy-speak/docs/architecture.md) · [Providers](./easy-speak/docs/providers.md)
- [Custom training](./easy-speak/docs/custom-training.md) · [Languages](./easy-speak/docs/languages.md) · [Voices](./easy-speak/docs/voices.md)
- [Learning](./easy-speak/docs/learning.md) · [Pause timing](./easy-speak/docs/conversation-timing.md) · [Audio troubleshooting](./easy-speak/docs/audio-playback.md)
- [Permissions](./easy-speak/docs/permissions.md) · [Packaging](./easy-speak/docs/packaging.md) · [Deployment](./easy-speak/DEPLOYMENT.md)
- [Security review](./easy-speak/docs/security-review.md) · [Verification](./easy-speak/docs/verification.md) · [Release notes](./easy-speak/docs/source-release.md)

This is a Web App, with no ready APK / IPA or native mobile project. Real phone audio, Bluetooth and background behavior still need device testing. There is no public-backend authentication, per-user quota or shared-billing protection. Model, language, voice and CORS support depend on providers. Feedback uses transcripts and cannot measure pronunciation or actual fluency. Camera scene understanding is not implemented.

## Contributing and license

See [contribution standards](./easy-speak/CONTRIBUTING.md) and [security reporting](./SECURITY.md). Remove keys and private material from reports.

The original project is licensed under [Apache License 2.0](./LICENSE). Preserve applicable [NOTICE](./NOTICE) and copyright information, include the license when redistributing and mark modified files. The license grants no trademark rights and provides no warranty; its English text governs. See [third-party notices](./THIRD_PARTY_NOTICES.md) for dependency licensing.
