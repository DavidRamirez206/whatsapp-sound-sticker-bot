'use strict';

/**
 * Sound stickers.
 *
 * A WhatsApp sticker with sound is a regular `StickerMessage` that carries a
 * complete `AudioMessage` in protobuf field 26. Baileys' generated schema has no
 * such field, so this module wraps `StickerMessage.encode` and appends the
 * pre-encoded audio bytes right after the known fields.
 *
 * The audio to attach is looked up by the sticker's `fileSha256`, so only the
 * sticker that was explicitly registered gets the extra field; every other
 * sticker the library encodes is left untouched.
 *
 * Registrations are kept for an hour instead of being dropped right after the
 * first send: when a recipient's phone fails to decrypt a message, WhatsApp asks
 * the sender to encrypt it again, and that second encoding must carry the audio
 * too, or the resent sticker arrives muted.
 */

const { log } = require('./logger');
const { createTtlCache } = require('./ttl-cache');

/** Field number of the embedded audio inside `StickerMessage`. */
const STICKER_AUDIO_FIELD = 26;

/** Protobuf tag for field 26 with wire type 2 (length-delimited): (26 << 3) | 2 = 210. */
const STICKER_AUDIO_TAG = (STICKER_AUDIO_FIELD << 3) | 2;

const PATCHED = Symbol.for('sound-sticker-bot.encode-patched');

/** How long an audio stays attached to its sticker (covers WhatsApp's resend requests). */
const AUDIO_TTL_MS = 60 * 60 * 1000;

/** fileSha256 (base64) -> encoded AudioMessage */
const pendingAudio = createTtlCache({ maxEntries: 200, ttlMs: AUDIO_TTL_MS });

/** @param {Uint8Array} fileSha256 */
const keyOf = (fileSha256) => Buffer.from(fileSha256).toString('base64');

/**
 * Registers the audio that must travel inside the sticker identified by `fileSha256`.
 *
 * @param {Uint8Array} fileSha256 Hash of the uploaded sticker file.
 * @param {Uint8Array} audioMessageBytes Encoded `AudioMessage`.
 */
function attachAudio(fileSha256, audioMessageBytes) {
    pendingAudio.set(keyOf(fileSha256), audioMessageBytes);
}

/** @param {Uint8Array} fileSha256 */
function detachAudio(fileSha256) {
    pendingAudio.del(keyOf(fileSha256));
}

/**
 * Wraps `proto.Message.StickerMessage.encode`. Safe to call more than once.
 *
 * @param {any} proto The `proto` namespace exported by Baileys.
 */
function installStickerAudioPatch(proto) {
    const StickerMessage = proto.Message.StickerMessage;
    if (StickerMessage.encode[PATCHED]) return;

    const originalEncode = StickerMessage.encode;
    const patchedEncode = function (message, writer) {
        const result = originalEncode.call(this, message, writer);
        try {
            if (message && message.fileSha256) {
                const audio = pendingAudio.get(keyOf(message.fileSha256));
                if (audio) result.uint32(STICKER_AUDIO_TAG).bytes(audio);
            }
        } catch (error) {
            log('ERR', `could not embed the audio in the sticker: ${error.message}`);
        }
        return result;
    };
    patchedEncode[PATCHED] = true;
    StickerMessage.encode = patchedEncode;
}

module.exports = { AUDIO_TTL_MS, STICKER_AUDIO_FIELD, STICKER_AUDIO_TAG, attachAudio, detachAudio, installStickerAudioPatch };
