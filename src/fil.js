// Fischer, the review's coach, as an AI agent (Claude, through Anthropic's API).
//
//   GET  /api/fil  -> { on }   whether Fischer can talk (ANTHROPIC_API_KEY is set)
//   POST /api/fil  { game, messages, say } -> a stream of server-sent events:
//        { type: 'text', text }        Fischer's words, as they're written
//        { type: 'show', ply }         put the board on this move (Fischer's show_move tool)
//        { type: 'done', messages }    the turns to keep and send back next time
//        { type: 'error', message }
//
// Fischer only knows the game through what the review page sends: Stockfish's
// verdict on every move (label, evaluation, best line, what went wrong). The
// instructions tell it to teach from those facts and not to invent analysis.
// Nothing is stored here; the page keeps the conversation.
//
// Settings: ANTHROPIC_API_KEY (Fischer is off without it), FIL_MODEL (default
// claude-opus-5-5), FIL_DAILY_LIMIT (messages a day for the whole site,
// default 2000), FIL_HOURLY_LIMIT (per visitor, default 40).
const { HttpError, send, handler, readJson, clientIp } = require('./auth');
const { store } = require('./store');

const MODEL = () => process.env.FIL_MODEL || 'claude-opus-5-5';
const on = () => !!process.env.ANTHROPIC_API_KEY;

let client = null;
function api() {
  if (!client) {
    const { default: Anthropic } = require('@anthropic-ai/sdk');
    client = new Anthropic();
  }
  return client;
}
// Tests swap in a stand-in.
function setClient(c) { client = c; }

// ---------- what Fischer is told ----------
const PERSONA = `You are Fischer, the chess coach on Shohmot, a free site for Chess.com and Lichess players. You are going through one game with the player who played it. In the facts below, "you" is the player and "your opponent" is the other side.

Your character: a fierce, single-minded competitor in the mould of a 1970s world champion. Chess is a fight to you, not a pastime. You play to win, you have no time for timid moves or cheap draws, and to you the best feeling in chess is beating a strong opponent and breaking his confidence, until he no longer believes he can hold the position. On the board you care about one thing: the best move. You are blunt and completely sure of yourself, with a dry, cutting wit, and you talk in short, punchy sentences. You don't pad with praise: a bad move is bad and you say why; a strong move gets a plain "Good. That's chess." You push the player to be tougher: calculate, concentrate, take the initiative, punish every slip. You are hard on the moves, never on the person: no insults, no swearing, no mocking. Under it all you want them to win.

You are Shohmot's own coach character, not a real person: if asked, say you're Shohmot's coach, not the real Bobby Fischer. Don't quote him, claim his life or games as yours, or speak for him or any other real player. Keep to chess: no politics, religion or remarks about groups of people.

How to coach:
- Teach, don't just report. For each moment: what happened, why it mattered, the better move, and a lesson the player can use in their next game.
- Before you explain a moment, use the show_move tool to put the board on it. One moment at a time.
- Keep each reply short: two to five sentences, under about 90 words. It is shown in a narrow panel and may be read aloud, so no headings, lists, tables or markdown. Write moves with their numbers, like 14...Nxe4.
- When you lead the review (the player says "start" or "go on"), take the key moments in game order: how the opening went, the player's mistakes and blunders, their best moves, and the opponent's slips they could have punished. Show one moment per reply and end by inviting them to go on. After the last moment, give one or two things to work on.
- When the player asks something, answer it directly, then offer to carry on.

Facts:
- Everything you know about the game is Stockfish's review below: move labels, evaluations, best moves and lines, and the reason a move went wrong. Only state evaluations, best moves and tactics that appear there. You can't see the board, so don't describe where pieces stand or invent tactics; when you're not sure why a move is better, say what Stockfish prefers rather than guessing.
- Evaluations are in pawns from White's side: +1.0 means White is a pawn up, M3 means mate in 3.
- If asked about something other than this game or improving at chess, say flatly that you're here for chess and steer back.

Latency-sensitive; begin your visible answer immediately.`;

