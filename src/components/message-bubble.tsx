"use client";

import { useEffect, useState } from "react";

/** Typewriter pacing: at least ~120 characters a second, and never more than ~20 frames behind. */
const MIN_CHARS_PER_FRAME = 2;
const CATCH_UP_FRAMES = 20;

export function Bubble({ role, text, children }: { role: "user" | "assistant"; text: string; children?: React.ReactNode }) {
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <p
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
          mine ? "rounded-br-sm bg-emerald-600 text-white" : "rounded-bl-sm bg-white shadow-sm dark:bg-stone-900"
        }`}
      >
        {text}
        {children}
      </p>
    </div>
  );
}

/** A finished reply, typed out on screen; onTyped fires once all of it is showing. */
export function TypingBubble({ text, onTyped }: { text: string; onTyped: () => void }) {
  const shown = useTypewriter(text);
  const typed = shown.length === text.length;

  useEffect(() => {
    if (typed) onTyped();
  }, [typed, onTyped]);

  return (
    <Bubble role="assistant" text={shown}>
      {typed ? null : <span className="caret ml-0.5 text-emerald-600">▍</span>}
    </Bubble>
  );
}

/**
 * Reveals `target` a few characters per animation frame, faster the further behind it is. The reply
 * arrives all at once when the turn ends; typing it out reads more like a text than a page load.
 */
function useTypewriter(target: string): string {
  const [length, setLength] = useState(0);
  const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (reduceMotion || length >= target.length) return;
    const frame = requestAnimationFrame(() => {
      const remaining = target.length - length;
      setLength(length + Math.max(MIN_CHARS_PER_FRAME, Math.ceil(remaining / CATCH_UP_FRAMES)));
    });
    return () => cancelAnimationFrame(frame);
  }, [length, target, reduceMotion]);

  return reduceMotion ? target : target.slice(0, length);
}
