'use strict';

/**
 * Bundles the bot and all its dependencies into a single CommonJS file
 * (`dist/bot.cjs`). A Node single executable application can only embed one
 * script, so everything, including the ESM-only Baileys, is inlined here.
 *
 * Baileys' optional peer dependencies (image processing, link previews) are not
 * used by the bot and are left out of the bundle.
 */

const path = require('node:path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');

esbuild.build({
    entryPoints: [path.join(root, 'index.js')],
    outfile: path.join(root, 'dist', 'bot.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['sharp', 'jimp', 'link-preview-js', 'audio-decode'],
    logLevel: 'warning'
}).then(() => console.log('Bundle written to dist/bot.cjs'))
    .catch(() => process.exit(1));
