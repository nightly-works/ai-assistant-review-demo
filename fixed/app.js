import express from 'express';
import { scriptedModel } from './model.js';

// No secrets or business rules in the prompt: anything in it can be read back by a user.
const SYSTEM = `You are the support assistant of Brewline, a coffee equipment shop.
Be friendly. Use the tools to look up orders. You can propose a refund; staff decide.`;

// The model and its limits are chosen here, never by the browser.
const MODEL = 'small';
const MAX_TOKENS = 500;
const DAILY_CALLS = 50;

export function createApp(db, { model = scriptedModel, today = () => new Date().toISOString().slice(0, 10) } = {}) {
  const app = express();
  app.use(express.json({ limit: '50kb' }));

  app.use((req, res, next) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    req.user = db.prepare('SELECT * FROM users WHERE token = ?').get(token);
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    next();
  });

  // Tools run with the signed-in user's rights, not the server's: the model can only reach
  // what the user could reach through the normal screens. Nothing here changes data
  // without a person deciding.
  function toolsFor(user) {
    const visibleOrder = (id) =>
      user.role === 'support'
        ? db.prepare('SELECT id, user_id, item, amount_cents, address, note, status FROM orders WHERE id = ?').get(id)
        : db.prepare('SELECT id, item, amount_cents, address, note, status FROM orders WHERE id = ? AND user_id = ?').get(id, user.id);
    return {
      get_order: ({ order_id }) => visibleOrder(order_id) ?? { error: 'No such order' },
      propose_refund: ({ order_id }) => {
        if (!visibleOrder(order_id)) return { error: 'No such order' };
        const { lastInsertRowid } = db
          .prepare('INSERT INTO refund_requests (order_id, requested_by) VALUES (?, ?)')
          .run(order_id, user.id);
        return { pending_refund_request: Number(lastInsertRowid), note: 'A member of staff will review it.' };
      },
    };
  }

  function overQuota(user) {
    db.prepare(
      'INSERT INTO usage (user_id, day, calls) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET calls = calls + 1'
    ).run(user.id, today());
    return db.prepare('SELECT calls FROM usage WHERE user_id = ? AND day = ?').get(user.id, today()).calls > DAILY_CALLS;
  }

  app.post('/api/orders/:id/note', (req, res) => {
    if (typeof req.body?.note !== 'string' || req.body.note.length > 500) return res.status(400).json({ error: 'Note up to 500 characters' });
    db.prepare('UPDATE orders SET note = ? WHERE id = ? AND user_id = ?').run(req.body.note, req.params.id, req.user.id);
    res.json({ ok: true });
  });

  app.post('/api/chat', (req, res) => {
    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
      return res.status(400).json({ error: 'Between 1 and 20 messages' });
    }
    // Only the user's own turns come from the browser; tool results are produced here.
    if (messages.some((m) => m.role !== 'user' && m.role !== 'assistant' || typeof m.content !== 'string')) {
      return res.status(400).json({ error: 'Messages must be user or assistant text' });
    }
    if (overQuota(req.user)) return res.status(429).json({ error: 'Daily assistant limit reached' });

    const tools = toolsFor(req.user);
    const convo = [...messages];
    const calls = [];
    for (let step = 0; step < 5; step++) {
      const reply = model({ system: SYSTEM, messages: convo, model: MODEL, max_tokens: MAX_TOKENS });
      if (!reply.tool_call) return res.json({ reply: reply.content, tool_calls: calls, model: MODEL, max_tokens: MAX_TOKENS });
      const tool = tools[reply.tool_call.name];
      const result = tool ? tool(reply.tool_call.arguments ?? {}) : { error: 'Unknown tool' };
      calls.push(reply.tool_call.name);
      convo.push({ role: 'tool', name: reply.tool_call.name, content: result });
    }
    res.json({ reply: 'Sorry, I could not finish.', tool_calls: calls });
  });

  // Refunds are decided by staff, in a normal screen, with a role check.
  app.post('/api/refund-requests/:id/approve', (req, res) => {
    if (req.user.role !== 'support') return res.status(403).json({ error: 'Staff only' });
    const request = db.prepare("SELECT * FROM refund_requests WHERE id = ? AND status = 'pending'").get(req.params.id);
    if (!request) return res.status(404).json({ error: 'No pending request' });
    db.prepare("UPDATE refund_requests SET status = 'approved' WHERE id = ?").run(request.id);
    db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ?").run(request.order_id);
    res.json({ refunded: request.order_id });
  });

  return app;
}
