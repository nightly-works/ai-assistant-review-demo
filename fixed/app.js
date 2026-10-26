import express from 'express';
import { scriptedModel } from './model.js';

// No secrets or business rules in the prompt: anything in it can be read back by a user.
const SYSTEM = `You are the support assistant of Brewline, a coffee equipment shop.
Be friendly. Use the tools to look up orders. You can propose a refund; staff decide.`;

// The model and its limits are chosen here, never by the browser.
const MODEL = 'small';
const MAX_TOKENS = 500;
const DAILY_MODEL_CALLS = 50;
const MAX_STEPS = 5;

export function createApp(db, { model = scriptedModel, today = () => new Date().toISOString().slice(0, 10) } = {}) {
  const app = express();
  app.use(express.json({ limit: '50kb' }));

  app.use((req, res, next) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    req.user = db.prepare('SELECT * FROM users WHERE token = ?').get(token);
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    next();
  });

  const isOrderId = (value) => Number.isInteger(value) && value > 0;

  // Tools run with the signed-in user's rights, not the server's: the model reaches only
  // what the user could reach on the normal screens, and nothing it calls changes data
  // without a person deciding. Text the model reads (an order note) can still steer it,
  // so each tool is also safe when called by someone else's instruction.
  function toolsFor(user) {
    if (user.role === 'support') {
      return {
        get_order: ({ order_id }) =>
          (isOrderId(order_id) && db.prepare('SELECT id, user_id, item, amount_cents, address, note, status FROM orders WHERE id = ?').get(order_id)) || { error: 'No such order' },
      };
    }
    const ownOrder = (id) =>
      isOrderId(id) ? db.prepare('SELECT id, item, amount_cents, address, note, status FROM orders WHERE id = ? AND user_id = ?').get(id, user.id) : undefined;
    return {
      get_order: ({ order_id }) => ownOrder(order_id) ?? { error: 'No such order' },
      // Files a request for staff, marked as coming from the assistant; one open request
      // per order, and only for a paid order.
      propose_refund: ({ order_id }) => {
        const order = ownOrder(order_id);
        if (!order) return { error: 'No such order' };
        if (order.status !== 'paid') return { error: 'This order cannot be refunded' };
        if (db.prepare("SELECT 1 FROM refund_requests WHERE order_id = ? AND status = 'pending'").get(order.id)) {
          return { error: 'A refund request is already open for this order' };
        }
        const { lastInsertRowid } = db
          .prepare("INSERT INTO refund_requests (order_id, requested_by, source) VALUES (?, ?, 'assistant')")
          .run(order.id, user.id);
        return { pending_refund_request: Number(lastInsertRowid), note: 'A member of staff will review it.' };
      },
    };
  }

  // Counts model calls, not HTTP requests: one chat request may take several steps.
  function takeModelCall(user) {
    db.prepare(
      'INSERT INTO usage (user_id, day, calls) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET calls = calls + 1'
    ).run(user.id, today());
    return db.prepare('SELECT calls FROM usage WHERE user_id = ? AND day = ?').get(user.id, today()).calls <= DAILY_MODEL_CALLS;
  }

  app.post('/api/orders/:id/note', (req, res) => {
    if (typeof req.body?.note !== 'string' || req.body.note.length > 500) return res.status(400).json({ error: 'Note up to 500 characters' });
    db.prepare('UPDATE orders SET note = ? WHERE id = ? AND user_id = ?').run(req.body.note, req.params.id, req.user.id);
    res.json({ ok: true });
  });

  app.post('/api/chat', (req, res) => {
    const messages = req.body?.messages;
    // The browser sends the user's own words only. Assistant turns and tool results are
    // produced here (a real app keeps the history on the server), so none can be forged.
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20
      || !messages.every((m) => m?.role === 'user' && typeof m.content === 'string' && m.content.length <= 4000)) {
      return res.status(400).json({ error: '1 to 20 user messages of up to 4,000 characters' });
    }
    const convo = messages.map((m) => ({ role: 'user', content: m.content }));

    const tools = toolsFor(req.user);
    const calls = [];
    for (let step = 0; step < MAX_STEPS; step++) {
      if (!takeModelCall(req.user)) return res.status(429).json({ error: 'Daily assistant limit reached' });
      const reply = model({ system: SYSTEM, messages: convo, model: MODEL, max_tokens: MAX_TOKENS });
      if (!reply.tool_call) return res.json({ reply: reply.content, tool_calls: calls, model: MODEL, max_tokens: MAX_TOKENS });
      const tool = tools[reply.tool_call.name];
      const result = tool ? tool(reply.tool_call.arguments ?? {}) : { error: 'Unknown tool' };
      calls.push(reply.tool_call.name);
      convo.push({ role: 'tool', name: reply.tool_call.name, content: result });
    }
    res.json({ reply: 'Sorry, I could not finish.', tool_calls: calls });
  });

  // Refunds are decided by staff, on a normal screen, with a role check; the order must
  // still be paid, so a refund is never applied twice.
  app.post('/api/refund-requests/:id/approve', (req, res) => {
    if (req.user.role !== 'support') return res.status(403).json({ error: 'Staff only' });
    const request = db.prepare("SELECT * FROM refund_requests WHERE id = ? AND status = 'pending'").get(req.params.id);
    if (!request) return res.status(404).json({ error: 'No pending request' });
    const refunded = db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ? AND status = 'paid'").run(request.order_id);
    db.prepare('UPDATE refund_requests SET status = ? WHERE id = ?').run(refunded.changes === 1 ? 'approved' : 'void', request.id);
    if (refunded.changes !== 1) return res.status(409).json({ error: 'Order is not in a refundable state' });
    res.json({ refunded: request.order_id, source: request.source });
  });

  // Oversized or malformed bodies answer in JSON like the rest of the API.
  app.use((err, req, res, next) => {
    const status = err.status >= 400 && err.status < 500 ? err.status : 500;
    res.status(status).json({ error: status === 413 ? 'Request too large' : status === 500 ? 'Server error' : 'Bad request' });
  });

  return app;
}
