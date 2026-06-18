import pool from './pool.js';

/**
 * Seeds demo messaging threads for the Messaging inbox so it isn't empty before
 * real conversations arrive. Threads are distributed (round-robin) across the
 * existing active platform_accounts. Idempotent: skips if conversations already
 * exist; pass --reset to wipe and reseed.
 *
 *   node src/db/seed-messaging.js [--reset]
 */

const reset = process.argv.includes('--reset');

// Real sample photo (a topical image from loremflickr) so the inbox shows actual
// pictures, not placeholders. `lock` keeps each photo stable across reseeds.
const img = (keyword, lock) => `https://loremflickr.com/640/480/${keyword}?lock=${lock}`;

// Messages: media and text are separate bubbles (Messenger-style), oldest first.
const TEMPLATES = [
  {
    customer_name: 'Maria Santos', customer_handle: '@marias.home', origin: 'Messenger',
    handled_by: 'AI Agent', status: 'Needs quote', unread: 3, age_min: 2,
    tags: ['Pricing', 'Same-day'],
    summary: 'I am in Pasig. It is a 3-seater sofa and one accent chair.',
    messages: [
      { side: 'incoming', sender: 'Maria Santos', body: 'Hi, do you offer same-day sofa deep cleaning?' },
      { side: 'outgoing', sender: 'AI Agent', body: 'Yes. I can help with availability and a quick estimate. Which area are you located in?' },
      { side: 'incoming', sender: 'Maria Santos', media: [{ type: 'image', name: 'sofa.jpg', url: img('sofa', 11) }, { type: 'image', name: 'accent-chair.jpg', url: img('armchair', 12) }] },
      { side: 'incoming', sender: 'Maria Santos', body: 'I am in Pasig. It is a 3-seater sofa and one accent chair.' },
    ],
  },
  {
    customer_name: 'Daniel Cruz', customer_handle: '@danielcrz', origin: 'Instagram',
    handled_by: 'Live Agent', status: 'Reschedule', unread: 1, age_min: 8,
    tags: ['Booking', 'Follow-up'],
    summary: 'Any slot after lunch works for me.',
    messages: [
      { side: 'incoming', sender: 'Daniel Cruz', media: [{ type: 'image', name: 'schedule.jpg', url: img('calendar', 13) }] },
      { side: 'incoming', sender: 'Daniel Cruz', body: 'Can we move the cleaning from 9 AM to around 1 PM tomorrow?' },
      { side: 'outgoing', sender: 'Jenny - Live Agent', body: 'I can check the team schedule. Is 1 PM your preferred time or is any afternoon slot okay?' },
      { side: 'incoming', sender: 'Daniel Cruz', body: 'Any slot after lunch works for me.' },
    ],
  },
  {
    customer_name: 'Alyssa Tan', customer_handle: '@alyssatan', origin: 'Messenger',
    handled_by: 'AI Agent', status: 'Qualifying', unread: 0, age_min: 14,
    tags: ['Service area', 'Inquiry'],
    summary: 'I am in Greenfield. Maybe this Friday afternoon.',
    messages: [
      { side: 'incoming', sender: 'Alyssa Tan', body: 'Do you clean king-size mattresses for condo units?' },
      { side: 'outgoing', sender: 'AI Agent', body: 'Yes, we do. May I know your building and preferred date so I can narrow the availability?' },
      { side: 'incoming', sender: 'Alyssa Tan', body: 'I am in Greenfield. Maybe this Friday afternoon.' },
    ],
  },
  {
    customer_name: 'Jerome Lee', customer_handle: '@jeromelee', origin: 'WhatsApp',
    handled_by: 'Live Agent', status: 'Needs deposit', unread: 2, age_min: 21,
    tags: ['Move-out', 'Large job'],
    summary: 'Around 78 sqm. Saturday is best if you still have a slot.',
    messages: [
      { side: 'incoming', sender: 'Jerome Lee', body: 'Can you handle a move-out clean for a 2-bedroom condo this weekend?' },
      { side: 'outgoing', sender: 'Trish - Live Agent', body: 'Yes. For weekend move-out cleaning, we just need the floor area and preferred date.' },
      { side: 'incoming', sender: 'Jerome Lee', body: 'Around 78 sqm. Saturday is best if you still have a slot.' },
    ],
  },
  {
    customer_name: 'Carla Reyes', customer_handle: '@carla.r', origin: 'Instagram',
    handled_by: 'AI Agent', status: 'Awaiting address', unread: 1, age_min: 35,
    tags: ['Quote', 'Lead warm'],
    summary: 'That works for me. I will send the full address in a bit.',
    messages: [
      { side: 'outgoing', sender: 'AI Agent', body: 'Your estimated range is between 2,200 and 2,600 depending on final room count.' },
      { side: 'incoming', sender: 'Carla Reyes', body: 'That works for me. I will send the full address in a bit.' },
    ],
  },
  {
    customer_name: 'Bea Navarro', customer_handle: '@beanav', origin: 'Messenger',
    handled_by: 'Live Agent', status: 'Product concern', unread: 0, age_min: 47,
    tags: ['Allergy-safe', 'FAQ'],
    summary: 'Great, please note fragrance-free if possible.',
    messages: [
      { side: 'incoming', sender: 'Bea Navarro', body: 'Are your products safe for babies and pets?' },
      { side: 'outgoing', sender: 'Paolo - Live Agent', body: 'Yes. We use fabric-safe solutions and can note a fragrance-free preference for your booking.' },
      { side: 'incoming', sender: 'Bea Navarro', body: 'Great, please note fragrance-free if possible.' },
    ],
  },
];

