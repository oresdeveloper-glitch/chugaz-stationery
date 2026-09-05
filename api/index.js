const { NodeRuntime } = require('@vercel/node');
const backendApp = require('./backend/server');
module.exports = new NodeRuntime(backendApp);
