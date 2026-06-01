import { useRef } from "react";
import { ArrowRight } from "lucide-react";
import "./SpotlightCard.css";

/**
 * SpotlightCard — adapted from React Bits.
 * A clickable navy card that tracks the cursor and renders a teal radial glow.
 * Built in plain CSS (this project doesn't use Tailwind); Tailwind values are
 * translated 1:1 in SpotlightCard.css.
 *
 * Props:
 *   onClick         click handler (makes the whole card actionable)
 *   title           primary text   (default "Access Dashboard")
 *   subtitle        secondary text (default below)
 *   spotlightColor  glow color     (default oceanic teal)
 */
export default function SpotlightCard({
  onClick,
  title = "Access Dashboard",
  spotlightColor = "rgba(20, 184, 166, 0.4)",
}) {
  const ref = useRef(null);

  const handleMouseMove = (e) => {
    const rect = ref.current.getBoundingClientRect();
    ref.current.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
    ref.current.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
    ref.current.style.setProperty("--spotlight-color", spotlightColor);
  };

  return (
    <button
      ref={ref}
      type="button"
      onMouseMove={handleMouseMove}
      onClick={onClick}
      className="spotlight-card"
    >
      <span className="spotlight-card__text">
        <span className="spotlight-card__title">{title}</span>
      </span>
      <ArrowRight className="spotlight-card__arrow" size={22} strokeWidth={2.2} />
    </button>
  );
}