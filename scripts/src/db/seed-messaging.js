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

// Self-contained gradient "photo" (SVG data URI) — renders without S3 / network.
const img = (label, c1, c2) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'>` +
      `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
      `<stop offset='0' stop-color='${c1}'/><stop offset='1' stop-color='${c2}'/></linearGradient></defs>` +
      `<rect width='400' height='300' fill='url(#g)'/>` +
      `<text x='50%' y='53%' fill='rgba(255,255,255,0.92)' font-family='sans-serif' font-size='24' font-weight='700' text-anchor='middle'>${label}</text>` +
      `</svg>`,
  )}`;

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
      { side: 'incoming', sender: 'Maria Santos', media: [{ type: 'image', name: 'sofa.jpg', url: img('sofa.jpg', '#8e7bef', '#5b46c9') }, { type: 'image', name: 'accent-chair.jpg', url: img('accent-chair.jpg', '#ff8f6b', '#e0574a') }] },
      { side: 'incoming', sender: 'Maria Santos', body: 'I am in Pasig. It is a 3-seater sofa and one accent chair.' },
    ],
  },
  {
    customer_name: 'Daniel Cruz', customer_handle: '@danielcrz', origin: 'Instagram',
    handled_by: 'Live Agent', status: 'Reschedule', unread: 1, age_min: 8,
    tags: ['Booking', 'Follow-up'],
    summary: 'Any slot after lunch works for me.',
    messages: [
      { side: 'incoming', sender: 'Daniel Cruz', media: [{ type: 'image', name: 'schedule.jpg', url: img('schedule.jpg', '#2dc878', '#1f8a55') }] },
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

  const [[{ existing }]] = await pool.query('SELECT COUNT(*) AS existing FROM conversations');
  if (existing > 0) {
    if (!reset) {
      console.log(`[seed-messaging] ${existing} conversation(s) already present — skipping. Use --reset to wipe and reseed.`);
      await pool.end();
      return;
    }
    console.log('[seed-messaging] --reset: clearing existing conversations…');
    await pool.query('DELETE FROM conversations'); // cascades to messages
  }

  let count = 0;
  for (let i = 0; i < TEMPLATES.length; i += 1) {
    const t = TEMPLATES[i];
    const account = accounts[i % accounts.length];
    const [res] = await pool.query(
      `INSERT INTO conversations
         (account_id, page_name, customer_name, customer_handle, origin, handled_by, status, tags, summary, unread, last_message_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW() - INTERVAL ? MINUTE)`,
      [account.id, account.account_name, t.customer_name, t.customer_handle, t.origin, t.handled_by, t.status, JSON.stringify(t.tags), t.summary, t.unread, t.age_min],
    );
    const conversationId = res.insertId;

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

  console.log(`[seed-messaging] seeded ${count} conversation(s) across ${accounts.length} page(s).`);
  await pool.end();
}

main().catch(async (err) => {
  console.error('[seed-messaging] failed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
