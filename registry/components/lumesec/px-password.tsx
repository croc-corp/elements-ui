"use client";

import * as React from "react";

import { clamp, mixRgb } from "@/lib/lumesec/math";
import { prefersReducedMotion } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { RollText } from "@/lib/lumesec/roll-text";
import { useControllableState, useFormReset } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Password strength from 0 (Too weak) to 4 (Strong). */
export type PxPasswordScore = 0 | 1 | 2 | 3 | 4;

/** Props of `PxPassword`. Other `div` props go to the root. */
export interface PxPasswordProps extends Omit<React.ComponentProps<"div">, "children" | "defaultValue" | "onChange"> {
  /** Controlled password. Use with `onValueChange`. */
  value?: string;
  /** Initial password when uncontrolled; also restored on form reset. */
  defaultValue?: string;
  /** Called with the new password on every edit. */
  onValueChange?: (value: string) => void;
  /** Called when an edit changes the strength score, with the new score. */
  onScoreChange?: (score: PxPasswordScore) => void;
  /** Called when the input commits a change (on blur after editing), with the password and its score. */
  onValueCommit?: (value: string, score: PxPasswordScore) => void;
  /** Label text, linked to the input. */
  label?: React.ReactNode;
  /** Form field name. */
  name?: string;
  /** Lowest acceptable score. A weaker password makes the input invalid, which blocks form submission. */
  minScore?: PxPasswordScore;
  /** Dims the field and disables the input and the show/hide button. */
  disabled?: boolean;
}

/** One rule of the checklist, and the test it runs. */
const RULES: readonly [label: string, test: (value: string) => boolean][] = [
  ["8 or more characters", (value) => value.length >= 8],
  ["Upper and lower case", (value) => /[a-z]/.test(value) && /[A-Z]/.test(value)],
  ["A number", (value) => /\d/.test(value)],
  ["A symbol", (value) => /[^A-Za-z0-9]/.test(value)],
];

const WORDS = ["Too weak", "Weak", "Fair", "Good", "Strong"] as const;

/** Keyframes of the checklist bullet pop, with the overshooting ease on each segment like a CSS animation. */
const POP_EASE = "cubic-bezier(.2,1.6,.4,1)";
const POP: Keyframe[] = [
  { transform: "none", easing: POP_EASE },
  { transform: "scale(1.7)", offset: 0.5, easing: POP_EASE },
  { transform: "none" },
];

/**
 * Password field with a four-segment pixel strength meter, a show/hide toggle and a rule checklist.
 * `minScore` makes weaker passwords invalid, so the form will not submit them.
 *
 * @example
 * <PxPassword name="password" label="New password" minScore={3} />
 */
