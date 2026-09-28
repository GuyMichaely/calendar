import { For } from "solid-js";
import { isoToLocalInput, localInputToIso } from "../../site/domain.js";
import { shiftPreviewTime } from "./preview-clock";

export function PreviewClock(props: { now: Date; simulated: boolean; onChange: (date: Date | null) => void }) {
  return <details class="preview-clock" classList={{ simulated: props.simulated }}>
    <summary><strong>Preview clock</strong><span>{props.simulated ? `Simulating ${props.now.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}` : "Real time"}</span></summary>
    <div class="preview-clock-controls">
      <label>Date and time <input type="datetime-local" aria-label="Preview date and time" required value={isoToLocalInput(props.now)} onChange={event => {
        const value = localInputToIso(event.currentTarget.value);
        if (value) props.onChange(new Date(value));
        else event.currentTarget.value = isoToLocalInput(props.now);
      }} /></label>
      <div class="preview-clock-steps" role="group" aria-label="Step preview time">
        <For each={[-24, -1, 1, 24]}>{hours => <button type="button" class="secondary-button" onClick={() => props.onChange(shiftPreviewTime(props.now, hours))}>{hours > 0 ? "+" : "−"}{Math.abs(hours) === 24 ? "1 day" : "1 hour"}</button>}</For>
      </div>
      <button type="button" class="text-button" disabled={!props.simulated} onClick={() => props.onChange(null)}>Use real time</button>
    </div>
    <p class="field-hint">Changes task placement only, in this tab. Task edits and completion still use real time.</p>
  </details>;
}
