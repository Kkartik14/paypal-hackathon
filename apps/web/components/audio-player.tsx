"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "./icons";
import { formatSeconds } from "@/lib/format";

const BARS = [
  8, 16, 24, 13, 31, 22, 9, 27, 18, 34, 20, 12, 29, 16, 25, 10, 21, 33, 15, 26, 11, 30, 19, 14,
  28, 23, 8, 32, 17, 24, 12, 27, 20, 10, 25, 16, 29, 13, 22, 8,
];

export function AudioPlayer({ src, label }: { src: string; label?: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const barRef = useRef<HTMLButtonElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setFailed(false);
  }, [src]);

  const toggle = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setFailed(true);
      }
    } else {
      audio.pause();
    }
  }, []);

  const seek = (event: React.MouseEvent<HTMLButtonElement>) => {
    const audio = audioRef.current;
    const bar = barRef.current;
    if (!audio || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    setCurrent(audio.currentTime);
  };

  const progress = duration > 0 ? current / duration : 0;

  return (
    <div className="audio-player">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        className="audio-play"
        onClick={toggle}
        aria-label={playing ? `Pause ${label ?? "audio"}` : `Play ${label ?? "audio"}`}
        disabled={failed}
      >
        {playing ? <Pause width={16} height={16} /> : <Play width={16} height={16} />}
      </button>
      <button
        ref={barRef}
        type="button"
        className="waveform"
        onClick={seek}
        aria-label="Seek audio"
        disabled={failed}
      >
        {BARS.map((height, index) => (
          <span
            key={`${height}-${index}`}
            className={`wave-bar ${index / BARS.length <= progress ? "is-played" : ""}`}
            style={{ height }}
          />
        ))}
      </button>
      <span className="audio-time">
        {failed ? "audio unavailable" : `${formatSeconds(current)} / ${formatSeconds(duration)}`}
      </span>
    </div>
  );
}
