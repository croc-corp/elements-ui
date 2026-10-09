# Known issues

Open issues in the component sources that are known and not fixed yet. A fix for any of them is welcome
without further discussion; see [CONTRIBUTING.md](CONTRIBUTING.md). Fix the source in `registry/`, run
`pnpm catalog`, `pnpm docs:generate --force` and `pnpm verify`, and remove the entry here in the same pull
request.

## Data

- Most components classified as `demo` have no data input yet (see [Your data](https://elements.lumesec.ai/docs/data)
  for the list). Candidates, in order: `hf-status`, `px-signal`, `hf-matrix`, `px-gauge`.

## API

- Some Pixel HD display attributes, mostly `label`, are read once on connect; changing them later has no
  effect. Their pages say "Read once on connect" where this applies.
- Several Pixel HD elements expose read-only properties with the same name as an attribute (`hf-gauge` `min`,
  `max`, `zones`; `hf-knob` `min`, `max`, `step`; `hf-hero` `headline`; `hf-kbd` `keys`; `hf-donut` `data`;
  `hf-chips` `options`). Frameworks that bind properties instead of attributes, such as Preact or Lit with
  `.prop`, throw when they assign them. Set the attribute instead.
- The `open` event of `hf-sources` carries `Source` records with short keys (`t`, `d`, `s`).

## Accessibility

- `ui-hold-button` only confirms on a real key or pointer hold; the click that screen readers send to
  activate a button is ignored.
- `px-tooltip`: the bubble cannot be hovered (WCAG 1.4.13).
- `px-command` does not lock page scroll or make the page behind it inert while open.
- `px-select` and `px-choice` have no accessible name without `label`.
- `hf-marquee` keeps moving for more than five seconds without a pause control (WCAG 2.2.2); hovering slows it
  and reduced motion stops it.
- `hf-banner`: dismissing it leaves focus on the page, because nothing focusable remains inside.
- `hf-approve` keeps `role="alertdialog"` although it is an inline, non-modal card.
- `px-waffle` legend items are focusable list items without an interactive role.
- `px-voice` announces its transcript word by word.
- `geo-area` and `geo-location-picker` submit a hidden `required` input; on an invalid submit the browser
  focuses it although it is `aria-hidden`.
- Pointer-only interactions: drawing a pattern in `px-pattern` (Show me is the keyboard alternative), finishing
  a single loader in `px-spinners` (Finish all), the per-day tooltips of `px-uptime` and `px-activity`, turning
  `px-globe`, and picking a list row in `geo-azimuthal` (places on the map are keyboard accessible).

## Behaviour

- Permanent effects canvases reach past their component: `effort-slider` by 32 px on each side, most Location
  components by 8 to 40 px (16 px or less in narrow containers). On a page without
  `overflow-x: clip` on an ancestor, a component placed at the screen edge can make a phone page scroll
  sideways. Bursts from `sparks` are not affected.
- `px-metronome`, `px-jog` and `px-player` keep time in their animation loop, which pauses off screen.
- `hf-dropzone`: the simulated upload progress keeps running for a moment after the element is removed.

## Theme

- React components map the dark track colour to `bg-muted`, so tracks are lighter than the dark wells of the
  custom elements on most shadcn themes; custom elements keep the `--ui-track` override.
