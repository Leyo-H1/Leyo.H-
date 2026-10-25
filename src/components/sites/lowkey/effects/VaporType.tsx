import type { CSSProperties } from "react";
import styles from "./VaporType.module.css";

interface VaporTypeProps {
  text: string;
  className?: string;
  active?: boolean;
  delayMs?: number;
}

/**
 * Local vapor-style reveal. The requested React Bits Pro registry requires a
 * Starter+ license and is not configured in this project. This is an independent
 * fallback, not the licensed component's source. Official installation reference:
 * https://pro.reactbits.dev/docs/installation
 */
export function VaporType({ text, className = "", active = true, delayMs = 0 }: VaporTypeProps) {
  return (
    <span
      className={`${styles.root} ${className}`}
      aria-label={text}
      data-active={active ? "true" : "false"}
      style={{ "--vapor-delay": `${delayMs}ms` } as CSSProperties}
    >
      {Array.from(text).map((character, index) => (
        <span
          key={`${character}-${index}`}
          aria-hidden="true"
          className={styles.character}
          style={{ "--vapor-index": index } as CSSProperties}
        >
          {character === " " ? "\u00a0" : character}
        </span>
      ))}
    </span>
  );
}
