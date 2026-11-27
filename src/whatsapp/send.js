'use strict';

/**
 * Uploading and sending a sticker with sound.
 *
 * Steps:
 *   1. Upload the Ogg/Opus file as an audio message to WhatsApp's media servers.
 *   2. Upload the WebP file as an animated sticker.
 *   3. Build an `AudioMessage` that points at the uploaded audio and register it
 *      with the encoder patch (see `sticker-audio-patch.js`).
 *   4. Build the sticker message (optionally quoting the request) and relay it.
 *
 * Every network step asks the connection for the live socket right before it
 * runs, has a time limit and is retried on transient failures, so a reconnection
 * in the middle of a job delays the sticker instead of losing it. Relaying again
 * after a timeout is safe: the message id stays the same and WhatsApp drops duplicates.
 */

const fs = require('node:fs');
const { prepareWAMessageMedia, generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys');
const { log } = require('../logger');
const { runStep } = require('../retry');
const { computeWaveform } = require('../media/audio');
const { STICKER_SIZE } = require('../media/sticker');
const { parseRawFields, findBytesField, describeRawFields } = require('../protobuf');
const { STICKER_AUDIO_FIELD, attachAudio } = require('../sticker-audio-patch');

const AUDIO_MIMETYPE = 'audio/ogg; codecs=opus';
/** Field number of `stickerMessage` inside `Message`. */
const MESSAGE_STICKER_FIELD = 26;

/** Time limits and retries of the network steps. */
const NETWORK_STEP = Object.freeze({
    upload: { retries: 2, timeoutMs: 90_000 },
    send: { retries: 2, timeoutMs: 30_000 }
});
/** How long a step waits for the connection to come back before failing. */
const CONNECTION_WAIT_MS = 60_000;

/**
 * Checks that an encoded `Message` really carries the audio inside its sticker.
 *
 * @param {Buffer} encodedMessage
 * @returns {number | null} Size of the embedded audio message, or `null` if missing.
 */
function embeddedAudioSize(encodedMessage) {
    const sticker = findBytesField(parseRawFields(encodedMessage), MESSAGE_STICKER_FIELD);
    if (!sticker) return null;
    const audio = findBytesField(parseRawFields(/** @type {Buffer} */ (sticker.payload)), STICKER_AUDIO_FIELD);
    return audio ? /** @type {number} */ (audio.length) : null;
}

/**
 * The JID we speak as. In `@lid` chats our own LID must be used, otherwise the
 * quoted participant ends up empty and clients do not show what we replied to.
 *
 * @param {any} sock
 * @param {string} chatJid
 */
function ownJidFor(sock, chatJid) {
    const me = sock.user || {};
    return chatJid.endsWith('@lid') && me.lid ? me.lid : me.id;
}

/**
 * @typedef {object} UploadedMedia
 * @property {any} audio Uploaded `audioMessage` fields (url, keys, hashes).
 * @property {any} sticker Uploaded `stickerMessage` fields.
 */

/**
 * @typedef {object} ConnectionLike
 * @property {(timeoutMs?: number) => Promise<any>} waitForOpen Resolves with the live socket.
 * @property {(id: string, message: any) => void} rememberSent Keeps a sent message for resend requests.
 */

/**
 * Uploads `file` as `kind` media using the live socket.
 *
 * @param {ConnectionLike} connection
 * @param {string} name Step name for the log.
 * @param {object} media Content for `prepareWAMessageMedia`.
 */
function upload(connection, name, media) {
    return runStep(name, async () => {
        const sock = await connection.waitForOpen(CONNECTION_WAIT_MS);
        return prepareWAMessageMedia(media, { upload: sock.waUploadToServer });
    }, NETWORK_STEP.upload);
}

/**
 * Uploads both files and sends the sticker with sound to `chatJid`.
 *
 * @param {ConnectionLike} connection
 * @param {string} chatJid Destination chat.
 * @param {object} params
 * @param {string} params.webpPath
 * @param {string} params.oggPath
 * @param {number} params.seconds Audio length shown by clients (whole seconds, >= 1).
 * @param {any} [params.quoted] Message to reply to.
 * @param {boolean} [params.debug] Print the raw outgoing message.
 * @returns {Promise<UploadedMedia>}
 */
async function sendSoundSticker(connection, chatJid, { webpPath, oggPath, seconds, quoted, debug = false }) {
    const uploadedAudio = await upload(connection, 'upload audio',
        { audio: fs.readFileSync(oggPath), mimetype: AUDIO_MIMETYPE, seconds });
    const waveform = await runStep('waveform', () => computeWaveform(oggPath));
    const uploadedSticker = await upload(connection, 'upload sticker',
        { sticker: fs.readFileSync(webpPath), isAnimated: true });

    const audio = uploadedAudio.audioMessage;
    const audioMessageBytes = proto.Message.AudioMessage.encode(proto.Message.AudioMessage.create({
        url: audio.url,
        mimetype: AUDIO_MIMETYPE,
        fileSha256: audio.fileSha256,
        fileLength: audio.fileLength,
        seconds,
        ptt: true,
        mediaKey: audio.mediaKey,
        fileEncSha256: audio.fileEncSha256,
        directPath: audio.directPath,
        mediaKeyTimestamp: audio.mediaKeyTimestamp || Math.floor(Date.now() / 1000),
        waveform
    })).finish();

    const sticker = uploadedSticker.stickerMessage;
    sticker.isAnimated = true;
    sticker.width = STICKER_SIZE;
    sticker.height = STICKER_SIZE;

    attachAudio(sticker.fileSha256, audioMessageBytes);
    const sock = await connection.waitForOpen(CONNECTION_WAIT_MS);
    const message = generateWAMessageFromContent(chatJid, { stickerMessage: sticker },
        { quoted, userJid: ownJidFor(sock, chatJid) });

    const context = message.message.stickerMessage && message.message.stickerMessage.contextInfo;
    if (context && context.stanzaId) {
        log('REPLY', `replying to ${context.stanzaId} | participant=${context.participant || '(EMPTY)'}`);
    }

    const encoded = Buffer.from(proto.Message.encode(message.message).finish());
    if (debug) console.log(`[RAW-OUT] outgoing message:\n${describeRawFields(encoded)}`);
    const audioSize = embeddedAudioSize(encoded);
    log('CHECK', audioSize !== null
        ? `audio embedded in the sticker (${audioSize} bytes, ${seconds}s)`
        : 'the audio is NOT embedded in the sticker; it will arrive muted');

    connection.rememberSent(message.key.id, message.message);
    await runStep('send message', async () => {
        const live = await connection.waitForOpen(CONNECTION_WAIT_MS);
        await live.relayMessage(chatJid, message.message, { messageId: message.key.id });
    }, NETWORK_STEP.send);
    return { audio, sticker };
}

/**
 * Sends a plain text message (optionally as a reply) with a time limit and retries.
 *
 * @param {ConnectionLike} connection
 * @param {string} chatJid
 * @param {string} text
 * @param {any} [quoted]
 */
async function sendText(connection, chatJid, text, quoted) {
    const sent = await runStep('send text', async () => {
        const sock = await connection.waitForOpen(CONNECTION_WAIT_MS);
        return sock.sendMessage(chatJid, { text }, quoted ? { quoted } : undefined);
    }, NETWORK_STEP.send);
    if (sent && sent.key) connection.rememberSent(sent.key.id, sent.message);
    return sent;
}

module.exports = { CONNECTION_WAIT_MS, sendSoundSticker, sendText, embeddedAudioSize, ownJidFor };
