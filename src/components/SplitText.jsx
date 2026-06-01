import { useState, useEffect } from "react";

/**
 * SplitText — per-character staggered entrance (React Bits style, CSS-only).
 * No GSAP dependency.
 *
 * Props:
 *   text     string   the text to animate
 *   delay    number   ms before the first char animates in   (default 0)
 *   stagger  number   ms between each char                    (default 50)
 *   className/style    passed to the wrapper <span>
 */
export default function SplitText({
  text = "",
  delay = 0,
  stagger = 50,
  className = "",
  style = {},
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  return (
    <span
      className={className}
      style={{ display: "inline-block", ...style }}
      aria-label={text}
    >
      {text.split("").map((ch, i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{
            display: "inline-block",
            whiteSpace: ch === " " ? "pre" : "normal",
            opacity: mounted ? 1 : 0,
            transform: mounted
              ? "translateY(0) rotate(0deg)"
              : "translateY(28px) rotate(4deg)",
            transition:
              `opacity .55s cubic-bezier(.22,1,.36,1) ${i * stagger}ms,` +
              `transform .55s cubic-bezier(.22,1,.36,1) ${i * stagger}ms`,
          }}
        >
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
    </span>
  );
}
