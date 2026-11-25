# WhatsApp Sound Sticker Bot

[![CI](https://github.com/DavidRamirez206/whatsapp-sound-sticker-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/DavidRamirez206/whatsapp-sound-sticker-bot/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/DavidRamirez206/whatsapp-sound-sticker-bot)](https://github.com/DavidRamirez206/whatsapp-sound-sticker-bot/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**English** · [Español](README.es.md)

A small WhatsApp bot that turns a video into an **animated sticker that plays its sound**. Send a video
with the caption `!a` to the WhatsApp account running the bot and it replies with the sticker.

It is a simple project, but it is also used here as a practical excuse to talk about something that
matters much more: **what really happens to your data when you send it to a bot**, and which
precautions to take with this or any other bot. Please read [Security, privacy and risks](#security-privacy-and-risks)
before using it.

---

## Table of contents

- [How it works](#how-it-works)
- [Features](#features)
- [Disclaimer](#disclaimer)
- [Option A: ready-to-run executable (recommended)](#option-a-ready-to-run-executable-recommended)
- [Option B: run from source](#option-b-run-from-source)
  - [Windows](#windows-1)
  - [Linux](#linux-1)
- [Linking your WhatsApp account](#linking-your-whatsapp-account)
- [Usage](#usage)
- [Configuration](#configuration)
- [How long videos are encoded](#how-long-videos-are-encoded)
- [Project structure](#project-structure)
- [Tests](#tests)
- [Building the executable and publishing releases](#building-the-executable-and-publishing-releases)
- [Troubleshooting](#troubleshooting)
- [Security, privacy and risks](#security-privacy-and-risks)
- [License](#license)

---

## How it works

1. The bot connects to WhatsApp as a **linked device** of a normal account (the same mechanism
   WhatsApp Web uses) through [Baileys](https://github.com/WhiskeySockets/Baileys).
2. When a video arrives with the caption `!a`, the bot downloads it and uses **FFmpeg** to produce:
   - an animated **WebP** of 512×512 px under 500 KB (WhatsApp's sticker limits), and
   - an **Ogg/Opus** audio track exactly as long as the animation.
3. Both files are uploaded to WhatsApp's media servers.
4. A WhatsApp sticker with sound is a regular `StickerMessage` that carries a complete
   `AudioMessage` in protobuf **field 26**. Baileys does not know that field, so the bot patches the
   message encoder to append it (`src/sticker-audio-patch.js`).
5. The sticker is sent as a reply to the message that asked for it.

## Features

- Stickers with sound from any video with audio, up to 25 s by default (configurable).
- Content-aware encoding: picks the best frame rate and quality that fit in 500 KB
  ([details](#how-long-videos-are-encoded)).
- Audio and animation lengths are matched to the millisecond, so the sound does not drift when the sticker loops.
- Local validation of every sticker/audio pair before sending it.
- Login by QR code or by pairing code.
- Privacy by default: received videos are processed in a temporary folder and deleted afterwards.
- Standalone executables for Windows and Linux with FFmpeg included.
- Unit and integration tests (`node:test`), CI on Windows and Linux.

## Disclaimer

This project is **not affiliated with, endorsed by or supported by WhatsApp or Meta**. It uses an
unofficial client library. Automating a personal account may break
[WhatsApp's Terms of Service](https://www.whatsapp.com/legal/terms-of-service) and **the account can
be temporarily or permanently banned**. Use a secondary number you can afford to lose, and use the
bot for personal, non-commercial, non-spam purposes. You are responsible for how you use it.

---

## Option A: ready-to-run executable (recommended)

No Node.js and no FFmpeg installation needed: everything is in the package.

1. Open the [latest release](https://github.com/DavidRamirez206/whatsapp-sound-sticker-bot/releases/latest).
2. Download the file for your system:
   - Windows: `whatsapp-sound-sticker-bot-vX.Y.Z-windows-x64.zip`
   - Linux: `whatsapp-sound-sticker-bot-vX.Y.Z-linux-x64.tar.gz`
3. *(Recommended)* Verify the download against `SHA256SUMS.txt` from the same release:
   - Windows (PowerShell): `Get-FileHash .\whatsapp-sound-sticker-bot-*-windows-x64.zip -Algorithm SHA256`
   - Linux: `sha256sum -c SHA256SUMS.txt --ignore-missing`

   The printed hash must be identical to the one in `SHA256SUMS.txt`.
4. Extract it into a folder of its own (the bot will create its session folder there).

### Windows

1. Right click the `.zip` → **Extract All…** → choose a folder, e.g. `C:\sound-sticker-bot`.
2. Double click `sound-sticker-bot.exe`.
   - Windows SmartScreen may say *"Windows protected your PC"* because the executable is not code-signed.
     Click **More info → Run anyway** only if you downloaded it from the official release page above
     and the checksum matches.
3. A console window opens and shows a QR code. Continue with
   [Linking your WhatsApp account](#linking-your-whatsapp-account).
4. To stop the bot, close the window or press `Ctrl + C`.

> Tip: if the QR code looks broken, open the folder in **Windows Terminal** (right click inside the folder →
> *Open in Terminal*) and run `.\sound-sticker-bot.exe`. Windows Terminal renders the QR code better
> than the old console.

### Linux

```bash
mkdir -p ~/sound-sticker-bot && cd ~/sound-sticker-bot
tar -xzf ~/Downloads/whatsapp-sound-sticker-bot-*-linux-x64.tar.gz --strip-components=1
./sound-sticker-bot
```

If you get *permission denied*, run `chmod +x sound-sticker-bot ffmpeg ffprobe` and try again.
The executable targets x86-64 systems with glibc (Ubuntu, Debian, Fedora, Arch, Mint, …).

### Changing settings with the executable

Copy `.env.example` to `.env` in the same folder and edit it with any text editor
(see [Configuration](#configuration)). Restart the bot after changing it.

---

## Option B: run from source

Requirements:

| Tool | Version | Why |
| --- | --- | --- |
| [Node.js](https://nodejs.org) | 22.12 or newer (24 LTS recommended) | Runs the bot |
| [FFmpeg](https://ffmpeg.org) (with `ffprobe`) | 6 or newer, built with `libwebp` and `libopus` | Converts video and audio |
| [Git](https://git-scm.com) | any | Downloads the code (or download the ZIP from GitHub) |

### Windows

1. **Install Node.js**
   - Download the **LTS** installer from <https://nodejs.org> and run it with the default options, **or**
   - in PowerShell: `winget install OpenJS.NodeJS.LTS`
2. **Install FFmpeg**
   - In PowerShell: `winget install Gyan.FFmpeg` (full build, includes `ffprobe`, `libwebp` and `libopus`), **or**
   - with [Chocolatey](https://chocolatey.org): `choco install ffmpeg`, **or**
   - manually: download a *full* build from <https://www.gyan.dev/ffmpeg/builds/>, extract it to
     `C:\ffmpeg` and add `C:\ffmpeg\bin` to the `Path` (Start → *Edit the system environment variables* →
     *Environment Variables* → `Path` → *Edit* → *New*).
3. **Install Git** (optional): `winget install Git.Git`
4. **Close and reopen** PowerShell so the new `Path` is picked up, then check:
   ```powershell
   node --version     # v22.12.0 or newer
   ffmpeg -version
   ffprobe -version
   ```
5. **Download and start the bot**
   ```powershell
   git clone https://github.com/DavidRamirez206/whatsapp-sound-sticker-bot.git
   cd whatsapp-sound-sticker-bot
   npm ci
   npm start
   ```

### Linux

1. **Install FFmpeg and Git**
   ```bash
   # Debian / Ubuntu / Linux Mint
   sudo apt update && sudo apt install -y ffmpeg git curl

   # Fedora (enable RPM Fusion first for the full FFmpeg: https://rpmfusion.org/Configuration)
   sudo dnf install -y ffmpeg git

   # Arch / Manjaro
   sudo pacman -S --needed ffmpeg git
   ```
2. **Install Node.js** with [nvm](https://github.com/nvm-sh/nvm) (no root needed, easy to update):
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   source ~/.bashrc      # or open a new terminal
   nvm install 24
   ```
   Distribution packages (`apt install nodejs`) are often too old; check with `node --version`.
3. **Check the tools**
   ```bash
   node --version                                   # v22.12.0 or newer
   ffmpeg -hide_banner -encoders | grep -E " libwebp | libopus "   # both must appear
   ```
4. **Download and start the bot**
   ```bash
   git clone https://github.com/DavidRamirez206/whatsapp-sound-sticker-bot.git
   cd whatsapp-sound-sticker-bot
   npm ci
   npm start
   ```

#### Keeping it running on a Linux server (optional)

Example `systemd` unit (`/etc/systemd/system/sound-sticker-bot.service`). Link the account once
interactively with `npm start` before enabling the service, because the QR code is shown in the terminal.

```ini
[Unit]
Description=WhatsApp sound sticker bot
After=network-online.target

[Service]
User=youruser
WorkingDirectory=/home/youruser/whatsapp-sound-sticker-bot
ExecStart=/home/youruser/.nvm/versions/node/v24.11.1/bin/node index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now sound-sticker-bot
journalctl -u sound-sticker-bot -f     # live logs
```

Adjust `User`, the paths and the Node version (`which node`) to your machine.

---

## Linking your WhatsApp account

The bot works as one more **linked device** of an existing WhatsApp account, like WhatsApp Web.
Messages that account receives with the caption `!a` are processed. **Use a secondary number** if you can
(see [Disclaimer](#disclaimer)).

### With a QR code (default)

1. Start the bot. A QR code appears in the terminal.
2. On the phone: **WhatsApp → Settings (⋮ on Android) → Linked devices → Link a device**.
3. Scan the QR code. The terminal shows `[CONNECTION] linked`.

### With a pairing code (no camera needed)

1. Put your number in `.env`, with country code and digits only: `PAIRING_NUMBER=573001234567`.
2. Start the bot. It prints `[LOGIN] Pairing code: ABCD-EFGH`.
3. On the phone: **Linked devices → Link a device → Link with phone number instead** and type the code.

### Session folder

After linking, the credentials are stored in `whatsapp_session/`. Next time the bot starts it logs in
automatically. **That folder is equivalent to your password**: anyone who copies it can read and send
messages as you. Never share it, upload it or commit it (it is already in `.gitignore`).

### Unlinking

- On the phone: **Linked devices → tap the device → Log out**, and then delete `whatsapp_session/`.
- If the bot says `logged out`, delete `whatsapp_session/` and start again to link anew.

---

## Usage

1. Open any chat with the account running the bot (or, if you linked your own number, use the
   **"Message yourself"** chat).
2. Send a **video with sound** and write `!a` as its caption.
3. The bot replies with the animated sticker. Tap it to hear the sound.

Notes:

- Videos longer than `MAX_SECONDS` (25 s by default) are cut at that point.
- Videos without an audio track are rejected with a message.
- It also works in groups: any member can trigger it (see [risks](#5-running-a-bot-in-groups)).
- WhatsApp clients that do not support stickers with sound show only the animation.

---

## Configuration

Settings are environment variables. The easiest way is a `.env` file next to the bot
(copy `.env.example` to `.env`). Real environment variables take precedence over the file.

| Variable | Default | Description |
| --- | --- | --- |
| `COMMAND` | `!a` | Caption that triggers the bot. |
| `MAX_SECONDS` | `25` | Longest sticker in seconds (1–60). |
| `MAX_FRAMES` | `250` | Maximum frames per sticker. Fewer frames = less stutter on old phones. |
| `AUDIO_KBPS` | `32` | Opus bitrate of the sticker audio. |
| `AUDIO_LEAD_MS` | `100` | Milliseconds skipped at the start of the audio to compensate WhatsApp's playback delay. Raise if the sound is late, lower/`0` if it is early. |
| `MAX_PARALLEL_JOBS` | `2` | Videos converted at the same time. |
| `REPLY_TO_MESSAGE` | `1` | Send the sticker as a reply to the request. |
| `SESSION_DIR` | `whatsapp_session` | Folder holding the WhatsApp credentials. |
| `PAIRING_NUMBER` | *(empty)* | Phone number (digits, with country code) to log in with a pairing code instead of a QR code. |
| `SAVE_OUTPUTS` | `0` | `1` keeps every received video and generated file in `OUTPUTS_DIR`. Off by default for privacy. |
| `OUTPUTS_DIR` | `outputs` | Where files are kept when `SAVE_OUTPUTS=1`. |
| `KEEP_OUTPUTS` | `15` | Number of saved folders kept (oldest are deleted). |
| `DEBUG` | `0` | Diagnostic mode: enables the test command, prints raw protocol messages, analyses incoming sound stickers and verifies uploads. |
| `TEST_COMMAND` | `!t` | (Debug only) Sends 5 stickers with different audio encodings to compare which ones play. |
| `VERIFY_UPLOAD` | same as `DEBUG` | Re-downloads every upload and checks hash and playability. |
| `FFMPEG_PATH`, `FFPROBE_PATH` | *(auto)* | Custom FFmpeg binaries. By default they are searched next to the executable and then on `PATH`. |

Examples:

```bash
# Linux / macOS, one-off
MAX_SECONDS=10 npm start
```

```powershell
# Windows PowerShell, one-off
$env:MAX_SECONDS=10; npm start
```

---

## How long videos are encoded

WhatsApp rejects animated stickers over **500 KB**, so for long clips the encoder has to trade frame
rate against image quality. The earlier version of this bot had three problems with clips over 10 s:

1. A fixed frame budget (130 frames) forced every long clip down to 5–6 fps, even simple ones that
   could afford more.
2. It guessed the quality from a single 3-second sample from the middle of the clip, guessed wrong on
   detailed videos and then ran a ladder of five full encodes.
3. It encoded at the slowest effort level, many times slower than level 4 for files only ~2 % smaller.

The current encoder (`src/media/sticker.js`):

1. Encodes **every frame as a complete picture** with FFmpeg's `libwebp`. The animated encoder
   (`libwebp_anim`) produces smaller files but reuses blocks from the previous frame when they "barely
   changed", with a tolerance that grows as quality drops; at the qualities long clips need, that leaves
   stale, pixelated blocks over moving images, so it is not used.
2. Cuts a sample made of three 1-second windows spread across the clip and encodes it at 8 quality
   levels in parallel, measuring the **cost of one frame** at each quality. Since frames are independent,
   the size of the full sticker is predictable: it grows linearly with the number of frames.
3. Chooses the **highest frame rate that keeps quality ≥ 30** within the budget (then ≥ 12), capped by
   `MAX_FRAMES`. If not even that fits, it keeps 5 fps and the best quality that fits: sharp frames look
   better than a few extra blurry ones. Simple or mostly static videos keep up to 15 fps even when long.
4. Encodes the whole clip at effort level 4. If the result left room, it tries one quality step higher
   and keeps it if it still fits under 500 KB.

Measured on the same machine with real videos (PSNR compares every sticker frame with the original
video frame; higher is sharper):

| Clip | Before | After |
| --- | --- | --- |
| 6.5 s, 1280×2276 | 15 fps, q50, 26.4 dB – 14.3 s | 15 fps, q75, 26.7 dB – 10.0 s |
| 18.9 s, 800×480 | 5 fps, q6, 29.9 dB – 24.4 s | 5 fps, q6, 29.9 dB – 10.1 s |
| 22.9 s, 800×480 | 5 fps, q6, 30.8 dB – 25.2 s | 5 fps, q6, 30.8 dB – 18.0 s |
| 25 s (cut from 120 s), 496×368 | 5 fps, q6, 33.5 dB – 10.2 s | 5 fps, q12, 34.5 dB – 18.3 s |

"q" is libwebp's quality (0–100); the time is the full conversion. Detailed, high-motion clips of
20 s or more simply do not fit more than ~5 fps in 500 KB without visibly losing sharpness.

---

## Project structure

```text
index.js                      Entry point (fatal error handling)
src/
├── main.js                   Bootstrap: config, FFmpeg check, protocol patches, start
├── config.js                 Environment / .env parsing
├── bot.js                    WhatsApp connection, login, reconnection, message routing
├── handlers.js               Sticker command and debug test command
├── queue.js                  Concurrency-limited job queue
├── retry.js                  Timed pipeline steps with network retries
├── workdir.js                Temporary / saved work folders
├── logger.js                 Console logging (hides Signal session dumps)
├── protobuf.js               Schema-less protobuf reader
├── sticker-audio-patch.js    Adds the audio (field 26) to outgoing stickers
├── media/
│   ├── ffmpeg.js             Locating and running FFmpeg / FFprobe
│   ├── probe.js              Video/audio inspection
│   ├── sticker.js            Video → animated WebP (frame rate / quality planner)
│   ├── audio.js              Audio extraction and waveform
│   ├── webp.js               WebP container parser
│   └── validate.js           Pre-send validation
└── whatsapp/
    ├── send.js               Upload and send a sound sticker
    ├── verify.js             Optional re-download check
    └── inspect.js            Debug: analyse incoming sound stickers
scripts/
├── bundle.js                 esbuild bundle → dist/bot.cjs
└── build-sea.js              Node single executable → dist/sound-sticker-bot(.exe)
test/
├── unit/                     Pure logic tests
└── integration/              Real FFmpeg pipeline tests (skipped without FFmpeg)
```

## Tests

```bash
npm test            # unit + integration (integration tests are skipped if FFmpeg is missing)
npm run test:unit   # unit tests only, no FFmpeg needed
```

The suite uses Node's built-in test runner; there are no test dependencies. CI runs it on Windows and Linux
with Node 22 and 24 on every push and pull request.

## Building the executable and publishing releases

Build locally (produces an executable for the current OS in `dist/`):

```bash
npm ci
npm run build:exe
```

The build bundles all the code with **esbuild** into `dist/bot.cjs` and injects it into a copy of the Node
binary using [Node single executable applications](https://nodejs.org/api/single-executable-applications.html).
FFmpeg is not embedded: put `ffmpeg` and `ffprobe` next to the executable or on `PATH`.

Publishing a release is automated by `.github/workflows/release.yml`:

```bash
git tag v1.0.1
git push origin v1.0.1
```

The workflow tests the code, builds the executables on Windows and Linux, adds the
[LGPL FFmpeg builds from BtbN](https://github.com/BtbN/FFmpeg-Builds), checks that they include the required
encoders, and publishes the archives plus `SHA256SUMS.txt` on the release page.

## Troubleshooting

| Problem | Solution |
| --- | --- |
| `FFmpeg/FFprobe not found` | Install FFmpeg (see above) and reopen the terminal, or use the release package, or set `FFMPEG_PATH`/`FFPROBE_PATH`. |
| `Your FFmpeg build lacks the encoder(s)` | Your FFmpeg is a minimal build. Install a full build (`Gyan.FFmpeg` on Windows, RPM Fusion on Fedora). |
| The QR code is unreadable | Make the terminal bigger or use Windows Terminal, or log in with `PAIRING_NUMBER`. |
| `logged out` | The device was unlinked from the phone. Delete `whatsapp_session/` and link again. |
| Nothing happens when sending `!a` | The caption must be exactly `!a` and the message must be a video (not a GIF). Check the console for `[IN]`. Messages older than 2 minutes are ignored. |
| `fetch failed` / `ETIMEDOUT` | Network problem talking to WhatsApp's media servers. The bot retries automatically; check your connection or firewall. |
| The sticker arrives without sound | The recipient's WhatsApp may not support stickers with sound yet (update it). With `DEBUG=1`, use `!t` to compare audio encodings. |
| The sound is out of sync | Adjust `AUDIO_LEAD_MS` (e.g. `0`, `100`, `200`). |
| `require() of ES Module` error | Your Node.js is older than 22.12. Update it. |

---

## Security, privacy and risks

This bot is small, but it touches everything that makes messaging bots risky: an account, other
people's media, servers and executables. The points below apply to **any** bot on WhatsApp, Telegram,
Discord, Instagram or similar platforms, and to online "converters" and AI tools too.

### 1. End-to-end encryption ends at the bot

WhatsApp encrypts messages between devices, but **a bot is one of those devices**. When you send a
video to a bot, it is decrypted on the bot owner's computer or server, and from there the owner can do
anything with it: watch it, store it, forward it, use it to train models or sell it. Encryption protects
the trip, not what the receiver does with the content.

- This bot processes each video in a temporary folder and **deletes it** when it finishes, unless the
  operator enables `SAVE_OUTPUTS=1`. But **you cannot verify that from the outside** with someone else's bot.
  Assume that anything you send to a bot you do not run yourself is kept.

### 2. What not to send to a bot

- Videos or photos showing your **face or body in private situations**, **children**, your home,
  your **ID card**, documents, bank or medical information, license plates, or screens with personal data.
- Anything you would not want published: once a sticker exists, it **can be forwarded endlessly and
  cannot be recalled**. Deleting the message does not delete the copies.
- **Metadata**: files sent as *documents* keep their original metadata (date, device model and
  sometimes **GPS location**). Prefer sending media normally, or remove the metadata first.
- **Other people's images without their consent.** Turning someone into a sticker can be harassment and,
  depending on the country, a crime (image rights, data protection laws such as GDPR or Colombia's
  Law 1581 of 2012). Respect copyright too.

### 3. Your account and the session folder

- `whatsapp_session/` contains the keys of a linked device: **whoever has it can read and send your
  messages** without your phone noticing anything obvious. Never upload it, share it, commit it or
  include it in a backup you do not control.
- The bot receives (and decrypts) **every message of the linked account**, not only commands. Run it on
  a computer you trust, with an up-to-date OS and a user password.
- Review **Linked devices** on your phone regularly and log out anything you do not recognise.
- Unofficial clients can get the number **banned**. Use a secondary number; never your work number.

### 4. Codes, links and fake bots

- **Never share a 6-digit WhatsApp verification code** or a pairing code with anyone, including
  "bots", "support agents" or friends asking for it: that is how accounts are hijacked.
- Only link a device by scanning a QR code or typing a code **that you generated yourself** on your own
  computer. Never scan a QR code someone sends you "to activate the bot".
- Be suspicious of bots that ask for permissions, payments, personal data, or that send links or APK
  files. A sticker bot only needs a video.

### 5. Running a bot in groups

- Any group member can trigger it, and it can be abused to **spend your CPU and bandwidth** or to send
  unwanted content in your name. `MAX_PARALLEL_JOBS` and `MAX_SECONDS` limit the cost.
- Everything the bot sends goes out **from your account**: you are responsible for it.
- Tell the group a bot is present: other members' messages are decrypted on your computer.

### 6. Logs

- The console shows phone numbers / chat identifiers and contact names. `DEBUG=1` prints even more.
  **Redact them before sharing a log** in an issue or chat.
- The bot already hides the Signal session dumps that the underlying library prints, because they contain
  private keys.

### 7. Executables and dependencies

- Download executables **only from the official release page**, and check the `SHA256SUMS.txt`
  hash. A tampered "sticker bot" executable is an easy way to spread malware.
- The executables are not code-signed, so Windows shows a SmartScreen warning. If you prefer not to run
  an unsigned binary, use [Option B](#option-b-run-from-source) and read the code first.
- Keep Node.js, FFmpeg and the dependencies up to date (`npm outdated`, `npm audit`). Baileys is a
  reverse-engineered library: WhatsApp protocol changes can break it.

### Quick checklist

- [ ] I use a secondary number for the bot.
- [ ] `whatsapp_session/` and `.env` stay on my machine only.
- [ ] I only send media I would be fine seeing published.
- [ ] I have consent from the people who appear in the videos.
- [ ] I never share verification or pairing codes.
- [ ] I downloaded the executable from the official release and checked its hash.
- [ ] I review the linked devices on my phone from time to time.

---

## License

[MIT](LICENSE) © 2026 Ismael Barrionuevo.

The release packages include unmodified [FFmpeg](https://ffmpeg.org) binaries licensed under the
**LGPL v2.1 or later** (built by [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)); see
`FFMPEG-LICENSE.txt` and `FFMPEG-NOTICE.txt` inside each package. WhatsApp is a trademark of Meta
Platforms, Inc.

Built with [Baileys](https://github.com/WhiskeySockets/Baileys), [FFmpeg](https://ffmpeg.org),
[pino](https://github.com/pinojs/pino) and [qrcode-terminal](https://github.com/gtanner/qrcode-terminal).
