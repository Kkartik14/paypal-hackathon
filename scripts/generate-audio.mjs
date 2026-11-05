import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Generates the two fictional demo clips with macOS text-to-speech.
 * The resulting m4a files are committed so the demo does not depend on TTS.
 * Transcripts are in fixtures/audio/*.txt and embedded in the API fixtures.
 */
const clips = [
  {
    id: "urgent-support-call",
    voice: "Daniel",
    rate: 172,
    text: "This is Daniel Reed from Meridian Bank account security. Someone tried to move nine hundred dollars from your account this morning. To protect your funds, move nine hundred dollars to our safe protection account today. Use the account details I text you, not the number on your card. Keep this confidential, and don't discuss it with anyone until the review is complete. If you delay, the transfer will go through, and we can't reverse it.",
  },
  {
    id: "trusted-purchase",
    voice: "Samantha",
    rate: 168,
    text: "Hi, this is Kettle and Co. billing with a quick note about your monthly coffee subscription. Your renewal is eighteen dollars for the November roast. This is the same saved payment method and the same amount as last month. No action is needed beyond approving the renewal whenever you're ready. Thanks, and have a good week.",
  },
];

const root = resolve(import.meta.dirname, "..");
const webAudio = resolve(root, "apps/web/public/audio");
const fixtureAudio = resolve(root, "fixtures/audio");
mkdirSync(webAudio, { recursive: true });
mkdirSync(fixtureAudio, { recursive: true });

for (const clip of clips) {
  const textPath = resolve(fixtureAudio, `${clip.id}.txt`);
  const aiffPath = resolve(fixtureAudio, `${clip.id}.aiff`);
  const m4aPath = resolve(fixtureAudio, `${clip.id}.m4a`);
  writeFileSync(textPath, `${clip.text}\n`, "utf8");
  execFileSync("say", ["-v", clip.voice, "-r", String(clip.rate), "-f", textPath, "-o", aiffPath], {
    stdio: "inherit",
  });
  execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-i", aiffPath, "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", m4aPath],
    { stdio: "inherit" },
  );
  execFileSync("cp", [m4aPath, resolve(webAudio, `${clip.id}.m4a`)]);
  execFileSync("rm", [aiffPath]);
  console.log(`generated ${clip.id}.m4a`);
}

console.log(`Audio written to ${webAudio} and ${fixtureAudio}.`);
