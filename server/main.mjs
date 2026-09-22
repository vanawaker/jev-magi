import { fileURLToPath } from 'node:url';
import { createMagiServer } from './server.mjs';

// Variables already set in the shell take precedence over .env.
try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT must be a number between 1 and 65535');
const key = (process.env.TYPESAFE_API_KEY || '').trim();
const allowedHosts = (process.env.ALLOWED_HOSTS || '').split(',');
const server = createMagiServer({ key, allowedHosts, publicDir: fileURLToPath(new URL('../dist', import.meta.url)) });
server.listen(port, host, () => {
  const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host.includes(':') ? `[${host}]` : host;
  console.log(`MAGI is running at http://${shown}:${port}`);
  console.log(key ? 'Using TYPESAFE_API_KEY from the environment.' : 'TYPESAFE_API_KEY is not set; enter a key on the page.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); setTimeout(() => process.exit(0), 3000).unref(); });
