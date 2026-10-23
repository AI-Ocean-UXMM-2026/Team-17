const assert = require('node:assert/strict');
const express = require('../../server/node_modules/express');
express.application.listen = () => { throw new Error('Express app import must not start a listener'); };
const entry = require('../../server/dist/app');
assert.equal(typeof entry.default, 'function');
assert.equal(entry.default, entry.app);
assert.equal(require('../../server/dist/app').default, entry.default);
require('../../server/dist/config/prisma').prisma.$disconnect()
  .then(() => console.log('Express default export verified; import starts no listener.'))
  .catch(() => { console.error('Prisma disconnect failed'); process.exitCode = 1; });