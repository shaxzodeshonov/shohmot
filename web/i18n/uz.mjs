// Shohmot in Uzbek (Latin script): every English line the site shows, keyed by
// the English. Loaded only when Uzbek is on (scripts/i18n.js explains the keys).
import app from './uz/app.mjs';
import site from './uz/site.mjs';
import review from './uz/review.mjs';
import train from './uz/train.mjs';

export default { ...app, ...site, ...review, ...train };
