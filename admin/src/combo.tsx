import * as React from "react";
import { Icon } from "./ui.tsx";

/**
 * One value from a list, or a new one (the owner, 4 Nov: "add an option that
 * doesn't exist"): a text field with a pull-down menu, as iOS shows one, the
 * chosen option checked. Typing filters the list; Enter or a click picks; a
 * text that matches nothing offers Create "…". Leaving the field keeps
 * whatever was typed, so typing a role and moving on works too. New values
 * join the shared list when the project is saved (the Worker's `remember`).
 */
export function Combo({
  label,
  placeholder,
  value,
  options,
  onChange,
  onRemove,
  disabled,
}: {
  label: string;
  placeholder?: string;
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
      <input
        className="input"
        aria-label={label}
        placeholder={placeholder}
        value={typed ?? value}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-autocomplete="list"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setTyped(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
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
      />
      <Icon name="unfold_more" className="combo-indicator" />
      {open && !disabled && (
        <div className="menu" id={menuId} role="listbox" aria-label={label}>
          {choices.map((choice, i) => (
            <div
              key={`${choice.create}-${choice.value}`}
              role="option"
              tabIndex={-1}
              aria-selected={choice.value === value}
              className={`menu-item${i === active ? " active" : ""}${choice.create ? " create" : ""}`}
              // Keep the focus in the field, so picking isn't a blur.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(choice.value)}
              onKeyDown={(e) => e.key === "Enter" && choose(choice.value)}
            >
              {choice.create ? (
                <>
                  <Icon name="add" className="check" />
                  <span className="label">Create “{choice.value}”</span>
                </>
              ) : (
                <>
                  <span className="check">{choice.value === value && <Icon name="check" />}</span>
                  <span className="label">{choice.value}</span>
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
                      <Icon name="close" />
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
          {choices.length === 0 && <p className="menu-note">Type to add one.</p>}
        </div>
      )}
    </div>
  );
}
