import { DatabaseSync } from 'node:sqlite';

export function openDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, role TEXT, token TEXT UNIQUE);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, item TEXT, amount_cents INTEGER,
      address TEXT, note TEXT, status TEXT DEFAULT 'paid');
    CREATE TABLE usage (user_id INTEGER, day TEXT, calls INTEGER, PRIMARY KEY (user_id, day));
    CREATE TABLE refund_requests (id INTEGER PRIMARY KEY, order_id INTEGER, requested_by INTEGER, status TEXT DEFAULT 'pending');
  `);
  db.exec(`
    INSERT INTO users VALUES (1, 'Alice', 'customer', 'tok-alice'), (2, 'Bob', 'customer', 'tok-bob'),
      (3, 'Sam', 'support', 'tok-sam');
    INSERT INTO orders (id, user_id, item, amount_cents, address, note) VALUES
      (1001, 1, 'Espresso machine', 34900, '4 rue Garibaldi, Lyon', ''),
      (1002, 2, 'Grinder', 12900, '9 place Bellecour, Lyon', '');
  `);
  return db;
}
