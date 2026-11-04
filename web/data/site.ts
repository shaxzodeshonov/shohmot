// Who runs Shohmot and what it costs, for the legal pages, pricing and emails.
// Set these in Vercel → Settings → Environment Variables (they're read at build
// time); see .env.example.
const env = import.meta.env;

export const SITE = {
  name: 'Shohmot',
  /** The public address, e.g. https://shohmot.app (also used for canonical links and the sitemap). */
  url: (env.SITE_URL || 'https://shohmot.vercel.app').replace(/\/$/, ''),
  /** Where people write for help, privacy requests and refunds. */
  support: env.PUBLIC_SUPPORT_EMAIL || 'support@shohmot.app',
  /** The person or company that runs the service, as it should appear in the terms. */
  operator: env.PUBLIC_OPERATOR_NAME || 'the Shohmot team',
  /** Whose courts and laws the terms fall under. */
  law: env.PUBLIC_GOVERNING_LAW || 'the country where the operator is established',
  /** When the legal pages last changed. */
  legalUpdated: '4 November 2026',
};

export const PRICES = {
  currency: env.PUBLIC_PRICE_CURRENCY || '$',
  pro: env.PUBLIC_PRICE_PRO || '5',
  coach: env.PUBLIC_PRICE_COACH || '19',
};

export const COACH_SEATS = 30;
export const FREE_PUZZLES = 10;