const TOOLS = [{
  name: 'show_move',
  description: 'Put the board on the position right after the given half-move (ply), so the player sees the moment you are about to explain. Ply 1 is White\'s first move, ply 2 Black\'s reply, and so on; ply 0 is the starting position. Use the ply numbers from the move list in the game facts.',
  input_schema: {
    type: 'object',
    properties: { ply: { type: 'integer', minimum: 0, description: 'The half-move to show.' } },
    required: ['ply'],
    additionalProperties: false,
  },
  eager_input_streaming: true,
}];

// ---------- what the page sends ----------
const MAX_FACTS = 400; // plies
const MAX_FACT_CHARS = 400;
const MAX_HEADER_CHARS = 1500;
const MAX_HISTORY = 60; // messages
const MAX_HISTORY_CHARS = 150000;
const MAX_SAY = 600;
const BLOCKS = new Set(['text', 'tool_use', 'tool_result', 'thinking', 'redacted_thinking']);

const clip = (s, n) => String(s ?? '').slice(0, n);

// { header, plies: [fact for ply 1, ply 2, ...] } -> the facts Fischer reads.
function readGame(game) {
  if (!game || typeof game !== 'object' || !Array.isArray(game.plies) || !game.plies.length) throw new HttpError(400, 'Send the reviewed game.');
  const plies = game.plies.slice(0, MAX_FACTS).map((p) => clip(p, MAX_FACT_CHARS).replace(/\s+/g, ' ').trim());
  const header = clip(game.header, MAX_HEADER_CHARS).trim();
  const text = `The game, as Stockfish reviewed it in the player's browser:\n${header}\n\nMoves (ply number: move, who played it, label; then evaluation after it; and when it wasn't the best, the better move and Stockfish's line):\n${plies.map((p, i) => `ply ${i + 1}: ${p}`).join('\n')}`;
  return { text, plies };
}

// The conversation so far, as the page kept it. Only the shapes this endpoint
// produces get through.
function readHistory(messages) {
  if (messages == null) return [];
  if (!Array.isArray(messages) || messages.length > MAX_HISTORY) throw new HttpError(400, 'That conversation is too long. Start a new one.');
  if (JSON.stringify(messages).length > MAX_HISTORY_CHARS) throw new HttpError(400, 'That conversation is too long. Start a new one.');
  return messages.map((m) => {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) throw new HttpError(400, 'That conversation isn’t one Fischer can read.');
    if (typeof m.content === 'string') return { role: m.role, content: m.content };
    if (!Array.isArray(m.content) || !m.content.every((b) => b && BLOCKS.has(b.type))) throw new HttpError(400, 'That conversation isn’t one Fischer can read.');
    return { role: m.role, content: m.content };
  });
}

// ---------- limits ----------
// Each message costs money, so each visitor gets an hourly budget and the
// whole site a daily one. Without a database the counts are per server
// instance, which still stops a runaway loop.
const local = new Map();
async function count(key, windowSec) {
  try {
    return await store.incr(key, windowSec);
  } catch {
    const now = Date.now();
    const hit = local.get(key);
    if (!hit || hit.until < now) { local.set(key, { n: 1, until: now + windowSec * 1000 }); return 1; }
    return ++hit.n;
  }
}
async function checkLimits(req) {
  const perHour = Number(process.env.FIL_HOURLY_LIMIT) || 40;
  const perDay = Number(process.env.FIL_DAILY_LIMIT) || 2000;
  if ((await count(`rl:fil:${clientIp(req)}`, 3600)) > perHour) throw new HttpError(429, 'Fischer needs a breather: that’s a lot of questions for one hour. Try again a little later.');
  if ((await count(`rl:fil-day:${new Date().toISOString().slice(0, 10)}`, 86400)) > perDay) throw new HttpError(429, 'Fischer has coached so many games today that it’s resting until tomorrow. The move-by-move notes still work.');
}

// ---------- one turn ----------
const MAX_STEPS = 4; // model calls per message: a reply can show a move, then go on talking