async function main() {
  const accounts = await pool
    .query('SELECT id, account_name FROM platform_accounts WHERE is_active = TRUE ORDER BY id ASC')
    .then(([rows]) => rows);

  if (!accounts.length) {
    console.log('[seed-messaging] no active platform_accounts found — connect a page first, then re-run.');
    await pool.end();
    return;
  }

  // Live Agent threads are bound to a specific user (strict ownership). Seed them
  // with real owners — otherwise the access filter (handled_by <> 'Live Agent' OR
  // assigned_user_id = me) hides them from everyone and "For You" stays empty.
  const users = await pool
    .query('SELECT id, name, email, role, module_access FROM users WHERE is_active = 1 AND deleted_at IS NULL ORDER BY id ASC')
    .then(([rows]) => rows);
  const canMessage = (u) => {
    if (String(u.role || '').toLowerCase() === 'admin') return true;
    let mods = u.module_access;
    if (typeof mods === 'string') {
      try {
        mods = JSON.parse(mods);
      } catch {
        mods = mods.split(',');
      }
    }
    return Array.isArray(mods) && mods.map((m) => String(m).trim()).includes('messages');
  };
  const agents = users.filter(canMessage);
  const owner = agents[0] || users[0] || null; // primary Live Agent owner (the viewer)
  const other = agents[1] || null; // a second teammate, when one exists
  if (!owner) {
    console.log('[seed-messaging] no active users found — create a user first so Live Agent threads have an owner.');
  }

  const [[{ existing }]] = await pool.query('SELECT COUNT(*) AS existing FROM conversations');
  if (existing > 0) {
    if (!reset) {
      console.log(`[seed-messaging] ${existing} conversation(s) already present — skipping. Use --reset to wipe and reseed.`);
      await pool.end();
      return;
    }
    console.log('[seed-messaging] --reset: clearing existing conversations…');
    // conversation_transfers has no FK in the migration, so clear it explicitly
    // (ignored if the table predates the transfer feature).
    try {
      await pool.query('DELETE FROM conversation_transfers');
    } catch {
      /* table may not exist yet — that's fine */
    }
    await pool.query('DELETE FROM conversations'); // cascades to messages
  }

  let count = 0;
  let liveSeen = 0;
  const liveByUser = new Map(); // userId -> [conversationId], used for the demo transfer
  for (let i = 0; i < TEMPLATES.length; i += 1) {
    const t = TEMPLATES[i];
    const account = accounts[i % accounts.length];
    // Bind Live Agent threads to a real owner; alternate between two agents when
    // available so both inboxes have content.
    let assignee = null;
    if (t.handled_by === 'Live Agent' && owner) {
      assignee = other && liveSeen % 2 === 1 ? other : owner;
      liveSeen += 1;
    }
    const [res] = await pool.query(
      `INSERT INTO conversations
         (account_id, page_name, customer_name, customer_handle, origin, handled_by, status, tags, summary, unread, assigned_user_id, assigned_user_name, last_message_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW() - INTERVAL ? MINUTE)`,
      [account.id, account.account_name, t.customer_name, t.customer_handle, t.origin, t.handled_by, t.status, JSON.stringify(t.tags), t.summary, t.unread, assignee?.id ?? null, assignee ? assignee.name || assignee.email : null, t.age_min],
    );
    const conversationId = res.insertId;
    if (assignee) {
      const list = liveByUser.get(assignee.id) || [];
      list.push(conversationId);
      liveByUser.set(assignee.id, list);
    }

    const n = t.messages.length;
    for (let j = 0; j < n; j += 1) {
      const m = t.messages[j];
      // Oldest first: the last message lands at age_min; earlier ones before it.
      const offset = t.age_min + (n - 1 - j);
      await pool.query(
        `INSERT INTO messages (conversation_id, side, sender, body, media, created_at)
         VALUES (?, ?, ?, ?, ?, NOW() - INTERVAL ? MINUTE)`,
        [conversationId, m.side, m.sender || null, m.body || null, m.media ? JSON.stringify(m.media) : null, offset],
      );
    }
    count += 1;
  }

  // Demo one pending transfer addressed to the primary owner so the "Incoming
  // requests" bar has something to show (only when a second teammate exists).
  if (owner && other) {
    const fromConvs = liveByUser.get(other.id) || [];
    if (fromConvs.length) {
      try {
        await pool.query(
          `INSERT INTO conversation_transfers
             (conversation_id, from_user_id, from_user_name, to_user_id, to_user_name, status)
           VALUES (?, ?, ?, ?, ?, 'pending')`,
          [fromConvs[0], other.id, other.name || other.email, owner.id, owner.name || owner.email],
        );
        console.log(`[seed-messaging] seeded 1 pending transfer for ${owner.name || owner.email}.`);
      } catch (e) {
        console.log(`[seed-messaging] skipped demo transfer (${e.message}); run the conversation-assignment migration first.`);
      }
    }
  }

  const liveOwners = [...liveByUser.keys()].length;
  console.log(
    `[seed-messaging] seeded ${count} conversation(s) across ${accounts.length} page(s); ` +
      `${liveSeen} Live Agent thread(s) bound across ${liveOwners} user(s).`,
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error('[seed-messaging] failed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
