export function createPlayableAudioUrl(source: string): string {
  const comma = source.indexOf(',');
  if (!source.startsWith('data:audio/') || comma < 0 || !source.slice(0, comma).endsWith(';base64')) {
    return source;
  }

  const binary = atob(source.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const mimeType = source.slice(5, comma).replace(/;base64$/, '');
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

export function revokePlayableAudioUrl(source: string, playableUrl: string): void {
  if (playableUrl !== source) URL.revokeObjectURL(playableUrl);
}
