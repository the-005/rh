import * as React from "react";
import { fieldValue } from "./material.ts";

/**
 * One value from a list, or a new one: after Notion's selects ("Select an
 * option or create one", the owner, 4 Nov), as an M3 text field with a menu.
 * Typing filters the list; Enter or a click picks; a text that matches nothing
 * offers Create "…". Leaving the field keeps whatever was typed, so typing a
 * role and tabbing on works too. New values join the shared list when the
 * project is saved (the Worker's `remember`).
 */
export function Combo({
  label,
  value,
  options,
  onChange,
  onRemove,
  disabled,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  // Takes an option off the shared list (the × on its row).
  onRemove?: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  // What's been typed since the field opened; null shows the whole list.
  const [typed, setTyped] = React.useState<string | null>(null);
  const [active, setActive] = React.useState(0);
  const menuId = React.useId();

  const text = (typed ?? "").trim();
  const lower = text.toLowerCase();
  const matches = lower ? options.filter((o) => o.toLowerCase().includes(lower)) : options;
  const exists = options.some((o) => o.toLowerCase() === lower);
  const choices = [
    ...matches.map((o) => ({ value: o, create: false })),
    ...(text && !exists ? [{ value: text, create: true }] : []),
  ];

  const close = () => {
    setOpen(false);
    setTyped(null);
    setActive(0);
  };
  const choose = (next: string) => {
    onChange(next);
    close();
  };

  return (
    <div
      className="combo"
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        if (typed !== null && text !== value) onChange(text);
        close();
      }}
    >
      <md-outlined-text-field
        label={label}
        value={typed ?? value}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={menuId}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onInput={(e: React.FormEvent<HTMLElement>) => {
          setTyped(fieldValue(e));
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, choices.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && choices[active]) {
            e.preventDefault();
            choose(choices[active].value);
          } else if (e.key === "Escape") {
            close();
          }
        }}
      >
        <md-icon slot="trailing-icon">arrow_drop_down</md-icon>
      </md-outlined-text-field>
      {open && !disabled && (
        <div className="combo-menu" id={menuId} role="listbox">
          <p className="combo-hint md-typescale-label-medium">Select an option or create one</p>
          {choices.map((choice, i) => (
            <div
              key={`${choice.create}-${choice.value}`}
              role="option"
              tabIndex={-1}
              aria-selected={choice.value === value}
              className={i === active ? "combo-option active" : "combo-option"}
              // Keep the focus in the field, so picking isn't a blur.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(choice.value)}
              onKeyDown={(e) => e.key === "Enter" && choose(choice.value)}
            >
              <md-ripple />
              {choice.create ? (
                <>
                  <md-icon>add</md-icon>
                  <span>
                    Create <span className="option-chip">{choice.value}</span>
                  </span>
                </>
              ) : (
                <>
                  <span className="option-chip">{choice.value}</span>
                  {choice.value === value && <md-icon className="check">check</md-icon>}
                  {onRemove && (
                    <button
                      type="button"
                      className="option-remove"
                      aria-label={`Remove ${choice.value} from the list`}
                      title="Remove from the list"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(choice.value);
                      }}
                    >
                      <md-icon>close</md-icon>
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
          {choices.length === 0 && <p className="combo-hint md-typescale-body-medium">Type to add the first one.</p>}
        </div>
      )}
    </div>
  );
}
