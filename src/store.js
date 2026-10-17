// Tiny JSON-file store. Everything lives in data/store.json.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'store.json');

const DEFAULT_ACCOUNTS = [
  { platform: 'chesscom', username: 'shaxzod_e' },
  { platform: 'chesscom', username: 'kindofinterestedinchess' },
  { platform: 'lichess', username: 'shaxzod_e' },
];

function accountId(platform, username) {
  return `${platform}:${username.toLowerCase()}`;
}

function emptyAccountData() {
  return { profile: null, games: [], months: {}, lastSyncAt: null, lastError: null };
}

function load() {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    state = {
      accounts: DEFAULT_ACCOUNTS.map((a) => ({ id: accountId(a.platform, a.username), ...a, addedAt: Date.now() })),
      data: {},
    };
  }
  for (const a of state.accounts) {
    if (!state.data[a.id]) state.data[a.id] = emptyAccountData();
  }
  return state;
}

let pending = null;
function save(state) {
  // Coalesce bursts of writes into one, and write atomically.
  clearTimeout(pending);
  pending = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, FILE);
  }, 250);
}

module.exports = { load, save, accountId, emptyAccountData };
