"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-voice.element";
import type * as ElementModule from "@/components/lumesec/px-voice.element";

/** The `<px-voice>` element, with its properties and methods. */
export type PxVoiceElement = ElementModule.Voice;

export interface PxVoiceProps extends Omit<LumesecElementProps<PxVoiceElement>, "text" | "onTranscript"> {
  /** The sentence the simulated recognition types out, split on whitespace. Read each time listening starts. Default: `Make the trail grow out of the thumb toward the left and stop at three quarters of the track.`. */
  text?: string;
  /** Fires when listening stops, with the words recognised so far joined by spaces. */
  onTranscript?: (event: ElementModule.VoiceEventMap["transcript"]) => void;
}

/**
 * Voice input · `<px-voice>` · LumeSec Elements, Pixel Lab.
 * Simulated dictation control with a mirrored pixel spectrum and words that fade into focus; stopping collapses the bars to a point.
 *
 * Demo data: No microphone is used and the audio levels are generated; only the transcript can be set with `text`. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/voice
 */
export function PxVoice({ text, onTranscript, ...props }: PxVoiceProps) {
  return useLumesecElement("px-voice", props, { text: text }, { transcript: onTranscript });
}
