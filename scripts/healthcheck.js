'use strict';

/**
 * Health probe used by the Docker image (`HEALTHCHECK`). Reads the file the bot
 * keeps refreshing (`HEALTH_FILE`) and exits with 0 when healthy, 1 otherwise,
 * printing the reason either way.
 */

const { evaluateHealth, readReport } = require('../src/health');

const file = process.env.HEALTH_FILE;
if (!file) {
    console.log('HEALTH_FILE is not set');
    process.exit(1);
}

const { healthy, reason } = evaluateHealth(readReport(file), Date.now());
console.log(reason);
process.exit(healthy ? 0 : 1);
