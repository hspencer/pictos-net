/**
 * Re-encodes a stored audio data URL to audio/mp4 (AAC) using
 * Web Audio API + MediaRecorder. No dependencies.
 *
 * Must run in a browser that can both:
 *  - decode the source codec (e.g. Chrome can decode webm/opus)
 *  - encode to audio/mp4 (Chrome 96+, Safari)
 *
 * Returns the original data URL unchanged when:
 *  - already audio/mp4
 *  - audio/mp4 encoding is not supported on this browser
 *  - decoding fails
 */
export async function convertAudioToMp4(dataUrl: string): Promise<string> {
  if (!dataUrl || dataUrl.startsWith('data:audio/mp4')) return dataUrl;

  const mimeType = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4']
    .find(m => MediaRecorder.isTypeSupported(m));
  if (!mimeType) return dataUrl;

  const arrayBuffer = await fetch(dataUrl).then(r => r.arrayBuffer());
  const audioCtx = new AudioContext();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch {
    await audioCtx.close();
    return dataUrl;
  }

  const dest = audioCtx.createMediaStreamDestination();
  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(dest);

  return new Promise((resolve) => {
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(dest.stream, { mimeType });
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      audioCtx.close();
      const blob = new Blob(chunks, { type: mimeType });
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(dataUrl); // fallback: keep original
      reader.readAsDataURL(blob);
    };
    source.onended = () => recorder.stop();
    recorder.start();
    source.start();
  });
}
