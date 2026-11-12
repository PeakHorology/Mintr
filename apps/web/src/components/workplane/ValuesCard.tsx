"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { Plus, SlidersHorizontal, X } from "lucide-react";
import { isValueExpression, resolveValues, valueRangeProblem, valueRenameProblem, valueSliderRange } from "@/lib/parametricValues";
import type { ShapeValue } from "@/types/sketchforge";

/** A worked-out value, short: 12.5, 0.333. */
export function formatValueNumber(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** An answer with the workplane unit after it, when there is one. */
function withUnit(text: string, unitLabel: string | undefined) {
  return unitLabel ? `${text} ${unitLabel}` : text;
}

type ValueDetails = Pick<ShapeValue, "min" | "max" | "note">;

/** The value with its range and note replaced; an empty one is left off. */
function withDetails(value: ShapeValue, details: ValueDetails): ShapeValue {
  const { min: _min, max: _max, note: _note, ...rest } = value;
  return {
    ...rest,
    ...(typeof details.min === "number" ? { min: details.min } : {}),
    ...(typeof details.max === "number" ? { max: details.max } : {}),
    ...(details.note ? { note: details.note } : {}),
  };
}

function nextFreeName(values: readonly ShapeValue[]) {
  const taken = new Set(values.map((value) => value.name));
  for (let index = 1; ; index += 1) {
    const name = index === 1 ? "size" : `size${index}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * Mintr Pro: a part's named values. Each row is `name = sum`, with the number it comes to, or
 * what is wrong with it. Any size box on the part, or on parts grouped in it, can use the names.
 */
export function ValuesCard({
  values,
  outerScope,
  unitMm = 1,
  unitLabel,
  locked,
  onChange,
}: {
  values: readonly ShapeValue[];
  /** Values from the groups around this part, which these can use. */
  outerScope?: ReadonlyMap<string, number>;
  /** Millimeters per workplane unit: plain numbers in the sums are in this unit. */
  unitMm?: number;
  /** The workplane unit ("mm", "in"), shown after each answer. */
  unitLabel?: string;
  locked: boolean;
  /** The new list; `renamed` when a row's name changed, so sums that use it follow. */
  onChange: (next: ShapeValue[], message: string, renamed?: { from: string; to: string }) => void;
}) {
  const resolved = resolveValues(values, outerScope, unitMm);
  return (
    <div className="property-card values-card" aria-label="Values">
      <div className="values-card-header">
        <strong>Values</strong>
        <button
          type="button"
          className="values-card-add"
          disabled={locked}
          onClick={() => onChange([...values, { name: nextFreeName(values), expression: "10" }], "Added a value")}
        >
          <Plus size={14} strokeWidth={2.6} aria-hidden="true" />
          <span>Add value</span>
        </button>
      </div>
      {values.length === 0 ? (
        <p className="values-card-hint">Name a size once, then type its name in any size box, like wall * 2.</p>
      ) : (
        <div className="values-card-rows">
          {values.map((value, index) => (
            <ValueRow
              // By position, not name: a rename re-keyed the row, so Tab from the name lost focus
              // and the sum typed next went nowhere. The row syncs its drafts from the props.
              key={index}
              value={value}
              result={resolved.own.get(value.name)}
              error={resolved.errors.get(value.name)}
              unitLabel={unitLabel}
              renameProblem={(name) => valueRenameProblem(name, values.filter((_, entryIndex) => entryIndex !== index), outerScope)}
              locked={locked}
              onRename={(name) => {
                const next = values.map((entry, entryIndex) => (entryIndex === index ? { ...entry, name } : entry));
                onChange(next, `Renamed ${value.name} to ${name}`, { from: value.name, to: name });
              }}
              onExpression={(expression) => {
                const next = values.map((entry, entryIndex) => (entryIndex === index ? { ...entry, expression } : entry));
                onChange(next, `${value.name} = ${expression}`);
              }}
              onDetails={(details) => {
                const next = values.map((entry, entryIndex) => (entryIndex === index ? withDetails(entry, details) : entry));
                onChange(next, `Set the range of ${value.name}`);
              }}
              onRemove={() => onChange(values.filter((_, entryIndex) => entryIndex !== index), `Removed ${value.name}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ValueRow({
  value,
  result,
  error,
  unitLabel,
  renameProblem,
  locked,
  onRename,
  onExpression,
  onDetails,
  onRemove,
}: {
  value: ShapeValue;
  result: number | undefined;
  error: string | undefined;
  unitLabel?: string;
  /** Why this row cannot take a name (a bad name, or one another value has), or null. */
  renameProblem: (name: string) => string | null;
  locked: boolean;
  onRename: (name: string) => void;
  onExpression: (expression: string) => void;
  onDetails: (details: ValueDetails) => void;
  onRemove: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const range = valueSliderRange(value);
  // A slider only for a plain number; a sum is worked out from other values.
  const slider = range && !isValueExpression(value.expression) && result !== undefined ? range : null;
  const [sliding, setSliding] = useState<number | null>(null);
  const [name, setName] = useState(value.name);
  const [expression, setExpression] = useState(value.expression);
  const [nameIssue, setNameIssue] = useState<string | null>(null);
  useEffect(() => setName(value.name), [value.name]);
  useEffect(() => setExpression(value.expression), [value.expression]);

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed === value.name) {
      setNameIssue(null);
      return;
    }
    const problem = renameProblem(trimmed);
    if (problem) {
      setNameIssue(problem);
      setName(value.name);
      return;
    }
    setNameIssue(null);
    onRename(trimmed);
  };
  const commitExpression = () => {
    const trimmed = expression.trim();
    if (!trimmed) {
      setExpression(value.expression);
      return;
    }
    if (trimmed !== value.expression) onExpression(trimmed);
  };
  const blurOnEnter = (event: KeyboardEvent<HTMLInputElement>, reset: () => void) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      reset();
      event.currentTarget.blur();
    }
  };

  const problem = nameIssue ?? error ?? valueRangeProblem(value, result);
  const commitSlide = () => {
    if (sliding === null) return;
    const text = formatValueNumber(sliding);
    setSliding(null);
    if (text !== value.expression) onExpression(text);
  };
  return (
    <div className={`values-card-row${problem ? " has-problem" : ""}`}>
      <input
        className="values-card-name"
        value={name}
        disabled={locked}
        aria-label="Value name"
        spellCheck={false}
        onChange={(event) => setName(event.currentTarget.value)}
        onBlur={commitName}
        onKeyDown={(event) => blurOnEnter(event, () => setName(value.name))}
      />
      <span className="values-card-equals" aria-hidden="true">=</span>
      <input
        className="values-card-expression"
        value={expression}
        disabled={locked}
        aria-label={`${value.name} sum`}
        spellCheck={false}
        onChange={(event) => setExpression(event.currentTarget.value)}
        onBlur={commitExpression}
        onKeyDown={(event) => blurOnEnter(event, () => setExpression(value.expression))}
      />
      <span className="values-card-result" title={problem ?? undefined}>
        {problem ? "!" : sliding !== null ? withUnit(formatValueNumber(sliding), unitLabel) : result === undefined ? "" : withUnit(formatValueNumber(result), unitLabel)}
      </span>
      <button
        type="button"
        className={`values-card-range${detailsOpen ? " is-open" : ""}`}
        disabled={locked}
        aria-label={`Range and note for ${value.name}`}
        aria-expanded={detailsOpen}
        title="Lowest, highest and a note"
        onClick={() => setDetailsOpen((open) => !open)}
      >
        <SlidersHorizontal size={13} strokeWidth={2.4} />
      </button>
      <button type="button" className="values-card-remove" disabled={locked} aria-label={`Remove ${value.name}`} onClick={onRemove}>
        <X size={13} strokeWidth={2.6} />
      </button>
      {slider ? (
        <input
          type="range"
          className="values-card-slider"
          min={slider.min}
          max={slider.max}
          step={slider.step}
          value={sliding ?? Math.min(slider.max, Math.max(slider.min, result ?? slider.min))}
          disabled={locked}
          aria-label={`${value.name} slider`}
          onChange={(event) => setSliding(Number(event.currentTarget.value))}
          onPointerUp={commitSlide}
          onKeyUp={commitSlide}
          onBlur={commitSlide}
        />
      ) : null}
      {detailsOpen ? (
        <ValueDetailsFields value={value} locked={locked} onDetails={onDetails} />
      ) : value.note ? (
        <p className="values-card-note">{value.note}</p>
      ) : null}
      {problem ? <p className="values-card-problem">{problem}</p> : null}
    </div>
  );
}

