// Lightweight bilingual copy for the order agreement document + customer viewer. A small
// dictionary (English + Tagalog), not a full i18n framework — the agreement is the only
// customer-facing, translated surface. Add a language by adding an entry to DICT and to
// AGREEMENT_LANGUAGES.

export const AGREEMENT_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'tl', label: 'Tagalog' },
];

const DICT = {
  en: {
    docTitle: 'Order Agreement',
    orderSummary: 'Order summary',
    item: 'Item',
    qty: 'Qty',
    unitPrice: 'Unit price',
    amount: 'Amount',
    subtotal: 'Subtotal',
    discounts: 'Discounts',
    total: 'Total',
    quote: 'Quote',
    quoteNote: 'Quote items are priced separately and are not included in the total.',
    deliverTo: 'Deliver to',
    fullName: 'Full name',
    address: 'Delivery address',
    contact: 'Contact number',
    email: 'Email',
    notes: 'Notes',
    swornStatement:
      'I confirm that I ordered the products listed above, that they are to be delivered to the address shown, and I swear that the information provided is true and correct.',
    agreeCheckbox: 'I have read and agree to the statement above.',
    confirmOrder: 'Confirm Order',
    confirming: 'Confirming…',
    expiresIn: 'Expires in',
    expiredTitle: 'This order link has expired',
    expiredSub: 'Please ask the seller for a new order link.',
    confirmedTitle: 'Order confirmed',
    confirmedSub: 'Thank you! Your order has been placed. This link can no longer be used.',
    closedTitle: 'This order is closed',
    closedSub: 'This order link is no longer available.',
    invalidTitle: 'Order not found',
    invalidSub: 'This order link is not valid.',
    language: 'Language',
  },
  tl: {
    docTitle: 'Kasunduan sa Order',
    orderSummary: 'Buod ng order',
    item: 'Produkto',
    qty: 'Dami',
    unitPrice: 'Presyo',
    amount: 'Halaga',
    subtotal: 'Subtotal',
    discounts: 'Diskwento',
    total: 'Kabuuan',
    quote: 'Presyuhin',
    quoteNote: 'Ang mga item na "Presyuhin" ay hiwalay na presyuhin at hindi kasama sa kabuuan.',
    deliverTo: 'Ihahatid kay',
    fullName: 'Buong pangalan',
    address: 'Address ng delivery',
    contact: 'Numero ng kontak',
    email: 'Email',
    notes: 'Mga tala',
    swornStatement:
      'Pinagtitibay ko na inorder ko ang mga produktong nakalista sa itaas, na ihahatid ang mga ito sa address na nakasaad, at isinusumpa ko na totoo at tama ang lahat ng impormasyong ibinigay.',
    agreeCheckbox: 'Nabasa at sumasang-ayon ako sa pahayag sa itaas.',
    confirmOrder: 'Kumpirmahin ang Order',
    confirming: 'Kinukumpirma…',
    expiresIn: 'Mag-e-expire sa',
    expiredTitle: 'Nag-expire na ang link na ito',
    expiredSub: 'Mangyaring humingi ng bagong order link sa nagbebenta.',
    confirmedTitle: 'Nakumpirma ang order',
    confirmedSub: 'Salamat! Naiproseso na ang iyong order. Hindi na magagamit ang link na ito.',
    closedTitle: 'Sarado na ang order na ito',
    closedSub: 'Hindi na available ang link na ito.',
    invalidTitle: 'Hindi nakita ang order',
    invalidSub: 'Hindi wasto ang link na ito.',
    language: 'Wika',
  },
};

export function agreementT(lang) {
  return DICT[lang] || DICT.en;
}
