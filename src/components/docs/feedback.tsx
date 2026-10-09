"use client";

import * as React from "react";

import { CheckIcon, ThumbDownIcon, ThumbUpIcon } from "@/components/icons";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";

type Stage = "ask" | "note" | "done";

const JSON_HEADERS = { "content-type": "application/json" };

/** Saves the vote and resolves to the token that lets this browser add a note, or null. */
async function saveVote(path: string, helpful: boolean): Promise<string | null> {
  try {
    const response = await fetch("/api/feedback", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ path, helpful }) });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return body && typeof body === "object" && "token" in body && typeof body.token === "string" ? body.token : null;
  } catch {
    return null;
  }
}

/**
 * "Was this page helpful?" The vote is saved as soon as it is clicked; a short note can follow either
 * answer and is attached to the same vote.
 */
export function Feedback({ path, className }: { path: string; className?: string }) {
  const [answer, setAnswer] = React.useState<boolean | null>(null);
  const [stage, setStage] = React.useState<Stage>("ask");
  const [note, setNote] = React.useState("");
  const vote = React.useRef<Promise<string | null> | null>(null);
  const fieldId = React.useId();

  const choose = (helpful: boolean) => {
    if (answer !== null) return;
    setAnswer(helpful);
    setStage("note");
    track("feedback", path, { helpful });
    vote.current = saveVote(path, helpful);
  };

  const sendNote = async () => {
    const text = note.trim();
    setStage("done");
    if (!text) return;
    const token = await vote.current;
    if (!token) return;
    fetch("/api/feedback", { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ token, note: text }) }).catch(() => {});
  };

  const prompt = answer ? "What helped? (optional)" : "What was missing or wrong? (optional)";

  return (
    <div className={className}>
      <p className="mb-2.5 font-mono text-[11px] text-muted-foreground">Was this page helpful?</p>
      {stage === "done" ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground page-enter" role="status">
          <CheckIcon size={14} className="text-success" />
          Thank you. It goes straight to the team.
        </p>
      ) : (
        <>
          <div className="flex gap-1.5">
            {[
              { v: true, label: "Yes", Icon: ThumbUpIcon },
              { v: false, label: "No", Icon: ThumbDownIcon },
            ].map(({ v, label, Icon }) => (
              <button
                key={label}
                type="button"
                aria-pressed={answer === v}
                disabled={answer !== null && answer !== v}
                onClick={() => choose(v)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] transition-colors hover:border-input active:scale-[.97] disabled:opacity-40",
                  answer === v && "border-input bg-muted",
                )}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
          {stage === "note" && (
            <form
              className="mt-3 grid gap-2 page-enter"
              onSubmit={(e) => {
                e.preventDefault();
                void sendNote();
              }}
            >
              <label htmlFor={fieldId} className="text-[12.5px] text-muted-foreground">
                {prompt}
              </label>
              <textarea
                id={fieldId}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={1000}
                className="resize-none rounded-lg border border-border bg-surface/60 px-2.5 py-2 text-[13px] outline-none focus:border-ring"
              />
              <div className="flex items-center gap-2">
                <button type="submit" className="h-8 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
                  {note.trim() ? "Send" : "Done"}
                </button>
                <span className="text-[12px] text-muted-foreground">Your vote is already saved.</span>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
