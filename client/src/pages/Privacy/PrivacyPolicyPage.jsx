import { Link } from 'react-router-dom';
import { Logo } from '../../components/ui.jsx';

// Edit these two as needed.
const LAST_UPDATED = 'June 2, 2026';
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
          This Privacy Policy explains how <strong>Wise Cleaner Shop</strong> (&ldquo;we&rdquo;, &ldquo;us&rdquo;,
          &ldquo;our&rdquo;) collects, uses, and protects your information when you use <strong>pwise</strong> (the
          &ldquo;App&rdquo;), our social-media post scheduling tool available at{' '}
          <a href="https://pwise.sixpent.com">pwise.sixpent.com</a>. By using the App, you agree to this policy.
        </p>

        <h2>1. Information We Collect</h2>
        <ul>
          <li>
            <strong>Account information</strong> — your name, email address, and a securely hashed password.
          </li>
          <li>
            <strong>Content you provide</strong> — images, videos, captions, and scheduling details you upload to be
            posted.
          </li>
          <li>
            <strong>Facebook Page data</strong> — when you connect a Facebook Page, we access only the data needed to
            publish your posts and to read engagement (reactions, comments, shares, and video views) on the posts the
            App publishes on your behalf.
          </li>
          <li>
            <strong>Usage and logs</strong> — records of posting attempts and their results, used to operate and
            troubleshoot the service.
          </li>
        </ul>

        <h2>2. How We Use Your Information</h2>
        <ul>
          <li>To authenticate you and keep your account secure.</li>
          <li>To schedule and publish your content to your connected Facebook Page.</li>
          <li>To show you analytics and engagement for posts the App published.</li>
          <li>To send you operational emails, such as posting results and low-content alerts.</li>
        </ul>

        <h2>3. Facebook / Meta Platform Data</h2>
        <p>
          The App uses the Facebook Graph API. With your explicit permission, it requests only the access needed to
          operate — for example, to publish content to your Page and to read engagement on your own Page&rsquo;s posts
          (permissions such as <code>pages_manage_posts</code>, <code>pages_read_engagement</code>, and{' '}
          <code>read_insights</code>). We do not access your private messages, your friends, or any data beyond what is
          required to provide the service, and we use Facebook/Meta data only in accordance with Meta&rsquo;s Platform
          Terms and Developer Policies.
        </p>

        <h2>4. How We Store and Protect Your Data</h2>
        <p>
          Your account data is stored in a secured database, and your uploaded media is stored privately on Amazon Web
          Services (Amazon S3). Access tokens are stored securely and used only to perform actions you have authorized.
          Data is transmitted over encrypted (HTTPS) connections.
        </p>

        <h2>5. How We Share Your Information</h2>
        <p>
          We do <strong>not</strong> sell your personal information. We share data only as needed to run the service:
          with <strong>Meta / Facebook</strong>, to publish the content you schedule; and with infrastructure providers
          (such as Amazon Web Services) that host our application and store your media on our behalf.
        </p>

        <h2>6. Data Retention and Deletion</h2>
        <p>
          We retain your information for as long as your account is active. You may request access to, correction of, or
          deletion of your data at any time. To request deletion, email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with the subject line &ldquo;Delete my data&rdquo; from
          the address associated with your account, and we will delete your account and its associated content from our
          systems. You can also revoke the App&rsquo;s access to your Facebook Page at any time from your Facebook
          settings (Settings &rarr; Business Integrations).
        </p>

        <h2>7. Cookies and Local Storage</h2>
        <p>
          We use a sign-in token stored in your browser&rsquo;s local storage to keep you logged in. We do not use
          third-party advertising or tracking cookies.
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
