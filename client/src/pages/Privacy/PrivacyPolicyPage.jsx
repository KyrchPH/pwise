import { Link } from 'react-router-dom';
import { Logo } from '../../components/ui.jsx';

// Edit these two as needed.
const LAST_UPDATED = 'June 18, 2026';
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
          the &ldquo;App&rdquo;) collects, uses, and protects your information. pwise is a social-media management tool
          available at <a href="https://pwise.sixpent.com">pwise.sixpent.com</a> that lets you connect and manage one or
          more Facebook Pages you own or administer — scheduling and publishing posts, storing shared files in a team
          Vault, and handling customer messages from a shared inbox. You may also optionally attach a Telegram bot to a
          connected Page. Any such Page can be bound to your account, and this policy applies to every channel you
          connect, regardless of its name or brand. The App is intended for internal and personal use only and is not
          offered as a public or commercial service. By using the App, you agree to this policy.
        </p>

        <h2>1. Information We Collect</h2>
        <ul>
          <li>
            <strong>Account information</strong> — your name, email address, and a securely hashed password.
          </li>
          <li>
            <strong>Content you provide</strong> — images, videos, captions, scheduling details, content-planning
            notes, video templates, and any files you upload to the shared team Vault. Uploaded images and videos may
            have a small preview thumbnail generated automatically.
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
            <strong>Telegram bots</strong> — you may optionally connect a Telegram bot to a Page by providing its bot
            token (API key) and name. We store the token encrypted and use it only to send and receive messages through
            that bot.
          </li>
          <li>
            <strong>Customer messages</strong> — when someone messages a Facebook Page or Telegram bot you have
            connected, we receive and store that conversation so your team can read and reply to it. This may include
            the sender&rsquo;s name or handle, their profile picture, the message text, and any photos, videos, or files
            they send.
          </li>
          <li>
            <strong>Usage and logs</strong> — records of posting attempts and their results, used to operate and
            troubleshoot the service.
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
            To receive customer messages from your connected channels and let your team view and reply to them from a
            shared inbox.
          </li>
          <li>To send you operational emails, such as posting results and low-content alerts.</li>
        </ul>

        <h2>3. Facebook / Meta Platform Data</h2>
        <p>
          The App uses the Facebook Graph API. With your explicit permission, it requests only the access needed to
          operate: to see the list of Pages you manage so you can choose which to connect (<code>pages_show_list</code>);
          to publish content to the Pages you connect (<code>pages_manage_posts</code>); to read each Page&rsquo;s name,
          follower count, and the engagement on posts the App published (<code>pages_read_engagement</code>); and to read
          Page-level insights such as reach and impressions (<code>read_insights</code>). We access only Pages you manage
          and explicitly connect, and only Page-level data — we do not access your personal profile beyond the list of
          Pages you manage, your friends, or your private messages, and we request no data beyond what is required to
          provide the service. We use Facebook/Meta Platform Data solely to provide the App&rsquo;s features; we do not
          sell it, and we do not use it for advertising or any unrelated purpose. Our use complies with Meta&rsquo;s
          Platform Terms and Developer Policies.
        </p>

        <h2>4. How We Store and Protect Your Data</h2>
        <p>
          Your account data, content, and customer conversations are stored in a secured database, and uploaded media —
          including Vault files, post media, generated thumbnails, and message attachments — is stored privately on
          Amazon Web Services (Amazon S3). Connected-channel credentials (Facebook Page access tokens and Telegram bot
          tokens) are encrypted at rest and used only to perform actions you have authorized; they are deleted when you
          disconnect the channel or delete your account. Data is transmitted over encrypted (HTTPS) connections.
        </p>

        <h2>5. How We Share Your Information</h2>
        <p>We do <strong>not</strong> sell your personal information. We share data only as needed to run the service:</p>
        <ul>
          <li>
            with <strong>Meta / Facebook</strong>, to publish the content you schedule and to read the Page data
            described above;
          </li>
          <li>
            with <strong>Telegram</strong>, when you connect a Telegram bot, to send and receive messages through it;
          </li>
          <li>
            with <strong>infrastructure providers</strong> (such as Amazon Web Services) that host our application and
            store your files and media on our behalf;
          </li>
          <li>
            with an <strong>automation / workflow provider</strong> that we use to publish your posts and to deliver
            incoming customer messages from your connected channels into the App; and
          </li>
          <li>
            when you use the optional &ldquo;Generate with Template&rdquo; feature, with a{' '}
            <strong>third-party video-rendering provider</strong> that processes your input video and caption to produce
            the finished video.
          </li>
        </ul>

        <h2>6. Data Retention and Deletion</h2>
        <p>
          We retain your information for as long as your account is active. You may request access to, correction of, or
          deletion of your data at any time. To request deletion, email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with the subject line &ldquo;Delete my data&rdquo; from
          the address associated with your account, and we will delete your account and its associated content
          (including uploaded files and stored conversations) from our systems. Admins can also remove a connected
          channel (a Facebook Page or its attached Telegram bot) at any time from the App&rsquo;s settings, which deletes
          that channel&rsquo;s stored credentials. You can also revoke the App&rsquo;s access to any connected Facebook
          Page at any time from your Facebook settings (Settings &rarr; Business Integrations); revoking access stops the
          App from accessing that Page.
        </p>

        <h2>7. Cookies and Local Storage</h2>
        <p>
          We use a sign-in token stored in your browser&rsquo;s local storage to keep you logged in, and we store your
          display preference (such as light or dark theme) locally on your device. We do not use third-party advertising
          or tracking cookies.
        </p>

        <h2>8. Children&rsquo;s Privacy</h2>
        <p>
          The App is not intended for, and we do not knowingly collect information from, children under 13 years of age.
        </p>

        <h2>9. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. When we do, we will revise the &ldquo;Last updated&rdquo;
          date above. Continued use of the App after changes take effect constitutes acceptance of the updated policy.
        </p>

        <h2>10. Contact Us</h2>
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
