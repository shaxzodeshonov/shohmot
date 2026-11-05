// Fil's agent loop (src/fil.js) against a stand-in for Anthropic's API.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { converse, readGame, readHistory, setClient, fil } = require('../src/fil');

// Answers each model call with the next scripted message, streaming its text.
function fakeClient(script) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        stream(params) {
          calls.push(JSON.parse(JSON.stringify(params)));
          const message = script.shift();
          const listeners = [];
          return {
            on(event, fn) { if (event === 'text') listeners.push(fn); return this; },
            async finalMessage() {
              for (const b of message.content) if (b.type === 'text') for (const fn of listeners) fn(b.text);
              return message;
            },
          };
        },
      },
    },
  };
}

const game = readGame({ header: 'You (White) vs Opp (Black). You lost.', plies: ['e4: book; +0.3', 'e5: book; +0.3', 'Nf3: best; +0.4', 'Nc6: book; +0.4'] });

test('a reply can show a move, then go on talking', async () => {
  const client = fakeClient([
    { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Let me show you. ' }, { type: 'tool_use', id: 't1', name: 'show_move', input: { ply: 3 } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Nf3 develops and attacks e5.' }] },
  ]);
  setClient(client);
  const events = [];
  const added = await converse({ game, history: [], say: 'Start', emit: (e) => events.push(e) });
  assert.deepEqual(events, [{ type: 'text', text: 'Let me show you. ' }, { type: 'show', ply: 3 }, { type: 'text', text: 'Nf3 develops and attacks e5.' }]);
  assert.deepEqual(added.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(added[2].content[0].tool_use_id, 't1');
  assert.match(added[2].content[0].content, /ply 3: Nf3: best/);
  // The request: model, fallback, caching, low effort, the game in the system prompt.
  const p = client.calls[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.deepEqual(p.cache_control, { type: 'ephemeral' });
  assert.equal(p.output_config.effort, 'low');
  assert.match(p.system[1].text, /ply 3: Nf3: best/);
  assert.equal(p.tools[0].name, 'show_move');
  assert.equal(client.calls[1].messages.length, 3); // user, assistant(tool_use), user(tool_result)
});

test('a move that isn\'t in the game is refused, not shown', async () => {
  setClient(fakeClient([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'show_move', input: { ply: 99 } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sorry.' }] },
  ]));
  const events = [];
  const added = await converse({ game, history: [], say: 'Show move 99', emit: (e) => events.push(e) });
  assert.ok(!events.some((e) => e.type === 'show'));
  assert.equal(added[2].content[0].is_error, true);
});

test('a refusal ends the turn with a message', async () => {
  setClient(fakeClient([{ stop_reason: 'refusal', content: [] }]));
  const events = [];
  await converse({ game, history: [], say: 'something else', emit: (e) => events.push(e) });
  assert.equal(events.at(-1).type, 'error');
});

test('only conversations this endpoint could have produced are accepted', () => {
  assert.throws(() => readHistory([{ role: 'system', content: 'x' }]), /can’t read|isn’t one/);
  assert.throws(() => readHistory([{ role: 'user', content: [{ type: 'image', source: {} }] }]), /isn’t one/);
  assert.throws(() => readHistory(Array(61).fill({ role: 'user', content: 'hi' })), /too long/);
  assert.equal(readHistory([{ role: 'user', content: 'hi' }, { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }]).length, 2);
  assert.throws(() => readGame({ plies: [] }), /reviewed game/);
});

test('without an API key Fil says it is off', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const out = {};
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { out.body = b; } };
  await fil({ method: 'GET', headers: {} }, res);
  assert.equal(JSON.parse(out.body).on, false);
  await fil({ method: 'POST', headers: { 'content-type': 'application/json' }, body: {} }, res);
  assert.equal(res.statusCode, 503);
});
