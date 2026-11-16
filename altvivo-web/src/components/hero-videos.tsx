"use client";

import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

/*
 * Promo videos for the flagship apps, shown in the hero.
 * Drop the files into public/videos/ with these names (MP4, H.264, 16:9 works everywhere).
 * An optional poster image (same name, .jpg) is shown before playback starts.
 * Until a file exists, that tab shows `fallback` instead, so the hero never renders a broken player.
 */
const VIDEOS = [
  { id: "xprism", name: "XPRISM", tagline: "Virtual pharmacology lab", src: "/videos/xprism-promo.mp4", poster: "/videos/xprism-promo.jpg" },
  { id: "amaze", name: "aMaze", tagline: "Computer-vision behaviour analytics", src: "/videos/amaze-promo.mp4", poster: "/videos/amaze-promo.jpg" },
] as const;

type VideoId = (typeof VIDEOS)[number]["id"];

export function HeroVideos({ fallback }: { fallback: ReactNode }) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<VideoId>(VIDEOS[0].id);
  const [missing, setMissing] = useState<Record<string, boolean>>({});
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  const video = VIDEOS.find((v) => v.id === active)!;

  // Autoplay (muted) on tab change unless the visitor prefers reduced motion.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The server-rendered <video> can fail (e.g. 404) before React attaches onError.
    if (el.error) {
      setMissing((m) => ({ ...m, [active]: true }));
      return;
    }
    if (reduce) return;
    el.play().catch(() => setPlaying(false));
  }, [active, reduce]);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  };

  return (
    <div className="glow relative overflow-hidden rounded-2xl border border-line bg-surface/90 backdrop-blur">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <div role="tablist" aria-label="Product videos" className="flex gap-1">
          {VIDEOS.map((v) => (
            <button
              key={v.id}
              role="tab"
              type="button"
              aria-selected={v.id === active}
              aria-controls="hero-video-panel"
              onClick={() => setActive(v.id)}
              className={cx(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                v.id === active ? "bg-accent/15 text-accent-ink" : "text-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              {v.name}
            </button>
          ))}
        </div>
        <span className="readout hidden truncate text-[11px] text-subtle sm:block">{video.tagline}</span>
      </div>

      <div id="hero-video-panel" role="tabpanel" aria-label={`${video.name} promo video`}>
        {missing[video.id] ? (
          <div className="[&>*]:rounded-none [&>*]:border-0">{fallback}</div>
        ) : (
          <div className="relative aspect-video bg-black">
            <video
              key={video.id}
              ref={ref}
              src={video.src}
              poster={video.poster}
              muted={muted}
              loop
              playsInline
              preload="metadata"
              aria-label={`${video.name} promo video`}
              className="size-full object-cover"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => setMissing((m) => ({ ...m, [video.id]: true }))}
              onClick={toggle}
            />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-3 pt-10">
              <button
                type="button"
                onClick={toggle}
                aria-label={playing ? "Pause video" : "Play video"}
                className="grid size-9 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
              >
                {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4 translate-x-px" aria-hidden />}
              </button>
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? "Unmute video" : "Mute video"}
                className="grid size-9 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
              >
                {muted ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
