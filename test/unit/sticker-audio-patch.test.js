'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { proto } = require('@whiskeysockets/baileys');
const { parseRawFields, findBytesField } = require('../../src/protobuf');
const { embeddedAudioSize } = require('../../src/whatsapp/send');
const { readStickerAudio } = require('../../src/whatsapp/inspect');
const {
    STICKER_AUDIO_FIELD, STICKER_AUDIO_TAG, attachAudio, detachAudio, installStickerAudioPatch
} = require('../../src/sticker-audio-patch');

installStickerAudioPatch(proto);

const sha = Buffer.alloc(32, 7);
const audioBytes = () => proto.Message.AudioMessage.encode(
    proto.Message.AudioMessage.create({ seconds: 9, fileLength: 1234, ptt: true, mimetype: 'audio/ogg; codecs=opus' })).finish();
const encodeSticker = (fileSha256) => Buffer.from(proto.Message.StickerMessage.encode(
    proto.Message.StickerMessage.create({ fileSha256, isAnimated: true, width: 512, height: 512 })).finish());

test('the audio field tag is field 26 with wire type 2', () => {
    assert.equal(STICKER_AUDIO_FIELD, 26);
    assert.equal(STICKER_AUDIO_TAG, 210);
});

test('a registered sticker is encoded with the audio in field 26', () => {
    const audio = audioBytes();
    attachAudio(sha, audio);
    try {
        const field = findBytesField(parseRawFields(encodeSticker(sha)), STICKER_AUDIO_FIELD);
        assert.ok(field, 'field 26 must be present');
        assert.deepEqual(Buffer.from(field.payload), Buffer.from(audio));
    } finally {
        detachAudio(sha);
    }
});

test('other stickers are left untouched', () => {
    attachAudio(sha, audioBytes());
    try {
        const other = encodeSticker(Buffer.alloc(32, 1));
        assert.equal(findBytesField(parseRawFields(other), STICKER_AUDIO_FIELD), undefined);
    } finally {
        detachAudio(sha);
    }
    assert.equal(findBytesField(parseRawFields(encodeSticker(sha)), STICKER_AUDIO_FIELD), undefined,
        'after detaching, the sticker is encoded without audio');
});

test('the audio is still embedded when WhatsApp asks to resend the sticker', () => {
    const audio = audioBytes();
    attachAudio(sha, audio);
    try {
        encodeSticker(sha);
        const resent = findBytesField(parseRawFields(encodeSticker(sha)), STICKER_AUDIO_FIELD);
        assert.ok(resent, 'a second encoding (resend) must carry the audio too');
    } finally {
        detachAudio(sha);
    }
});

test('installing the patch twice does not embed the audio twice', () => {
    installStickerAudioPatch(proto);
    attachAudio(sha, audioBytes());
    try {
        const fields = parseRawFields(encodeSticker(sha)).filter((f) => f.field === STICKER_AUDIO_FIELD);
        assert.equal(fields.length, 1);
    } finally {
        detachAudio(sha);
    }
});

test('a full Message can be checked and read back like an incoming sound sticker', () => {
    const audio = audioBytes();
    attachAudio(sha, audio);
    try {
        const message = proto.Message.create({ stickerMessage: { fileSha256: sha, isAnimated: true } });
        const encoded = Buffer.from(proto.Message.encode(message).finish());
        assert.equal(embeddedAudioSize(encoded), audio.length);

        const rawSticker = findBytesField(parseRawFields(encoded), 26).payload;
        const incoming = readStickerAudio(rawSticker);
        assert.equal(incoming.key, sha.toString('base64'));
        assert.deepEqual(incoming.audio, { seconds: 9, bytes: 1234, ptt: 1 });
    } finally {
        detachAudio(sha);
    }
    const plain = Buffer.from(proto.Message.encode(proto.Message.create({ stickerMessage: { fileSha256: sha } })).finish());
    assert.equal(embeddedAudioSize(plain), null);
});
