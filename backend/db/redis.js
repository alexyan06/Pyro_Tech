const Redis = require('ioredis');

let client = null;
let connected = false;

function getClient() {
  if (!client) {
    client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // Don't retry, fail fast
      lazyConnect: true,
    });
    client.on('error', (err) => {
      if (connected) {
        console.warn('[Redis] Connection lost:', err.message);
        connected = false;
      }
    });
    client.on('connect', () => {
      connected = true;
      console.log('[Redis] Connected');
    });
  }
  return client;
}

async function initRedis() {
  try {
    const c = getClient();
    await c.connect();
    connected = true;
  } catch (err) {
    console.warn('[Redis] Not available, running without cache:', err.message);
  }
}

async function setState(simId, state) {
  if (!connected) return;
  try {
    await getClient().set(`ember:sim:${simId}:state`, JSON.stringify(state));
  } catch (err) {
    console.warn('[Redis] setState failed:', err.message);
  }
}

async function getState(simId) {
  if (!connected) return null;
  try {
    const data = await getClient().get(`ember:sim:${simId}:state`);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.warn('[Redis] getState failed:', err.message);
    return null;
  }
}

module.exports = { initRedis, setState, getState, getClient };
