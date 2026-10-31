// What each feature page and landing-page section says. The pages in
// web/pages/features/ are generated from this list, in this order.
export interface Feature {
  slug: 'counter' | 'review' | 'analysis' | 'play';
  name: string;
  eyebrow: string;
  /** The page heading; the part in *stars* is drawn in sage. */
  title: string;
  lead: string;
  short: string;
  ticks: string[];
  points: [string, string][];
  steps: [string, string][];
}

export const FEATURES: Feature[] = [
  {
    slug: 'counter',
    name: 'Game counter',
    eyebrow: 'Live game counter',
    title: 'Every game you played today, *counted.*',
    lead: 'Shohmot follows up to four Chess.com and Lichess accounts and shows, for each one, how many bullet, blitz, rapid and daily games you played today and how many you lost. It refreshes on its own every minute.',
    short: 'How many games you played today, and how many you lost, for every type on every account. Live, every minute.',
    ticks: ['Played and lost for each game type, on each account', 'Syncs every minute, and tells you when new games land', 'Any day in the last 26 weeks, from a calendar'],
    points: [
      ['Per type, per account', 'Played in big numbers, losses in coral, a win/draw/loss bar and your rating change for each type of game.'],
      ['Syncs every minute', 'New games show up on their own, with a note when they land. Hit Sync now when you can’t wait.'],
      ['Any day, 26 weeks back', 'Step back a day at a time with the arrows (or ← →), or click any day in the calendar.'],
      ['Up to four accounts', 'Mix Chess.com and Lichess. Usernames are checked against the site as you type.'],
      ['Rated or everything', 'Casual games count too, unless you tick “Rated games only”. Aborted Lichess games are left out.'],
      ['Follows you around', 'Your chess accounts are saved to your Shohmot account, so they’re there on any device you sign in on.'],
    ],
    steps: [['Create an account', 'Your name, email and a password. That’s all.'], ['Add your usernames', 'Chess.com, Lichess or both, up to four.'], ['Go play', 'Shohmot counts as you go, every minute.']],
  },
  {
    slug: 'review',
    name: 'Game review',
    eyebrow: 'Game review',
    title: 'Find out what really happened in that *loss.*',
    lead: 'Every game in your list has a Review button. Stockfish 19 analyses it in your browser and labels every move, Brilliant to Blunder, with accuracy on the scale of the site you played on.',
    short: 'Stockfish 19 reviews any game in your browser: accuracy, a label on every move, and the better move with the reason.',
    ticks: ['Accuracy on Chess.com’s or Lichess’s own scale', 'Every move labelled, Brilliant to Blunder', 'The better move as an arrow, and why yours wasn’t'],
    points: [
      ['Accuracy you can trust', 'Lichess games use Lichess’s published formula. Chess.com games use constants fitted to games Chess.com had reviewed.'],
      ['Every move labelled', 'Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss and Blunder, on Chess.com’s thresholds.'],
      ['The better move, and why', 'A best-move arrow, the engine’s line, and a short reason, like “It loses a knight” or “It allows mate in 2”.'],
      ['Eval bar and graph', 'Click the graph to jump to any moment. See your key moments and accuracy by phase.'],
      ['Deep evaluations first', 'Positions Lichess has already searched 40–60 moves deep come from its cloud, then Stockfish 19 with the full network.'],
      ['Runs on your machine', 'The server does no engine work. Results are kept, so a game opens instantly the second time.'],
    ],
    steps: [['Pick a game', 'Every game in today’s list has a Review button.'], ['Let it run', 'Quick to Deep, Strong by default.'], ['Learn from it', 'Press N to jump to your next mistake.']],
  },
  {
    slug: 'analysis',
    name: 'Analysis board',
    eyebrow: 'Analysis board',
    title: 'Try every idea. Keep every *line.*',
    lead: 'A free board for playing out any position, with a live Stockfish that follows every move and shows you its top three lines.',
    short: 'Play out any idea with a live Stockfish at your side: top three lines, the best move as an arrow, and variations as deep as you like.',
    ticks: ['Live Stockfish: top 3 lines and a best-move arrow', 'Variations nested as deep as you like', 'Load and copy PGN or FEN'],
    points: [
      ['Variations, nested', 'Go back and play something else: it becomes a variation under the move it replaces. Promote or delete lines with a right-click.'],
      ['Live engine', 'Top three lines, the best move as a blue arrow and the eval bar. Click a move in a line to play up to it.'],
      ['PGN and FEN', 'Load a PGN with variations, comments and annotations, or a FEN. Copy either back out.'],
      ['Opening names', 'From Lichess’s openings list, plus a red glow on a king in check and the result when the game ends.'],
      ['Straight from a review', 'Open any reviewed game on the board at the move you’re looking at.'],
      ['Picks up where you left off', 'Your analysis is kept in the browser, so it’s still there after a reload.'],
    ],
    steps: [['Open the board', 'Paste a PGN or FEN, or just start moving.'], ['Explore', 'Every side line is kept in the move tree.'], ['Check with Stockfish', 'Its lines update as you move.']],
  },
  {
    slug: 'play',
    name: 'Set up & play',
    eyebrow: 'Set up & play Stockfish',
    title: 'Build any position. Then play it *out.*',
    lead: 'Put pieces wherever you like and Shohmot checks the position is legal. Then play it against Stockfish at one of six strengths, or let it play itself.',
    short: 'Build any position, check it’s legal, then play it out against Stockfish at six strengths, or watch it play itself.',
    ticks: ['Click, drag or paint pieces onto the board', 'Tells you what makes a position illegal', 'Six Stockfish strengths, Beginner to Maximum'],
    points: [
      ['Click, drag, paint', 'Pick a piece and click or drag across squares to place it. Right-click empties a square; drag a piece off to remove it.'],
      ['Legal, or why not', 'It says what’s wrong: a missing king, pawns on the back rank, the side not to move in check.'],
      ['Side to move and castling', 'Choose who’s to move, and only the castling rights the king and rook allow.'],
      ['Six strengths', 'Beginner, Casual, Intermediate, Advanced, Expert and Maximum.'],
      ['Watch or play', 'Stockfish against itself (slow, normal or fast), or against you, with its lines hidden and a Take back button.'],
      ['Into the move tree', 'Every move goes into the tree like any other, so you can analyse the game afterwards.'],
    ],
    steps: [['Set it up', 'Place pieces, pick who moves.'], ['Analyze or play', 'Analyze shows Stockfish’s best move; Play starts a game.'], ['Review', 'Step back through the moves and try others.']],
  },
];

/** "Try every *line.*" -> plain text, for titles and section headings. */
export const plain = (title: string) => title.replace(/\*/g, '').replace(/\.$/, '');
