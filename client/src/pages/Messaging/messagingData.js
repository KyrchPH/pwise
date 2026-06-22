const FALLBACK_PAGES = [
  { id: 'demo-page-1', account_name: 'Wise Cleaner Shop', fb_page_id: '' },
  { id: 'demo-page-2', account_name: 'Wise Cleaner Pasig', fb_page_id: '' },
  { id: 'demo-page-3', account_name: 'Wise Cleaner Makati', fb_page_id: '' },
];

// Self-contained sample photo (gradient SVG data URI) so received media renders
// without a network or real S3 objects.
const sampleImg = (label, c1, c2) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'>` +
      `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
      `<stop offset='0' stop-color='${c1}'/><stop offset='1' stop-color='${c2}'/></linearGradient></defs>` +
      `<rect width='400' height='300' fill='url(#g)'/>` +
      `<text x='50%' y='53%' fill='rgba(255,255,255,0.92)' font-family='sans-serif' font-size='24' font-weight='700' text-anchor='middle'>${label}</text>` +
      `</svg>`,
  )}`;

const portrait = (group, id) => `https://randomuser.me/api/portraits/${group}/${id}.jpg`;

const CONVERSATION_LIBRARY = [
  {
    customerName: 'Maria Santos',
    customerHandle: '@marias.home',
    avatarUrl: portrait('women', 44),
    origin: 'Messenger',
    handledBy: 'AI Agent',
    activeMessages: 4,
    unread: 3,
    lastActivity: '2m ago',
    status: 'Needs quote',
    tags: ['Pricing', 'Same-day'],
    summary: 'Customer is asking about same-day sofa deep cleaning and a price estimate.',
    messages: [
      { side: 'incoming', sender: 'Maria Santos', time: '10:12 AM', text: 'Hi, do you offer same-day sofa deep cleaning?' },
      { side: 'outgoing', sender: 'AI Agent', time: '10:13 AM', text: 'Yes. I can help with availability and a quick estimate. Which area are you located in?' },
      {
        side: 'incoming',
        sender: 'Maria Santos',
        time: '10:14 AM',
        media: [
          { type: 'image', name: 'sofa.jpg', url: sampleImg('sofa.jpg', '#8e7bef', '#5b46c9') },
          { type: 'image', name: 'accent-chair.jpg', url: sampleImg('accent-chair.jpg', '#ff8f6b', '#e0574a') },
        ],
      },
      { side: 'incoming', sender: 'Maria Santos', time: '10:14 AM', text: 'I am in Pasig. It is a 3-seater sofa and one accent chair.' },
    ],
  },
  {
    customerName: 'Daniel Cruz',
    customerHandle: '@danielcrz',
    avatarUrl: portrait('men', 32),
    origin: 'Instagram',
    handledBy: 'Live Agent',
    activeMessages: 2,
    unread: 1,
    lastActivity: '8m ago',
    status: 'Reschedule',
    tags: ['Booking', 'Follow-up'],
    summary: 'Client wants to move tomorrow morning service to a later arrival window.',
    messages: [
      {
        side: 'incoming',
        sender: 'Daniel Cruz',
        time: '9:48 AM',
        media: [{ type: 'image', name: 'schedule.jpg', url: sampleImg('schedule.jpg', '#2dc878', '#1f8a55') }],
      },
      { side: 'incoming', sender: 'Daniel Cruz', time: '9:48 AM', text: 'Can we move the cleaning from 9 AM to around 1 PM tomorrow?' },
      { side: 'outgoing', sender: 'Jenny - Live Agent', time: '9:55 AM', text: 'I can check the team schedule. Is 1 PM your preferred time or is any afternoon slot okay?' },
      { side: 'incoming', sender: 'Daniel Cruz', time: '9:58 AM', text: 'Any slot after lunch works for me.' },
    ],
  },
  {
    customerName: 'Alyssa Tan',
    customerHandle: '@alyssatan',
    avatarUrl: portrait('women', 68),
    origin: 'Messenger',
    handledBy: 'AI Agent',
    activeMessages: 3,
    unread: 0,
    lastActivity: '14m ago',
    status: 'Qualifying',
    tags: ['Service area', 'Inquiry'],
    summary: 'New lead checking if mattress cleaning is available for a condo unit.',
    messages: [
      { side: 'incoming', sender: 'Alyssa Tan', time: '9:16 AM', text: 'Do you clean king-size mattresses for condo units?' },
      { side: 'outgoing', sender: 'AI Agent', time: '9:17 AM', text: 'Yes, we do. May I know your building and preferred date so I can narrow the availability?' },
      { side: 'incoming', sender: 'Alyssa Tan', time: '9:21 AM', text: 'I am in Greenfield. Maybe this Friday afternoon.' },
    ],
  },
  {
    customerName: 'Jerome Lee',
    customerHandle: '@jeromelee',
    avatarUrl: portrait('men', 46),
    origin: 'WhatsApp',
    handledBy: 'Live Agent',
    activeMessages: 5,
    unread: 2,
    lastActivity: '21m ago',
    status: 'Needs deposit',
    tags: ['Move-out', 'Large job'],
    summary: 'A move-out deep clean is nearly booked pending the customer deposit.',
    messages: [
      { side: 'incoming', sender: 'Jerome Lee', time: '8:40 AM', text: 'Can you handle a move-out clean for a 2-bedroom condo this weekend?' },
      { side: 'outgoing', sender: 'Trish - Live Agent', time: '8:43 AM', text: 'Yes. For weekend move-out cleaning, we just need the floor area and preferred date.' },
      { side: 'incoming', sender: 'Jerome Lee', time: '8:46 AM', text: 'Around 78 sqm. Saturday is best if you still have a slot.' },
    ],
  },
  {
    customerName: 'Carla Reyes',
    customerHandle: '@carla.r',
    avatarUrl: portrait('women', 21),
    origin: 'Instagram',
    handledBy: 'AI Agent',
    activeMessages: 2,
    unread: 1,
    lastActivity: '35m ago',
    status: 'Awaiting address',
    tags: ['Quote', 'Lead warm'],
    summary: 'Lead liked the estimate and only needs to confirm the exact address.',
    messages: [
      { side: 'outgoing', sender: 'AI Agent', time: '8:05 AM', text: 'Your estimated range is between 2,200 and 2,600 depending on final room count.' },
      { side: 'incoming', sender: 'Carla Reyes', time: '8:09 AM', text: 'That works for me. I will send the full address in a bit.' },
      { side: 'outgoing', sender: 'AI Agent', time: '8:10 AM', text: 'Perfect. Once you send it over, I can lock the booking request.' },
    ],
  },
  {
    customerName: 'Bea Navarro',
    customerHandle: '@beanav',
    avatarUrl: portrait('women', 52),
    origin: 'Messenger',
    handledBy: 'Live Agent',
    activeMessages: 4,
    unread: 0,
    lastActivity: '47m ago',
    status: 'Product concern',
    tags: ['Allergy-safe', 'FAQ'],
    summary: 'Customer is checking which chemicals are safe for babies and pets.',
    messages: [
      { side: 'incoming', sender: 'Bea Navarro', time: '7:32 AM', text: 'Are your products safe for babies and pets?' },
      { side: 'outgoing', sender: 'Paolo - Live Agent', time: '7:35 AM', text: 'Yes. We use fabric-safe solutions and can note a fragrance-free preference for your booking.' },
      { side: 'incoming', sender: 'Bea Navarro', time: '7:37 AM', text: 'Great, please note fragrance-free if possible.' },
    ],
  },
  {
    customerName: 'Nico Ramos',
    customerHandle: '@nicoramos',
    avatarUrl: portrait('men', 14),
    origin: 'Telegram',
    handledBy: 'AI Agent',
    activeMessages: 3,
    unread: 2,
    lastActivity: '52m ago',
    status: 'Checking slots',
    tags: ['Booking', 'Condo'],
    summary: 'Customer needs a Saturday afternoon slot for carpet cleaning in a condo unit.',
    messages: [
      { side: 'incoming', sender: 'Nico Ramos', time: '7:10 AM', text: 'Do you have any Saturday afternoon slots for carpet cleaning?' },
      { side: 'outgoing', sender: 'AI Agent', time: '7:11 AM', text: 'I can check. What city is the condo in and roughly how many square meters is the carpeted area?' },
      { side: 'incoming', sender: 'Nico Ramos', time: '7:14 AM', text: 'Mandaluyong, around 18 sqm.' },
    ],
  },
  {
    customerName: 'Lara Mendoza',
    customerHandle: '@laram',
    avatarUrl: portrait('women', 12),
    origin: 'Instagram',
    handledBy: 'Live Agent',
    activeMessages: 4,
    unread: 1,
    lastActivity: '1h ago',
    status: 'Needs invoice',
    tags: ['Receipt', 'Corporate'],
    summary: 'Customer is requesting an official receipt and company invoice for a completed service.',
    messages: [
      { side: 'incoming', sender: 'Lara Mendoza', time: '6:41 AM', text: 'Can you send an official receipt under our company name?' },
      { side: 'outgoing', sender: 'Mika - Live Agent', time: '6:45 AM', text: 'Yes. Please send the company name, TIN, and billing address.' },
      { side: 'incoming', sender: 'Lara Mendoza', time: '6:51 AM', text: 'I will send the details here now.' },
    ],
  },
  {
    customerName: 'Rhea Lim',
    customerHandle: '@rhealim',
    avatarUrl: portrait('women', 33),
    origin: 'Messenger',
    handledBy: 'AI Agent',
    activeMessages: 2,
    unread: 0,
    lastActivity: '1h 18m ago',
    status: 'Price check',
    tags: ['Curtains', 'Quote'],
    summary: 'Lead is comparing curtain cleaning prices for a two-bedroom unit.',
    messages: [
      { side: 'incoming', sender: 'Rhea Lim', time: '6:20 AM', text: 'How much for curtain cleaning in a 2-bedroom condo?' },
      { side: 'outgoing', sender: 'AI Agent', time: '6:21 AM', text: 'Pricing depends on the number and size of panels. How many curtain panels do you have?' },
    ],
  },
  {
    customerName: 'Marco Villanueva',
    customerHandle: '@marcov',
    avatarUrl: portrait('men', 73),
    origin: 'WhatsApp',
    handledBy: 'Live Agent',
    activeMessages: 6,
    unread: 3,
    lastActivity: '1h 34m ago',
    status: 'Access issue',
    tags: ['Building pass', 'Operations'],
    summary: 'The cleaning team needs visitor access instructions before arriving at the building.',
    messages: [
      { side: 'outgoing', sender: 'Rafi - Live Agent', time: '5:52 AM', text: 'Our team is scheduled for 11 AM. Does the building require visitor registration?' },
      { side: 'incoming', sender: 'Marco Villanueva', time: '6:02 AM', text: 'Yes, I need to submit their names to security.' },
      { side: 'outgoing', sender: 'Rafi - Live Agent', time: '6:04 AM', text: 'I will send the assigned team names shortly.' },
    ],
  },
  {
    customerName: 'Kim Ocampo',
    customerHandle: '@kim.ocampo',
    avatarUrl: portrait('women', 75),
    origin: 'Messenger',
    handledBy: 'AI Agent',
    activeMessages: 3,
    unread: 1,
    lastActivity: '2h ago',
    status: 'Upsell',
    tags: ['Add-on', 'Sanitizing'],
    summary: 'Customer booked sofa cleaning and is asking if sanitizing can be added.',
    messages: [
      { side: 'incoming', sender: 'Kim Ocampo', time: '5:30 AM', text: 'Can I add sanitizing to my sofa cleaning booking?' },
      { side: 'outgoing', sender: 'AI Agent', time: '5:31 AM', text: 'Yes, sanitizing can be added. I can include it in the booking notes and update the estimate.' },
      { side: 'incoming', sender: 'Kim Ocampo', time: '5:33 AM', text: 'Please add it.' },
    ],
  },
  {
    customerName: 'Oscar Dela Cruz',
    customerHandle: '@oscardc',
    avatarUrl: portrait('men', 57),
    origin: 'Telegram',
    handledBy: 'Live Agent',
    activeMessages: 3,
    unread: 0,
    lastActivity: '2h 16m ago',
    status: 'Follow-up',
    tags: ['Post-service', 'Review'],
    summary: 'Customer is happy with the cleaning and needs the review link resent.',
    messages: [
      { side: 'incoming', sender: 'Oscar Dela Cruz', time: '5:01 AM', text: 'The team did a great job. Can you resend the review link?' },
      { side: 'outgoing', sender: 'Nina - Live Agent', time: '5:04 AM', text: 'Thank you. I will resend the review link here.' },
      { side: 'incoming', sender: 'Oscar Dela Cruz', time: '5:05 AM', text: 'Thanks.' },
    ],
  },
  {
    customerName: 'Hannah Go',
    customerHandle: '@hannahgo',
    avatarUrl: portrait('women', 7),
    origin: 'Instagram',
    handledBy: 'AI Agent',
    activeMessages: 4,
    unread: 2,
    lastActivity: '2h 42m ago',
    status: 'Photo review',
    tags: ['Stain', 'Assessment'],
    summary: 'Lead sent photos of a stained dining chair and wants to know if it can be removed.',
    messages: [
      {
        side: 'incoming',
        sender: 'Hannah Go',
        time: '4:32 AM',
        media: [{ type: 'image', name: 'chair-stain.jpg', url: sampleImg('chair-stain.jpg', '#b56576', '#6d597a') }],
      },
      { side: 'incoming', sender: 'Hannah Go', time: '4:32 AM', text: 'Can this stain still be removed from a fabric dining chair?' },
      { side: 'outgoing', sender: 'AI Agent', time: '4:34 AM', text: 'The team can assess it. How long has the stain been there?' },
    ],
  },
  {
    customerName: 'Patrick Sy',
    customerHandle: '@patricksy',
    avatarUrl: portrait('men', 85),
    origin: 'Messenger',
    handledBy: 'Live Agent',
    activeMessages: 5,
    unread: 2,
    lastActivity: '3h ago',
    status: 'Payment check',
    tags: ['GCash', 'Deposit'],
    summary: 'Customer sent a deposit screenshot and needs payment confirmation.',
    messages: [
      { side: 'incoming', sender: 'Patrick Sy', time: '4:03 AM', text: 'I sent the deposit through GCash. Can you confirm?' },
      { side: 'outgoing', sender: 'Lea - Live Agent', time: '4:07 AM', text: 'I am checking it now. Please send the reference number as well.' },
      { side: 'incoming', sender: 'Patrick Sy', time: '4:09 AM', text: 'Reference number ends in 4921.' },
    ],
  },
  {
    customerName: 'Grace Uy',
    customerHandle: '@graceuy',
    avatarUrl: portrait('women', 90),
    origin: 'WhatsApp',
    handledBy: 'AI Agent',
    activeMessages: 2,
    unread: 0,
    lastActivity: '3h 25m ago',
    status: 'Service scope',
    tags: ['Kitchen', 'Deep clean'],
    summary: 'Customer is clarifying if kitchen degreasing is included in deep cleaning.',
    messages: [
      { side: 'incoming', sender: 'Grace Uy', time: '3:44 AM', text: 'Is kitchen degreasing included in the deep clean package?' },
      { side: 'outgoing', sender: 'AI Agent', time: '3:45 AM', text: 'Yes, basic kitchen degreasing is included. Heavy grease buildup may require an add-on depending on inspection.' },
    ],
  },
  {
    customerName: 'Ivan Mercado',
    customerHandle: '@ivanmercado',
    avatarUrl: portrait('men', 20),
    origin: 'Messenger',
    handledBy: 'Live Agent',
    activeMessages: 4,
    unread: 1,
    lastActivity: '4h ago',
    status: 'Crew ETA',
    tags: ['Arrival', 'Today'],
    summary: 'Customer is asking for the cleaning crew ETA for a same-day appointment.',
    messages: [
      { side: 'incoming', sender: 'Ivan Mercado', time: '3:03 AM', text: 'What time will the crew arrive today?' },
      { side: 'outgoing', sender: 'Sam - Live Agent', time: '3:08 AM', text: 'They are finishing the previous job and should arrive between 10:30 and 11:00 AM.' },
      { side: 'incoming', sender: 'Ivan Mercado', time: '3:10 AM', text: 'Okay, I will be home by then.' },
    ],
  },
  {
    customerName: 'Mia Bautista',
    customerHandle: '@miab',
    avatarUrl: portrait('women', 36),
    origin: 'Instagram',
    handledBy: 'AI Agent',
    activeMessages: 3,
    unread: 1,
    lastActivity: '4h 18m ago',
    status: 'Package advice',
    tags: ['Bundle', 'New lead'],
    summary: 'Lead wants advice on which package fits a sofa, mattress, and rug bundle.',
    messages: [
      { side: 'incoming', sender: 'Mia Bautista', time: '2:46 AM', text: 'Which package should I choose for sofa, mattress, and a small rug?' },
      { side: 'outgoing', sender: 'AI Agent', time: '2:48 AM', text: 'A bundle may be better than separate services. What sofa size and mattress size do you have?' },
      { side: 'incoming', sender: 'Mia Bautista', time: '2:50 AM', text: 'Three-seater sofa and queen mattress.' },
    ],
  },
  {
    customerName: 'Tessa Chua',
    customerHandle: '@tessachua',
    avatarUrl: portrait('women', 58),
    origin: 'Telegram',
    handledBy: 'Live Agent',
    activeMessages: 2,
    unread: 0,
    lastActivity: '5h ago',
    status: 'Cancelled',
    tags: ['Cancellation', 'Refund'],
    summary: 'Customer cancelled a booking and needs confirmation of the refund timeline.',
    messages: [
      { side: 'incoming', sender: 'Tessa Chua', time: '1:58 AM', text: 'I need to cancel tomorrow. When will the deposit be refunded?' },
      { side: 'outgoing', sender: 'Cami - Live Agent', time: '2:03 AM', text: 'I have cancelled the booking. Refunds are processed within 3 to 5 business days.' },
    ],
  },
  {
    customerName: 'Noel Garcia',
    customerHandle: '@noelg',
    avatarUrl: portrait('men', 62),
    origin: 'WhatsApp',
    handledBy: 'AI Agent',
    activeMessages: 3,
    unread: 2,
    lastActivity: '5h 26m ago',
    status: 'Area check',
    tags: ['Coverage', 'Lead'],
    summary: 'Customer asks if the team services a subdivision outside the usual coverage area.',
    messages: [
      { side: 'incoming', sender: 'Noel Garcia', time: '1:22 AM', text: 'Do you service homes near Antipolo boundary?' },
      { side: 'outgoing', sender: 'AI Agent', time: '1:24 AM', text: 'We may be able to. Please send the exact barangay or nearby landmark so I can confirm coverage.' },
      { side: 'incoming', sender: 'Noel Garcia', time: '1:27 AM', text: 'Near Valley Golf.' },
    ],
  },
  {
    customerName: 'Sofia Lao',
    customerHandle: '@sofialao',
    avatarUrl: portrait('women', 81),
    origin: 'Messenger',
    handledBy: 'Live Agent',
    activeMessages: 5,
    unread: 1,
    lastActivity: '6h ago',
    status: 'Repeat booking',
    tags: ['VIP', 'Recurring'],
    summary: 'Repeat customer wants the same technician team for a monthly cleaning schedule.',
    messages: [
      { side: 'incoming', sender: 'Sofia Lao', time: '12:41 AM', text: 'Can I request the same team from last time for monthly cleaning?' },
      { side: 'outgoing', sender: 'Erika - Live Agent', time: '12:48 AM', text: 'Yes, I can note your preferred team and check their recurring availability.' },
      { side: 'incoming', sender: 'Sofia Lao', time: '12:51 AM', text: 'Every first Friday would be ideal.' },
    ],
  },
];