export function PxPassword({
  value: valueProp,
  defaultValue = "",
  onValueChange,
  onScoreChange,
  onValueCommit,
  label = "Password",
  name,
  minScore = 0,
  disabled = false,
  className,
  ...props
}: PxPasswordProps) {
  const inputId = React.useId();
  const rulesId = `${inputId}-rules`;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const bulletRefs = React.useRef<(HTMLElement | null)[]>([]);
  const [value, setValue] = useControllableState({ value: valueProp, defaultValue, onChange: onValueChange });
  const [visible, setVisible] = React.useState(false);
  const score = scorePassword(value);
  const met = RULES.map(([, test]) => test(value));
  const word = value ? WORDS[score] : "Enter a password";

  // the strength word rolls up when the score rises and down when it falls; resets swap it in place
  const [roll, setRoll] = React.useState({ word, score, direction: 1 });
  if (roll.word !== word) setRoll({ word, score, direction: score >= roll.score ? 1 : -1 });
  const [edited, setEdited] = React.useState(false);

  const fill = React.useRef(score / 4);
  // rules met by the initial value are already in place: their bullets do not pop on mount
  const metBefore = React.useRef(met);

  const onCommitRef = React.useRef(onValueCommit);
  React.useEffect(() => {
    onCommitRef.current = onValueCommit;
  });

  const { ref: canvasRef, redraw } = usePixelCanvas(({ clear, dot, palette, width, delta }) => {
    const target = score / 4;
    fill.current = prefersReducedMotion() ? target : fill.current + clamp(target - fill.current, -delta * 2.5, delta * 2.5);
    const columns = Math.floor(width / 4);
    const color = score <= 1 ? palette.destructive : score === 2 ? palette.warning : score === 3 ? palette.accent : palette.success;
    clear();
    for (let column = 0; column < columns; column++) {
      for (let row = 0; row < 2; row++) {
        const u = (column + 0.5) / columns;
        const on = u <= fill.current;
        const edge = on && u > fill.current - 3 / columns;
        // leave a one-column gap between the four segments
        const gap = Math.floor(u * 4) !== Math.floor((u + 1 / columns) * 4) && column < columns - 1;
        if (gap) continue;
        dot(column * 4, row * 4 + 1, on ? mixRgb(color, palette.shine, edge ? 0.5 : 0) : palette.foreground, on ? 0.95 : 0.12, 2.6);
      }
    }
    return Math.abs(fill.current - target) > 0.001;
  });

  React.useEffect(redraw, [score, redraw]);

  // a rule that becomes met pops its bullet
  React.useEffect(() => {
    met.forEach((isMet, index) => {
      const bullet = bulletRefs.current[index];
      if (isMet && !metBefore.current[index] && bullet && !prefersReducedMotion() && typeof bullet.animate === "function") {
        bullet.animate(POP, { duration: 350 });
      }
    });
    metBefore.current = met;
  });

  React.useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.setCustomValidity(score < minScore ? `Choose a stronger password (${WORDS[minScore]} or better)` : "");
  }, [score, minScore]);

  // the native change event (commit on blur) has no React equivalent
  React.useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const commit = () => onCommitRef.current?.(input.value, scorePassword(input.value));
    input.addEventListener("change", commit);
    return () => input.removeEventListener("change", commit);
  }, []);

  useFormReset(inputRef, () => {
    setEdited(false);
    setVisible(false);
    setValue(defaultValue);
  });

  const wordColor = !value
    ? "text-muted-foreground"
    : score <= 1
      ? "text-destructive"
      : score === 2
        ? "text-lumesec-warning"
        : score === 3
          ? "text-lumesec"
          : "text-lumesec-success";

  return (
    <div
      data-slot="px-password"
      data-disabled={disabled ? "" : undefined}
      className={cn("block leading-[1.5] text-foreground", disabled && "pointer-events-none opacity-55", className)}
      {...props}
    >
      <label htmlFor={inputId} className="mb-1.5 block text-[12.5px] font-medium">
        {label}
      </label>
      <div className="relative flex h-[42px] items-center gap-2 rounded-[10px] border border-border bg-card px-3 transition-[border-color,box-shadow] duration-200 ease-[ease] focus-within:border-[color-mix(in_srgb,var(--lumesec)_65%,var(--border))] focus-within:ring-[3px] focus-within:ring-lumesec/14">
        <input
          ref={inputRef}
          id={inputId}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          spellCheck={false}
          disabled={disabled}
          value={value}
          aria-describedby={rulesId}
          onChange={(event) => {
            const next = event.target.value;
            const nextScore = scorePassword(next);
            setEdited(true);
            setValue(next);
            if (nextScore !== score) onScoreChange?.(nextScore);
          }}
          className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 font-[inherit] text-[14px] text-inherit outline-none placeholder:text-muted-foreground placeholder:opacity-75"
        />
        {/* a toggle button keeps one name; aria-pressed carries the state */}
        <button
          type="button"
          disabled={disabled}
          aria-label="Show password"
          aria-pressed={visible}
          aria-controls={inputId}
          onClick={() => setVisible((shown) => !shown)}
          className="grid size-7 flex-none cursor-pointer select-none place-items-center rounded-[7px] border-0 bg-transparent p-0 text-muted-foreground outline-none hover:bg-foreground/7 hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-lumesec"
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <canvas
          ref={canvasRef}
          role="meter"
          aria-label="Password strength"
          aria-valuemin={0}
          aria-valuemax={4}
          aria-valuenow={score}
          aria-valuetext={value ? WORDS[score] : "No password"}
          className="block h-[10px] w-full min-w-0 flex-1 [image-rendering:pixelated]"
        />
        <span className={cn("min-w-[8em] text-right text-[12px] font-medium", wordColor)}>
          <RollText text={word} direction={roll.direction} animate={edited} className="justify-items-end" aria-live="polite" />
        </span>
      </div>
      <ul id={rulesId} className="mt-2.5 mb-0 grid list-none grid-cols-2 gap-x-3 gap-y-[5px] p-0 max-[360px]:grid-cols-1">
        {RULES.map(([rule], index) => (
          <li
            key={rule}
            className={cn(
              "flex items-center gap-2 text-[12.5px] text-muted-foreground transition-colors duration-[250ms] ease-[ease]",
              met[index] && "text-foreground",
            )}
          >
            <span
              ref={(node) => {
                bulletRefs.current[index] = node;
              }}
              aria-hidden="true"
              className={cn(
                "size-2 flex-none rounded-[1.5px] bg-foreground/18 transition-[background-color] duration-[250ms] ease-[ease]",
                met[index] && "bg-lumesec-success",
              )}
            />
            {rule}
            {/* the bullet's colour is the only visual cue, so the state is spelled out for screen readers */}
            <span className="sr-only">{met[index] ? ", met" : ", not met"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 8s2.4-4.6 6.5-4.6S14.5 8 14.5 8s-2.4 4.6-6.5 4.6S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 2.5l11 11M6.6 3.6A6.6 6.6 0 0 1 8 3.4c4.1 0 6.5 4.6 6.5 4.6a11 11 0 0 1-1.9 2.5M4.3 5.2A10.5 10.5 0 0 0 1.5 8s2.4 4.6 6.5 4.6a6.3 6.3 0 0 0 2.6-.6" />
    </svg>
  );
}

/**
 * Score a password: one point each for length, mixed case, a number and a symbol; 12 or more characters
 * with at least three of those score 4.
 */
function scorePassword(value: string): PxPasswordScore {
  if (!value) return 0;
  let score = RULES.filter(([, test]) => test(value)).length;
  if (value.length >= 12 && score >= 3) score = 4;
  return score as PxPasswordScore;
}
