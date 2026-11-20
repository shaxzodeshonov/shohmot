// Which of the device's voices the coach gets (web/scripts/review/coach.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickVoice } from '../web/scripts/review/coach.mjs';

const v = (name, lang = 'en-US', localService = true) => ({ name, lang, localService });

test('the coach gets a man’s voice when the device has one', () => {
  const windows = [v('Microsoft Zira - English (United States)'), v('Microsoft David - English (United States)'), v('Microsoft Mark - English (United States)')];
  assert.equal(pickVoice(windows).name, 'Microsoft David - English (United States)');
  const edge = [v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false), v('Microsoft Guy Online (Natural) - English (United States)', 'en-US', false), v('Microsoft Zira - English (United States)')];
  assert.equal(pickVoice(edge).name, 'Microsoft Guy Online (Natural) - English (United States)');
  const chrome = [v('Google US English', 'en-US', false), v('Google UK English Female', 'en-GB', false), v('Google UK English Male', 'en-GB', false)];
  assert.equal(pickVoice(chrome).name, 'Google UK English Male');
  const mac = [v('Samantha'), v('Karen', 'en-AU'), v('Daniel', 'en-GB')];
  assert.equal(pickVoice(mac).name, 'Daniel');
});

test('without a known man’s voice, never a known female one if there is another', () => {
  assert.equal(pickVoice([v('Samantha'), v('English United States')]).name, 'English United States');
  assert.equal(pickVoice([v('Samantha')]).name, 'Samantha'); // the only English voice
  assert.equal(pickVoice([v('Thomas', 'fr-FR')]), null);
});