// Canned replies offered in the chat Template Drawer. Each is a short, reusable
// message an agent can drop into the composer.
export const MESSAGE_TEMPLATES = [
  {
    id: 'tmpl-greeting',
    title: 'Friendly greeting',
    body: 'Hi! Thanks for reaching out to Wise Cleaner Shop 😊 How can we help you today?',
    tags: ['greeting', 'welcome', 'hello'],
  },
  {
    id: 'tmpl-pricing-sofa',
    title: 'Pricing — sofa cleaning',
    body: 'Sofa deep cleaning starts at ₱1,200 for a 3-seater. The final quote depends on the size, fabric, and stain level. Could you share a photo and your sofa details?',
    tags: ['pricing', 'sofa', 'quote', 'estimate'],
  },
  {
    id: 'tmpl-same-day',
    title: 'Same-day availability',
    body: 'Good news — we may have a same-day slot open! Please share your area and preferred time so I can confirm availability for you.',
    tags: ['availability', 'same-day', 'schedule', 'booking'],
  },
  {
    id: 'tmpl-booking-confirm',
    title: 'Booking confirmation',
    body: 'Your booking is confirmed ✅ Our team will arrive within the scheduled window, and you’ll get a reminder a day before. Thank you for choosing us!',
    tags: ['booking', 'confirmation', 'schedule'],
  },
  {
    id: 'tmpl-reschedule',
    title: 'Reschedule request',
    body: 'No problem at all — we can move your appointment. What date and time would work best for you?',
    tags: ['reschedule', 'booking', 'schedule'],
  },
  {
    id: 'tmpl-deposit',
    title: 'Deposit request',
    body: 'To lock in your slot we ask for a 50% deposit. I can send the GCash/bank details here — would you like to proceed?',
    tags: ['deposit', 'payment', 'gcash'],
  },
  {
    id: 'tmpl-safe-products',
    title: 'Pet & baby-safe products',
    body: 'Yes! Our solutions are fabric-safe, and we can note a fragrance-free, pet- and baby-safe preference on your booking.',
    tags: ['safety', 'products', 'pets', 'baby', 'allergy'],
  },
  {
    id: 'tmpl-follow-up',
    title: 'Post-service follow-up',
    body: 'Hi! We hope you’re happy with the clean ✨ If anything needs a quick touch-up, just let us know. A short review would mean a lot if you have a moment!',
    tags: ['follow-up', 'review', 'post-service'],
  },
  {
    id: 'tmpl-arrival-window',
    title: 'Arrival window',
    body: 'Our team will arrive within the confirmed service window. We will message you once they are on the way.',
    tags: ['arrival', 'schedule', 'booking'],
  },
  {
    id: 'tmpl-address-request',
    title: 'Request address',
    body: 'Please send the full service address, building name, unit number, and any parking or security instructions so we can prepare the team.',
    tags: ['address', 'booking', 'access'],
  },
  {
    id: 'tmpl-photo-request',
    title: 'Request photos',
    body: 'Could you send clear photos of the item or area to be cleaned? This helps us give a more accurate quote and prepare the right materials.',
    tags: ['photo', 'quote', 'estimate'],
  },
  {
    id: 'tmpl-payment-received',
    title: 'Payment received',
    body: 'Payment received. Thank you! Your slot is now secured, and we will keep you updated before the service date.',
    tags: ['payment', 'deposit', 'confirmation'],
  },
  {
    id: 'tmpl-invoice-info',
    title: 'Invoice details needed',
    body: 'For the official receipt or invoice, please send the company name, TIN, billing address, and email where we should send the document.',
    tags: ['invoice', 'receipt', 'billing'],
  },
  {
    id: 'tmpl-service-area',
    title: 'Service area check',
    body: 'May I confirm your city or barangay? I will check if your address is covered by our available team routes.',
    tags: ['area', 'coverage', 'location'],
  },
  {
    id: 'tmpl-prep-instructions',
    title: 'Before service prep',
    body: 'Before the team arrives, please clear small items from the work area and keep pets or children away from the cleaning zone during service.',
    tags: ['prep', 'instructions', 'service'],
  },
  {
    id: 'tmpl-team-delay',
    title: 'Team delay notice',
    body: 'Quick update: our team is running slightly behind schedule due to traffic. We are tracking their arrival and will update you again shortly.',
    tags: ['delay', 'arrival', 'operations'],
  },
  {
    id: 'tmpl-review-link',
    title: 'Review link resend',
    body: 'Thank you for choosing Wise Cleaner Shop. Here is the review link again. We would appreciate your feedback when you have a moment.',
    tags: ['review', 'follow-up', 'post-service'],
  },
  {
    id: 'tmpl-unavailable-slot',
    title: 'Unavailable slot',
    body: 'That slot is already taken, but I can offer the nearest available options. Would morning, afternoon, or evening work best for you?',
    tags: ['availability', 'schedule', 'booking'],
  },
  {
    id: 'tmpl-quote-followup',
    title: 'Quote follow-up',
    body: 'Just following up on the quote we sent. Would you like us to reserve a tentative slot while you decide?',
    tags: ['quote', 'follow-up', 'lead'],
  },
  {
    id: 'tmpl-recurring-cleaning',
    title: 'Recurring cleaning',
    body: 'We can set up a recurring schedule weekly, biweekly, or monthly. Tell us your preferred frequency and day so we can check team availability.',
    tags: ['recurring', 'schedule', 'vip'],
  },
];

