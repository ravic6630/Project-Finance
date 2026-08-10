import { Link } from 'react-router-dom';
import { Sprout } from 'lucide-react';

// Public privacy policy. Google Play and the App Store both require a
// publicly reachable policy URL (no login), and finance apps get checked, so
// this route stays outside the auth wall.
const UPDATED = '9 August 2026';

function Section({ title, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

export default function Privacy() {
  return (
    <div className="min-h-screen bg-[#faf9f5]">
      <header className="border-b border-[#e8e2d4] bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-6 py-4">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
              <Sprout size={20} />
            </div>
            <span className="font-display text-lg font-extrabold text-brand-900">Sampada</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="font-display text-3xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated {UPDATED}</p>

        <p className="mt-6 text-sm leading-relaxed text-slate-600">
          Sampada is a personal wealth tracker. You tell it what you own, and it shows you what
          that&apos;s worth over time. This policy explains exactly what we store, why, and what we
          never do. It applies to the Sampada website and the Sampada mobile apps.
        </p>

        <Section title="What we collect">
          <p>
            <b>Your account.</b> Your email address, your name, and a one-way hash of your password.
            We never store your password itself. If you turn on two-factor authentication we store
            the secret your authenticator app needs.
          </p>
          <p>
            <b>The financial information you enter.</b> Holdings, bank and cash accounts, assets such
            as property, transactions, goals, budgets, and family members you choose to track. This
            is the whole point of the product, and it is visible only to you.
          </p>
          <p>
            <b>Broker connections, if you create one.</b> If you link a broker such as Upstox, we
            store the access token that broker issues, on our server, so we can read your holdings.
            We can only read positions — Sampada can never place, modify, or cancel a trade, and we
            never receive your broker password.
          </p>
          <p>
            <b>A daily record of your net worth,</b> so the history chart and monthly statements can
            show how your wealth has moved.
          </p>
          <p>
            <b>Sign-in sessions.</b> For each signed-in device we record a browser/app description
            and IP address, so you can see and sign out of your devices in Settings.
          </p>
          <p>
            <b>Messages you send us</b> through in-app support, and your email preferences.
          </p>
        </Section>

        <Section title="What we never collect">
          <p>
            We do not collect card numbers, bank login credentials, government identity numbers, your
            contacts, your location, your photos, or your device&apos;s files. If you import a CAS
            statement, the PDF is parsed and never stored. Sampada contains no advertising and no
            third-party analytics or tracking SDKs.
          </p>
        </Section>

        <Section title="How we use it">
          <p>
            Only to run the product for you: to show your dashboard, price your holdings, send the
            email reports you switch on, keep your account secure, and answer your support messages.
          </p>
          <p>
            <b>We never sell your data, and we never share it for advertising.</b> We do not use your
            financial data to build profiles or train models.
          </p>
        </Section>

        <Section title="Who else is involved">
          <p>
            To provide the service we rely on a small number of processors:{' '}
            <b>Render</b> (application hosting), <b>Turso</b> (database hosting), and <b>Brevo</b>{' '}
            (sending email). To price your holdings we request public market data from{' '}
            <b>Yahoo Finance</b>, <b>AMFI/mfapi</b> for Indian mutual-fund NAVs, and an exchange-rate
            service. Those price requests contain the ticker or scheme code only — never your
            identity, your quantities, or your balances.
          </p>
        </Section>

        <Section title="Family sharing">
          <p>
            If you link another Sampada account as a family member, both of you see each other&apos;s
            <b> totals</b> — investments, cash, assets and net worth — and nothing else. Individual
            transactions, budgets and goals stay private to each account. Linking requires the other
            person to accept, it is view-only in both directions, and either side can unlink at any
            time, which ends the sharing immediately.
          </p>
        </Section>

        <Section title="Security">
          <p>
            Traffic is encrypted in transit with HTTPS. Passwords are hashed with bcrypt. You can
            enable two-factor authentication and, in the mobile apps, a biometric app lock. Every
            request is scoped to your own account: another user — including a linked family member —
            can never read your individual records or modify anything you own.
          </p>
        </Section>

        <Section title="Keeping and deleting your data">
          <p>
            We keep your data for as long as your account exists. You can download everything you
            have put into Sampada at any time from <b>Settings → Your data</b> as a single JSON file
            (broker tokens are never included in that export).
          </p>
          <p>
            To delete your account and everything in it, message us from in-app support or email{' '}
            <a className="font-semibold text-brand-700 underline" href="mailto:ravic6631@gmail.com">
              ravic6631@gmail.com
            </a>
            . We remove your account and all associated records, including any broker tokens, within
            30 days.
          </p>
        </Section>

        <Section title="Payments">
          <p>
            Sampada Premium is paid for outside the mobile apps. When you tell us you have paid, we
            record the plan, the amount and any reference you provide, so we can match your payment.
            We never see or store card numbers or bank credentials.
          </p>
        </Section>

        <Section title="Children">
          <p>Sampada is not intended for anyone under 18, and we do not knowingly collect their data.</p>
        </Section>

        <Section title="Changes and contact">
          <p>
            If this policy changes materially we will update this page and the date above. Questions
            about your data, or a deletion request?{' '}
            <a className="font-semibold text-brand-700 underline" href="mailto:ravic6631@gmail.com">
              ravic6631@gmail.com
            </a>
            .
          </p>
        </Section>

        <div className="mt-12 border-t border-[#e8e2d4] pt-6">
          <Link to="/" className="text-sm font-semibold text-brand-700 hover:underline">
            ← Back to Sampada
          </Link>
        </div>
      </main>
    </div>
  );
}
