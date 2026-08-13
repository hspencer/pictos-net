import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayableAudioUrl, revokePlayableAudioUrl } from './audioPlayback.ts';

test('turns persisted base64 audio into a revocable Blob URL', async () => {
  const source = 'data:audio/webm;codecs=opus;base64,SG9sYQ==';
  const playableUrl = createPlayableAudioUrl(source);

  assert.match(playableUrl, /^blob:/);
  const blob = await fetch(playableUrl).then(response => response.blob());
  assert.equal(blob.type, 'audio/webm;codecs=opus');
  assert.equal(await blob.text(), 'Hola');

  revokePlayableAudioUrl(source, playableUrl);
});

test('leaves ordinary audio URLs unchanged', () => {
  const source = 'https://example.com/audio.mp3';
  assert.equal(createPlayableAudioUrl(source), source);
});