export function buildPageCards(sourcePages) {
  const pages = sourcePages.length > 0 ? sourcePages : FALLBACK_PAGES;

  return pages.map((page, index) => ({
    id: String(page.id),
    name: page.account_name || `Page ${index + 1}`,
    fbPageId: page.fb_page_id || '',
  }));
}

export function buildConversations(pageCards) {
  return pageCards.flatMap((page, pageIndex) =>
    Array.from({ length: 5 }, (_, slot) => {
      const template = CONVERSATION_LIBRARY[(pageIndex * 5 + slot) % CONVERSATION_LIBRARY.length];
      const variance = (pageIndex + slot) % 2;

      return {
        id: `${page.id}-thread-${slot + 1}`,
        pageId: page.id,
        pageName: page.name,
        customerName: template.customerName,
        customerHandle: template.customerHandle,
        avatarUrl: template.avatarUrl,
        origin: template.origin,
        handledBy: template.handledBy,
        activeMessages: template.activeMessages + variance,
        unread: Math.max(0, template.unread + variance - (slot === 2 ? 1 : 0)),
        lastActivity: template.lastActivity,
        status: template.status,
        tags: template.tags,
        summary: template.summary,
        messages: template.messages.map((message, messageIndex) => ({
          ...message,
          id: `${page.id}-thread-${slot + 1}-message-${messageIndex + 1}`,
        })),
      };
    }),
  );
}

