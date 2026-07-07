import { Link } from 'react-router-dom';
import { Logo } from '../../components/ui.jsx';

// Edit these two as needed.
const LAST_UPDATED = 'July 7, 2026';
const CONTACT_EMAIL = 'sixpent3@gmail.com';

export default function PrivacyPolicyPage() {
  return (
    <div className="legal">
      <div className="legal__inner">
        <div className="legal__head">
          <Logo height={72} />
          <h1>Privacy Policy</h1>
          <div className="legal__updated">Last updated: {LAST_UPDATED}</div>
        </div>

        <p>
          This Privacy Policy explains how <strong>pwise</strong> (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;,
          the &ldquo;App&rdquo;) collects, uses, shares, and protects information. pwise is a social-media and
          customer-messaging management tool available at <a href="https://pwise.sixpent.com">pwise.sixpent.com</a> that
          lets you connect and manage one or more Facebook Pages you own or administer — scheduling and publishing posts,
          storing shared files in a team Vault, managing a product catalog, and handling customer conversations from a
          shared inbox. Where you enable them, the App also connects the <strong>Instagram</strong> and{' '}
          <strong>WhatsApp</strong> accounts linked to a Page, and an optional <strong>Telegram</strong> bot, so you can
          receive and answer messages from all of these channels in one place. Because the App handles messages, it also
          processes information about the people who contact your connected channels, on your behalf. This policy applies
          to every channel you connect, regardless of its name or brand. By using the App, you agree to this policy.
        </p>

        <h2>1. Information We Collect</h2>
        <ul>
          <li>
            <strong>Account information</strong> — your name, email address, and a securely hashed password.
          </li>
          <li>
            <strong>Content you provide</strong> — images, videos, captions, scheduling details, content-planning notes,
            video templates, product-catalog entries, and any files you upload to the shared team Vault. Uploaded images
            and videos may have a small preview thumbnail generated automatically.
          </li>
          <li>
            <strong>Facebook Page data</strong> — you may connect one or more Facebook Pages that you manage. For each
            connected Page we access only the data needed to operate: which Pages you manage, so you can choose the ones
            to connect; each Page&rsquo;s name and follower count (to display your Pages and let you switch the active
            Page); engagement (reactions, comments, shares, and video views) on the posts the App publishes on your
            behalf; and Page-level insights such as reach and impressions. We record these figures over time so we can
            show you historical trends for each Page. Every connected Page is handled the same way and kept separate from
            your other Pages.
          </li>
          <li>
            <strong>Instagram and WhatsApp channels</strong> — where a connected Page has a linked Instagram account or
            WhatsApp business number and you enable that channel, we access the account/number identifier and the
            messages sent to it, so those conversations appear in your shared inbox alongside Messenger and Telegram.
          </li>
          <li>
            <strong>Telegram bots</strong> — you may optionally connect a Telegram bot to a Page by providing its bot
            token (API key) and name. We store the token encrypted and use it only to send and receive messages through
            that bot.
          </li>
          <li>
            <strong>Customer messages</strong> — when someone contacts a channel you have connected (a Facebook Page via
            Messenger, an Instagram account, a WhatsApp business number, or a Telegram bot), we receive and store that
            conversation so your team can read and reply to it. Depending on the channel this may include the
            person&rsquo;s name, username or handle, phone number (WhatsApp), profile picture, the message text, and any
            photos, videos, or files they send, along with timestamps and delivery status.
          </li>
          <li>
            <strong>Orders</strong> — if you use the shop features, the details a customer provides to place an order
            (such as name, contact number, item and quantity, and any address or scheduling notes) are stored on the
            related conversation for your team to fulfill.
          </li>
          <li>
            <strong>Usage and logs</strong> — records of posting attempts, message delivery, and their results, used to
            operate and troubleshoot the service.
          </li>
        </ul>

        <h2>2. How We Use Your Information</h2>
        <ul>
          <li>To authenticate you and keep your account secure.</li>
          <li>To schedule and publish your content to your connected Facebook Page(s).</li>
          <li>To display your connected Pages, let you switch the active Page, and show its follower count.</li>
          <li>
            To record engagement and Page-level insights (such as reach and impressions) over time and show you
            analytics and historical trends, per Page, for the content the App published.
          </li>
          <li>To store files your team uploads to the shared Vault and make them available across your workspace.</li>
          <li>
            To receive customer messages from your connected Facebook, Instagram, WhatsApp, and Telegram channels and let
            your team view and reply to them from a shared inbox.
          </li>
          <li>
            To provide an optional AI assistant that reads incoming messages and drafts or sends replies, answers common
            product and order questions, and can hand a conversation over to a human teammate. You control whether the AI
            assistant or a human handles each conversation, and you can turn it off.
          </li>
          <li>To send you operational emails, such as posting results and low-content alerts.</li>
        </ul>

        <h2>3. Facebook / Meta Platform Data</h2>
        <p>
          The App uses the Facebook Graph API and the Messenger, Instagram, and WhatsApp messaging APIs. With your
          explicit permission, it requests only the access needed to operate the features you enable:
        </p>
        <ul>
          <li>
            <strong>Managing your Pages and content</strong> — <code>pages_show_list</code> (to list the Pages you manage
            so you can choose which to connect), <code>pages_manage_posts</code> (to publish content to the Pages you
            connect), <code>pages_read_engagement</code> and <code>read_insights</code> (to read each Page&rsquo;s name,
            follower count, post engagement, and Page-level insights such as reach and impressions), and{' '}
            <code>pages_manage_metadata</code> (to subscribe your Page to message notifications).
          </li>
          <li>
            <strong>Messaging</strong> — <code>pages_messaging</code> (to receive and reply to Messenger conversations on
            your connected Pages); where you connect an Instagram account, <code>instagram_basic</code> and{' '}
            <code>instagram_manage_messages</code> (to receive and reply to Instagram messages); and where you connect a
            WhatsApp business number, <code>whatsapp_business_messaging</code> and <code>whatsapp_business_management</code>{' '}
            (to receive and reply to WhatsApp messages and manage the connected number).
          </li>
        </ul>
        <p>
          We access only the Pages and channels you explicitly connect, and only the data described above — we do not
          access your personal profile beyond the list of Pages you manage, your friends, or your private
          conversations. We send messages only to people who have first contacted your connected channel, within each
          platform&rsquo;s permitted messaging window, and only for user-initiated support, order confirmation, and
          related customer service. We use Facebook / Meta Platform Data solely to provide the App&rsquo;s messaging,
          publishing, and analytics features; we do not sell it, and we do not use it for advertising or any unrelated
          purpose. Our use complies with Meta&rsquo;s Platform Terms and Developer Policies.
        </p>

        <h2>4. Automated Replies and AI Processing</h2>
        <p>
          To power the optional AI assistant, the content of incoming customer messages — and the questions customers
          ask — is sent to third-party AI service providers that (a) generate a suggested or automatic reply and (b)
          match the question against your business&rsquo;s own FAQ / knowledge content and product catalog. These
          providers process the message content only to return a result to the App as part of providing the service;
          the App does not use this data for advertising or any unrelated purpose. If you prefer not to use automated
          replies, you can disable the AI assistant and handle conversations with human agents only.
        </p>

        <h2>5. How We Store and Protect Your Data</h2>
        <p>
          Your account data, content, orders, and customer conversations are stored in a secured database, and uploaded
          media — including Vault files, post media, generated thumbnails, and message attachments — is stored privately
          on Amazon Web Services (Amazon S3). Connected-channel credentials (Facebook Page access tokens, WhatsApp
          tokens, and Telegram bot tokens) are encrypted at rest and used only to perform actions you have authorized;
          they are deleted when you disconnect the channel or delete your account. Data is transmitted over encrypted
          (HTTPS) connections.
        </p>

        <h2>6. How We Share Your Information</h2>
        <p>
          We do <strong>not</strong> sell or rent your personal information. We share it only with the service providers
          (&ldquo;sub-processors&rdquo;) listed below, each of which processes it solely to provide its service to us:
        </p>
        <ul>
          <li>
            <strong>Meta Platforms, Inc.</strong> (Facebook, Instagram, WhatsApp) — to publish the content you schedule
            and to send and receive messages on your connected channels.
          </li>
          <li>
            <strong>Telegram</strong> — when you connect a Telegram bot, to send and receive messages through it.
          </li>
          <li>
            <strong>Amazon Web Services (AWS)</strong> — hosts the application and stores your files, media, and data
            (Amazon S3), primarily in the Asia Pacific (Singapore) region.
          </li>
          <li>
            <strong>DeepSeek</strong> — a large-language-model provider that receives the content of incoming customer
            messages and conversation context to generate the optional AI assistant&rsquo;s replies.
          </li>
          <li>
            <strong>OpenAI</strong> — converts your FAQ / knowledge content and customers&rsquo; questions into vector
            embeddings so a question can be matched to the right answer.
          </li>
          <li>
            <strong>Supabase</strong> — a hosted database that stores your business&rsquo;s FAQ / knowledge base (as those
            embeddings) for the AI assistant&rsquo;s lookups.
          </li>
          <li>
            <strong>Creatomate</strong> — when you use the optional &ldquo;Generate with Template&rdquo; feature, renders
            your input video and caption into the finished video.
          </li>
        </ul>
        <p>
          Our posting and message-routing automation runs on our own servers (hosted with AWS), not a separate third
          party. We share only the data each provider needs, require them to protect it and use it only to provide their
          service to us, and we may disclose information if required by law. Some of these providers may store or process
          data in countries other than your own (including outside the EEA and the UK); where that happens, we take steps
          intended to keep your data protected in accordance with applicable law.
        </p>

        <h2>7. Data Retention and Deletion</h2>
        <p>
          We retain your information for as long as your account is active and as needed to provide the service. You may
          request access to, correction of, or deletion of your data at any time:
        </p>
        <ul>
          <li>
            <strong>Request deletion</strong> — email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with the
            subject line &ldquo;Delete my data&rdquo; from the address associated with your account. We will delete your
            account and its associated content — including uploaded files, stored conversations, and customer-message
            data — from our systems within 30 days.
          </li>
          <li>
            <strong>Remove a connected channel</strong> — an admin can disconnect a Facebook Page (and any linked
            Instagram or WhatsApp channel) or a Telegram bot at any time from the App&rsquo;s settings, which deletes
            that channel&rsquo;s stored credentials and stops further message collection.
          </li>
          <li>
            <strong>Revoke access on Facebook</strong> — you can remove the App from your Facebook settings (Settings
            &rarr; Business Integrations) at any time, which stops the App from accessing that Page. To also have the
            associated stored data deleted, email us as described above.
          </li>
        </ul>
        <p>
          This section also serves as the App&rsquo;s data-deletion instructions for Meta Platform purposes.
        </p>

        <h2>8. Your Privacy Rights</h2>
        <p>
          <strong>Our role.</strong> For your account and the content you upload, we act as the data controller. For the
          messages and details of the people who contact your connected channels, the business that connects the channel
          is the controller and we act as a processor, handling that data on its behalf and instructions.
        </p>
        <p>
          <strong>Legal bases (EEA / UK).</strong> Where the EU or UK GDPR applies, we process personal data to perform
          our contract with you (to provide the App), for our legitimate interests in operating and securing the service,
          on the basis of your consent (for example, when you connect a channel or enable the optional AI assistant —
          which you can withdraw at any time), and to comply with legal obligations.
        </p>
        <p>
          <strong>Your GDPR rights.</strong> If you are in the EEA or the UK, you have the right to access, correct,
          delete, or receive a portable copy of your personal data; to restrict or object to certain processing; and to
          withdraw consent. You also have the right to lodge a complaint with your local data protection authority (in
          the UK, the Information Commissioner&rsquo;s Office).
        </p>
        <p>
          <strong>Your CCPA rights.</strong> If you are a California resident, you have the right to know what personal
          information we collect, use, and disclose; to delete it; to correct it; and not to be discriminated against for
          exercising these rights. We do <strong>not</strong> &ldquo;sell&rdquo; or &ldquo;share&rdquo; your personal
          information as those terms are defined under the CCPA/CPRA.
        </p>
        <p>
          <strong>How to exercise your rights.</strong> Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>{' '}
          from the address associated with your account, which we use to verify your request. We respond within the time
          required by law — generally one month under the GDPR and 45 days under the CCPA. If your request concerns the
          messages or details of someone who contacted a connected channel, we may direct you to, or coordinate with, the
          business that operates that channel, since it controls that data. Exercising your rights is free, and we will
          not discriminate against you for doing so.
        </p>

        <h2>9. Cookies and Local Storage</h2>
        <p>
          We use a sign-in token stored in your browser&rsquo;s local storage to keep you logged in, and we store your
          display preferences (such as light or dark theme) locally on your device. We do not use third-party advertising
          or tracking cookies.
        </p>

        <h2>10. Children&rsquo;s Privacy</h2>
        <p>
          The App is not intended for, and we do not knowingly collect information from, children under 13 years of age.
        </p>

        <h2>11. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. When we do, we will revise the &ldquo;Last updated&rdquo;
          date above. Continued use of the App after changes take effect constitutes acceptance of the updated policy.
        </p>

        <h2>12. Contact Us</h2>
        <p>
          If you have questions about this Privacy Policy or your data, contact us at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>

        <div className="legal__foot">
          <Link to="/login">&larr; Back to pwise</Link>
        </div>
      </div>
    </div>
  );
}