// Sends events as they happen; returns the new turns.
async function converse({ game, history, say, emit }) {
  const messages = [...history, { role: 'user', content: say }];
  const added = [messages[messages.length - 1]];
  let retried = false;
  for (let step = 0; step < MAX_STEPS; step++) {
    const stream = api().beta.messages.stream({
      model: MODEL(),
      max_tokens: 2048, // replies are a few sentences; this caps the cost of a runaway one
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // if the model declines, Anthropic's recommended fallback model answers
      output_config: { effort: 'low' }, // chat: quick replies
      cache_control: { type: 'ephemeral' }, // the instructions, the game and the conversation so far
      system: [{ type: 'text', text: PERSONA }, { type: 'text', text: game.text }],
      tools: TOOLS,
      messages,
    });
    stream.on('text', (text) => emit({ type: 'text', text }));
    let message;
    try {
      message = await stream.finalMessage();
    } catch (err) {
      // A tool input that streamed in as unreadable JSON: ask once more. API errors go up.
      const { default: Anthropic } = require('@anthropic-ai/sdk');
      if (err instanceof Anthropic.APIError || retried) throw err;
      retried = true;
      step--;
      continue;
    }

    // After a fallback, only the text before the switch carries on (the
    // declined model's other blocks are dropped when echoed back).
    let content = message.content;
    const lastFallback = content.map((b) => b.type).lastIndexOf('fallback');
    if (lastFallback >= 0) content = [...content.slice(0, lastFallback).filter((b) => b.type === 'text'), ...content.slice(lastFallback + 1)];
    const turn = { role: 'assistant', content };
    messages.push(turn);
    added.push(turn);

    if (message.stop_reason === 'refusal') {
      emit({ type: 'error', message: 'Fischer can’t help with that one. Ask about the game instead.' });
      break;
    }
    const calls = content.filter((b) => b.type === 'tool_use');
    if (!calls.length) break;
    // A tool call cut off by the length cap may be incomplete: don't act on it.
    if (message.stop_reason === 'max_tokens') { messages.pop(); added.pop(); break; }

    const results = calls.map((call) => {
      const ply = call.input && call.input.ply;
      if (call.name !== 'show_move' || !Number.isInteger(ply) || ply < 0 || ply > game.plies.length) {
        return { type: 'tool_result', tool_use_id: call.id, is_error: true, content: `Use a ply from 0 to ${game.plies.length}.` };
      }
      emit({ type: 'show', ply });
      return { type: 'tool_result', tool_use_id: call.id, content: ply === 0 ? 'The board shows the starting position.' : `The board now shows ply ${ply}: ${game.plies[ply - 1]}` };
    });
    const back = { role: 'user', content: results };
    messages.push(back);
    added.push(back);
  }
  return added;
}

// ---------- the route ----------
const fil = handler(async (req, res) => {
  if (req.method === 'GET' || req.method === 'HEAD') return send(res, 200, { on: on(), model: on() ? MODEL() : null });
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  if (!on()) throw new HttpError(503, 'Fischer’s AI coaching isn’t switched on for this site.');
  const body = await readJson(req);
  const game = readGame(body.game);
  const history = readHistory(body.messages);
  const say = clip(body.say, MAX_SAY).trim();
  if (!say) throw new HttpError(400, 'Say something to Fischer first.');
  await checkLimits(req);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  const emit = (event) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`); };
  try {
    const added = await converse({ game, history, say, emit });
    emit({ type: 'done', messages: added });
  } catch (err) {
    emit({ type: 'error', message: errorMessage(err) });
  }
  res.end();
});

function errorMessage(err) {
  const { default: Anthropic } = require('@anthropic-ai/sdk');
  if (err instanceof Anthropic.RateLimitError) return 'Fischer is busy right now. Try again in a minute.';
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    console.error('Fischer: the Anthropic API key was refused.', err.message);
    return 'Fischer isn’t set up correctly on this site.';
  }
  if (err instanceof Anthropic.BadRequestError) {
    console.error('Fischer: request refused.', err.message);
    return 'Fischer couldn’t follow that conversation. Start a new one.';
  }
  if (err instanceof Anthropic.APIError) {
    console.error('Fischer: API error.', err.status, err.message);
    return 'Fischer couldn’t answer just now. Try again in a moment.';
  }
  console.error('Fischer:', err);
  return 'Fischer couldn’t answer just now. Try again in a moment.';
}

module.exports = { fil, converse, readGame, readHistory, setClient, PERSONA, TOOLS };
