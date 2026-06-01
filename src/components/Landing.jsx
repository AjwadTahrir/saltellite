import { useState } from "react";
import LiquidEther from "./LiquidEther";   // official React Bits component
import SplitText from "./SplitText";
import SpotlightCard from "./SpotlightCard";
import "./Landing.css";

/**
 * Landing intro for SALTellite.
 *
 * IMPORTANT: LIQUID_COLORS is defined OUTSIDE the component so its array
 * reference stays stable across renders. If it were inline, LiquidEther's
 * effect (which depends on `colors`) would re-init the WebGL context every
 * render — that was the "liquid keeps refreshing / doesn't stay" bug.
 */
const LIQUID_COLORS = ["#06b6d4", "#22d3ee", "#0891b2"];

export default function Landing({ onEnter }) {
  const [leaving, setLeaving] = useState(false);

  const enter = () => {
    setLeaving(true);
    setTimeout(() => onEnter?.(), 650); // let the fade-out play
  };

  return (
    <div className={`landing ${leaving ? "landing--leaving" : ""}`}>
      <div className="landing__bg">
        <LiquidEther
          colors={LIQUID_COLORS}
          mouseForce={22}
          cursorSize={100}
          isViscous={false}
          resolution={0.5}
          autoDemo={true}
          autoSpeed={0.5}
          autoIntensity={2.4}
          autoResumeDelay={1500}
          style={{ width: "100%", height: "100%" }}
        />
      </div>

      {/* soft veil keeps the title readable over the fluid */}
      <div className="landing__veil" />

      <div className="landing__content">
        <h1 className="landing__title">
          <SplitText text="SALTellite" delay={300} stagger={60} />
        </h1>

        <p className="landing__tag landing__fade" style={{ animationDelay: "1150ms" }}>
          Protecting coastal yields with AI and satellite intelligence.
        </p>

        <div className="landing__fade" style={{ animationDelay: "1350ms", marginTop: "2rem" }}>
          <SpotlightCard onClick={enter} />
        </div>
      </div>
    </div>
  );
}