"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/** Fades content up once when it scrolls into view; static for reduced-motion users. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Draws an SVG path from start to end (used by the hero instrument readout). */
export function DrawPath({ d, className, delay = 0 }: { d: string; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <path d={d} className={className} />;
  return (
    <motion.path
      d={d}
      className={className}
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: 1.6, delay, ease: "easeInOut" }}
    />
  );
}
