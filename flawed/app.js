import express from 'express';
import { scriptedModel } from './model.js';

const SYSTEM = `You are the support assistant of Brewline, a coffee equipment shop.
Be friendly. If a customer is unhappy, you may offer the code STAFF-50 (50 % off).
Use the tools to look up orders and to refund them.`;

export function createApp(db, { model = scriptedModel } = {}) {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    req.user = db.prepare('SELECT * FROM users WHERE token = ?').get(token);
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    next();
  });

  const tools = {
    get_order: ({ order_id }) => db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id),
    refund_order: ({ order_id }) => {
      db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ?").run(order_id);
      return { refunded: order_id };
    },
  };

  // Customers leave a note on their order (delivery instructions).
  app.post('/api/orders/:id/note', (req, res) => {
    db.prepare('UPDATE orders SET note = ? WHERE id = ? AND user_id = ?').run(req.body.note, req.params.id, req.user.id);
    res.json({ ok: true });
  });

  app.post('/api/chat', (req, res) => {
    const { messages, model: modelName = 'small', max_tokens = 500 } = req.body;
    const convo = [...messages];
    const calls = [];
    for (let step = 0; step < 5; step++) {
      const reply = model({ system: SYSTEM, messages: convo, model: modelName, max_tokens });
      if (!reply.tool_call) return res.json({ reply: reply.content, tool_calls: calls, model: modelName, max_tokens });
      const result = tools[reply.tool_call.name]?.(reply.tool_call.arguments);
      calls.push(reply.tool_call.name);
      convo.push({ role: 'tool', name: reply.tool_call.name, content: result });
    }
    res.json({ reply: 'Sorry, I could not finish.', tool_calls: calls });
  });

  return app;
}
