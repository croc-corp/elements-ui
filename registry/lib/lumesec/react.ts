/**
 * LumeSec Elements · React bindings
 * https://elements.lumesec.ai/docs/react
 *
 * Renders a LumeSec custom element from React 19 and wires its custom events. `useComposedRef` also serves native
 * components that keep a node for themselves and hand it to the caller's `ref`.
 */
import * as React from "react";

/** React's synthetic events that share a name with an element's own custom events; the wrappers type those. */
type ReactEventKeys =
  | "onChange"
  | "onInput"
  | "onSelect"
  | "onToggle"
  | "onError"
  | "onCopy"
  | "onReset"
  | "onSubmit"
  | "onClose"
  | "onLoad";

/** The props every element wrapper takes: standard HTML attributes, a ref to the element, and children. */
export type LumesecElementProps<E extends HTMLElement> = Omit<React.HTMLAttributes<E>, ReactEventKeys> & {
  ref?: React.Ref<E>;
  children?: React.ReactNode;
};

/** Arrays and plain objects (data such as rows or series) are written as JSON. */
type AttrValue = string | number | boolean | null | undefined | readonly unknown[] | Readonly<Record<string, unknown>>;
/** Any typed event handler: a handler for a specific `CustomEvent<T>` is assignable to this. */
type Handler = ((event: CustomEvent<never>) => void) | undefined;

/**
 * Hands the element to a caller's ref and returns how to take it back: the cleanup a React 19 callback ref
 * returned, or a call with null.
 */
function attachRef<E>(ref: React.Ref<E> | undefined, value: E): () => void {
  if (typeof ref === "function") {
    const cleanup = ref(value);
    return typeof cleanup === "function" ? cleanup : () => ref(null);
  }
  if (ref) ref.current = value;
  return () => {
    if (ref) ref.current = null;
  };
}

/**
 * A callback ref that keeps the node in `localRef` for the component's own use and also hands it to the caller's
 * `ref`: an object ref, a callback ref, or a React 19 callback ref that returns a cleanup. Both are cleared when the
 * node detaches. The callback changes only when `ref` does, so React does not detach and re-attach on every render.
 *
 * @example
 * const rootRef = React.useRef<HTMLDivElement>(null);
 * const setRootRef = useComposedRef(rootRef, ref);
 * return <div ref={setRootRef} />;
 */
export function useComposedRef<T>(
  localRef: React.RefObject<T | null>,
  ref: React.Ref<T> | undefined,
): React.RefCallback<T> {
  return React.useCallback(
    (value: T | null) => {
      if (!value) return;
      localRef.current = value;
      const detach = attachRef(ref, value);
      return () => {
        localRef.current = null;
        detach();
      };
    },
    [localRef, ref],
  );
}

/**
 * Renders the custom element `tag` with `props`, `attributes` and `handlers` (keyed by DOM event name).
 *
 * Attributes are always written as attributes, never as properties. React 19 assigns a prop to a same-named
 * element property when one exists, which breaks on read-only properties such as `name` or `form` on
 * form-associated elements. HTML attribute names are case-insensitive, so the keys are passed upper-cased: React
 * finds no such property, calls setAttribute, and the browser stores the lower-case name.
 */
export function useLumesecElement<E extends HTMLElement>(
  tag: string,
  props: LumesecElementProps<E>,
  attributes: Record<string, AttrValue>,
  handlers: Record<string, Handler>,
) {
  const { ref, ...rest } = props;
  const node = React.useRef<E | null>(null);
  const latest = React.useRef(handlers);
  React.useInsertionEffect(() => {
    latest.current = handlers;
  });

  // listeners are bound per event name and call the latest handler, so new handler functions never rebind
  const names = Object.keys(handlers).filter((name) => handlers[name]);
  const key = names.join(" ");
  React.useEffect(() => {
    const el = node.current;
    if (!el || !key) return;
    const bound = key.split(" ").map((name) => {
      // the element fires CustomEvents; the wrapper typed each handler with its exact detail
      const fn = (event: Event) => latest.current[name]?.(event as CustomEvent<never>);
      el.addEventListener(name, fn);
      return [name, fn] as const;
    });
    return () => bound.forEach(([name, fn]) => el.removeEventListener(name, fn));
  }, [key]);

  const setRef = useComposedRef(node, ref);

  const attrs: Record<string, string | boolean> = {};
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    attrs[name.toUpperCase()] =
      value === true ? true : typeof value === "object" ? JSON.stringify(value) : String(value);
  }

  // an element sets attributes on itself when it connects (roles, state), which can land before hydration
  return React.createElement(tag, { ...rest, ...attrs, ref: setRef, suppressHydrationWarning: true });
}
