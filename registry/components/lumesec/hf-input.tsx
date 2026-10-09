"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-input.element";
import type * as ElementModule from "@/components/lumesec/hf-input.element";

/** The `<hf-input>` element, with its properties and methods. */
export type HfInputElement = ElementModule.HInput;

export interface HfInputProps extends Omit<
  LumesecElementProps<HfInputElement>,
  | "label"
  | "value"
  | "hint"
  | "error"
  | "success"
  | "name"
  | "type"
  | "placeholder"
  | "required"
  | "pattern"
  | "minlength"
  | "maxlength"
  | "autocomplete"
  | "inputmode"
  | "spellcheck"
  | "disabled"
  | "onInput"
  | "onChange"
> {
  /** Visible label, linked to the inner input. Hidden when absent. */
  label?: string;
  /** Initial value, also restored on form reset. Not observed; use the `value` property to change the text. */
  value?: string;
  /** Text under the field when there is no error. */
  hint?: string;
  /** Message shown, and used as the validation message, when the value is invalid. Defaults to the browser `validationMessage`. */
  error?: string;
  /** Message shown when a valid value is committed on blur. Falls back to `hint`. */
  success?: string;
  /** Form field name. */
  name?: string;
  /** Passed to the inner `<input>`, for example `email`, `url` or `password`. */
  type?: string;
  /** Passed to the inner input. */
  placeholder?: string;
  /** Presence attribute, passed to the inner input. Default: `false`. */
  required?: boolean;
  /** Passed to the inner input. */
  pattern?: string;
  /** Passed to the inner input. */
  minlength?: number;
  /** Passed to the inner input. */
  maxlength?: number;
  /** Passed to the inner input. */
  autocomplete?: string;
  /** Passed to the inner input. */
  inputmode?: string;
  /** Passed to the inner input. */
  spellcheck?: string;
  /** Presence attribute. Disables the inner input; a disabled ancestor `<fieldset>` does the same. A disabled field is not submitted. Default: `false`. */
  disabled?: boolean;
  /** Fires on every edit. */
  onInput?: (event: ElementModule.HInputEventMap["input"]) => void;
  /** Fires when the inner input commits a change, on blur after editing. */
  onChange?: (event: ElementModule.HInputEventMap["change"]) => void;
}

/**
 * Text field · `<hf-input>` · LumeSec Elements, Pixel HD.
 * Form-associated text field with a comet of light on the border while focused; invalid values turn the border to static.
 * @see https://elements.lumesec.ai/components/pixel-hd/input
 */
export function HfInput({
  label,
  value,
  hint,
  error,
  success,
  name,
  type,
  placeholder,
  required,
  pattern,
  minlength,
  maxlength,
  autocomplete,
  inputmode,
  spellcheck,
  disabled,
  onInput,
  onChange,
  ...props
}: HfInputProps) {
  return useLumesecElement(
    "hf-input",
    props,
    {
      label: label,
      value: value,
      hint: hint,
      error: error,
      success: success,
      name: name,
      type: type,
      placeholder: placeholder,
      required: required,
      pattern: pattern,
      minlength: minlength,
      maxlength: maxlength,
      autocomplete: autocomplete,
      inputmode: inputmode,
      spellcheck: spellcheck,
      disabled: disabled,
    },
    { input: onInput, change: onChange },
  );
}