const rangeText = (number: number | undefined) => (number === undefined ? "" : String(number));

/** Lowest, highest and a note for a value. A range gives a plain-number value a slider. */
function ValueDetailsFields({ value, locked, onDetails }: { value: ShapeValue; locked: boolean; onDetails: (details: ValueDetails) => void }) {
  const [min, setMin] = useState(rangeText(value.min));
  const [max, setMax] = useState(rangeText(value.max));
  const [note, setNote] = useState(value.note ?? "");
  useEffect(() => setMin(rangeText(value.min)), [value.min]);
  useEffect(() => setMax(rangeText(value.max)), [value.max]);
  useEffect(() => setNote(value.note ?? ""), [value.note]);

  const commit = () => {
    const parse = (entry: string) => {
      const number = Number.parseFloat(entry);
      return entry.trim() && Number.isFinite(number) ? number : undefined;
    };
    let nextMin = parse(min);
    let nextMax = parse(max);
    if (nextMin !== undefined && nextMax !== undefined && nextMin > nextMax) [nextMin, nextMax] = [nextMax, nextMin];
    const nextNote = note.trim().slice(0, 120) || undefined;
    if (nextMin === value.min && nextMax === value.max && nextNote === value.note) {
      setMin(rangeText(value.min));
      setMax(rangeText(value.max));
      return;
    }
    onDetails({ min: nextMin, max: nextMax, note: nextNote });
  };
  const blurOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
  };

  return (
    <div className="values-card-details">
      <label>
        <span>Lowest</span>
        <input value={min} inputMode="decimal" disabled={locked} onChange={(event) => setMin(event.currentTarget.value)} onBlur={commit} onKeyDown={blurOnEnter} />
      </label>
      <label>
        <span>Highest</span>
        <input value={max} inputMode="decimal" disabled={locked} onChange={(event) => setMax(event.currentTarget.value)} onBlur={commit} onKeyDown={blurOnEnter} />
      </label>
      <label className="values-card-details-note">
        <span>Note</span>
        <input value={note} maxLength={120} disabled={locked} placeholder="What this value is for" onChange={(event) => setNote(event.currentTarget.value)} onBlur={commit} onKeyDown={blurOnEnter} />
      </label>
    </div>
  );
}
