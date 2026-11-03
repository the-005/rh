/**
 * Material 3 for the admin (the owner, 4 Nov: "use m3.material.io"), through
 * Google's own web components, @material/web. They're custom elements; React
 * 19 sets their properties (value, disabled…) directly, and their input events
 * bubble out of their shadow DOM, so `onInput` reads `currentTarget.value`.
 * Colours, type and shapes are M3's tokens, set in style.css.
 */

import "@material/web/button/filled-button.js";
import "@material/web/button/outlined-button.js";
import "@material/web/button/text-button.js";
import "@material/web/divider/divider.js";
import "@material/web/focus/md-focus-ring.js";
import "@material/web/icon/icon.js";
import "@material/web/iconbutton/icon-button.js";
import "@material/web/progress/linear-progress.js";
import "@material/web/ripple/ripple.js";
import "@material/web/select/outlined-select.js";
import "@material/web/select/select-option.js";
import "@material/web/textfield/outlined-text-field.js";
import { styles as typescale } from "@material/web/typography/md-typescale-styles.js";
import type * as React from "react";

// The M3 type scale as classes (md-typescale-headline-medium and so on).
if (typescale.styleSheet) document.adoptedStyleSheets.push(typescale.styleSheet);

// What an M3 text field or select holds, read from its input event.
export const fieldValue = (e: React.FormEvent<HTMLElement>) => (e.currentTarget as HTMLElement & { value: string }).value;

// Props for any of them: the usual HTML ones plus whatever the element takes.
type MdProps = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { [property: string]: unknown };

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "md-filled-button": MdProps;
      "md-outlined-button": MdProps;
      "md-text-button": MdProps;
      "md-divider": MdProps;
      "md-focus-ring": MdProps;
      "md-icon": MdProps;
      "md-icon-button": MdProps;
      "md-linear-progress": MdProps;
      "md-ripple": MdProps;
      "md-outlined-select": MdProps;
      "md-select-option": MdProps;
      "md-outlined-text-field": MdProps;
    }
  }
}
