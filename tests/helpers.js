import * as flawedDb from '../flawed/db.js';
import * as fixedDb from '../fixed/db.js';
import { createApp as createFlawed } from '../flawed/app.js';
import { createApp as createFixed } from '../fixed/app.js';

// Starts one version of the app on a free port with fresh data and the scripted model.
export async function start(version, options = {}) {
  const db = (version === 'flawed' ? flawedDb : fixedDb).openDb();
  const app = (version === 'flawed' ? createFlawed : createFixed)(db, options);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(token, method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  const chat = (token, text, extra = {}) => call(token, 'POST', '/api/chat', { messages: [{ role: 'user', content: text }], ...extra });

  return { db, call, chat, close: () => new Promise((r) => server.close(r)) };
}

export const ALICE = 'tok-alice';
export const BOB = 'tok-bob';
export const SAM = 'tok-sam';
