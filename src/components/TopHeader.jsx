import { useState } from "react";
import { motion } from "framer-motion";
import "./TopHeader.css";

/**
 * TopHeader — "Magnetic Pill Glide" navigation (nav only).
 *
 * Renders just the centered nav now; it's placed inside the main .header bar
 * (single-line SaaS header), so it no longer draws its own header background.
 */

const NAV_ITEMS = ["Dashboard", "Analytics", "AI Insights", "Fields"];

export default function TopHeader({ initialActiveIndex = 0, onChange }) {
  const [active, setActive] = useState(initialActiveIndex);

  return (
    <nav className="th-nav">
      {NAV_ITEMS.map((label, i) => {
        const isActive = i === active;
        return (
          <button
            key={label}
            className={`th-item ${isActive ? "th-item--active" : ""}`}
            onClick={() => {
              setActive(i);
              onChange?.(i, label);
            }}
          >
            {isActive && (
              <motion.span
                layoutId="nav-pill"
                className="th-pill"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="th-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}