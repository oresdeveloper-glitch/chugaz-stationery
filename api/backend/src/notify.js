const { db } = require('./db');

// Fan a notification out to every active manager and admin. Called inside
// sale/order transactions: it must NEVER throw (a failed notification can
// never block or roll back a sale), hence the internal try/catch.
function notifyManagers({ kind = 'sale', title, body }) {
  try {
    if (!title) return 0;
    const recipients = db.prepare(`
      SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.name IN ('manager','admin') AND u.status = 'active'
    `).all();
    if (!recipients.length) return 0;
    const ins = db.prepare('INSERT INTO notifications (user_id, kind, title, body) VALUES (?,?,?,?)');
    const cleanTitle = String(title).slice(0, 160);
    const cleanBody = body ? String(body).slice(0, 300) : null;
    for (const r of recipients) ins.run(r.id, kind, cleanTitle, cleanBody);
    return recipients.length;
  } catch (e) {
    return 0;
  }
}

module.exports = { notifyManagers };
