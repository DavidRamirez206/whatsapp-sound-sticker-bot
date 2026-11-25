#!/usr/bin/env node
'use strict';

/**
 * Entry point of the WhatsApp sound sticker bot.
 * See README.md for setup and configuration.
 */

const { main } = require('./src/main');

/**
 * When the standalone executable is started with a double click, its console
 * window closes as soon as the process exits. Waiting for Enter keeps fatal
 * errors readable.
 */
function waitForEnterIfStandalone() {
    let standalone = false;
    try { standalone = require('node:sea').isSea(); } catch { /* not available on this Node version */ }
    if (!standalone || !process.stdin.isTTY) return Promise.resolve();
    process.stdout.write('\nPress Enter to close...');
    return new Promise((resolve) => process.stdin.once('data', resolve));
}

main().catch(async (error) => {
    console.error(`\nFatal error: ${error && error.message ? error.message : error}`);
    await waitForEnterIfStandalone();
    process.exit(1);
});
