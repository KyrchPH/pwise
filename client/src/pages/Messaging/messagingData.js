const FALLBACK_PAGES = [
  { id: 'demo-page-1', account_name: 'Wise Cleaner Shop', fb_page_id: '' },
  { id: 'demo-page-2', account_name: 'Wise Cleaner Pasig', fb_page_id: '' },
  { id: 'demo-page-3', account_name: 'Wise Cleaner Makati', fb_page_id: '' },
];

const CONVERSATION_LIBRARY = [
  {
    customerName: 'Maria Santos',
    customerHandle: '@marias.home',
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
      { side: 'incoming', sender: 'Maria Santos', time: '10:14 AM', text: 'I am in Pasig. It is a 3-seater sofa and one accent chair.' },
    ],
  },
  {
    customerName: 'Daniel Cruz',
    customerHandle: '@danielcrz',
    handledBy: 'Live Agent',
    activeMessages: 2,
    unread: 1,
    lastActivity: '8m ago',
    status: 'Reschedule',
    tags: ['Booking', 'Follow-up'],
    summary: 'Client wants to move tomorrow morning service to a later arrival window.',
    messages: [
      { side: 'incoming', sender: 'Daniel Cruz', time: '9:48 AM', text: 'Can we move the cleaning from 9 AM to around 1 PM tomorrow?' },
      { side: 'outgoing', sender: 'Jenny - Live Agent', time: '9:55 AM', text: 'I can check the team schedule. Is 1 PM your preferred time or is any afternoon slot okay?' },
      { side: 'incoming', sender: 'Daniel Cruz', time: '9:58 AM', text: 'Any slot after lunch works for me.' },
    ],
  },
  {
    customerName: 'Alyssa Tan',
    customerHandle: '@alyssatan',
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
    [0, 1, 2].map((slot) => {
      const template = CONVERSATION_LIBRARY[(pageIndex * 3 + slot) % CONVERSATION_LIBRARY.length];
      const variance = (pageIndex + slot) % 2;

      return {
        id: `${page.id}-thread-${slot + 1}`,
        pageId: page.id,
        pageName: page.name,
        customerName: template.customerName,
        customerHandle: template.customerHandle,
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