export function formatTotal(conversations, handledBy) {
  return conversations
    .filter((conversation) => conversation.handledBy === handledBy)
    .reduce((total, conversation) => total + conversation.activeMessages, 0);
}

export function resolveSelectedPageId(pageCards, requestedId, preferredId) {
  if (requestedId && pageCards.some((page) => page.id === requestedId)) return requestedId;
  if (preferredId && pageCards.some((page) => page.id === preferredId)) return preferredId;
  return pageCards[0]?.id || null;
}

export function messagePreview(text, limit = 88) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  if (limit <= 3) return clean.slice(0, limit);
  return `${clean.slice(0, limit - 3)}...`;
}

// The conversation-list preview, prefixed with who sent the last message — like
// "You: …" / "AI Agent: …" / "Demo User: …". Only OUTGOING messages get a prefix;
// an incoming (customer) message is shown bare since the card title is already the
// customer. The prefix collapses to "You" when the sender matches the current user,
// so after a transfer a teammate still sees the original sender (e.g. "Demo User:").
// `sender` is the agent's display name on outgoing messages (see sendMessage), which
// equals the auth user's name — that's the match.
export function conversationPreview(conversation, currentUserName = '') {
  const text = conversation.summary || '';
  const messages = conversation.messages || [];
  const last = messages[messages.length - 1];
  if (!text || !last || last.side !== 'outgoing') return text;

  const sender = String(last.sender || '').trim();
  if (!sender) return text;

  const label = currentUserName && sender === currentUserName ? 'You' : sender;
  return `${label}: ${text}`;
}
