export const MAX_AUDIO_BYTES = 3 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  webm: "audio/webm",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

export interface AudioPayload {
  base64: string;
  mimeType: string;
}

export async function fileToAudioPayload(file: File): Promise<AudioPayload> {
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error("Audio must be 3 MB or smaller. Use a shorter clip or the transcript.");
  }
  const buffer = await file.arrayBuffer();
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = file.type || MIME_BY_EXTENSION[extension] || "audio/mp4";
  return { base64: bytesToBase64(new Uint8Array(buffer)), mimeType };
}

export async function fetchScenarioAudio(url: string): Promise<AudioPayload | null> {
  try {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size > MAX_AUDIO_BYTES) return null;
    const buffer = await blob.arrayBuffer();
    return {
      base64: bytesToBase64(new Uint8Array(buffer)),
      mimeType: blob.type || "audio/mp4",
    };
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return window.btoa(binary);
}
