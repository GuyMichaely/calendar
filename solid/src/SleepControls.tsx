import type { CalendarSleepMode } from "./types";
import { Icon } from "./Icon";

export function SleepControls(props: {
  mode: CalendarSleepMode;
  hideSleeping: boolean;
  onModeChange: (mode: CalendarSleepMode) => void;
  onHideChange: (hide: boolean) => void;
}) {
  return <div class="sleep-controls" role="group" aria-label="Sleep visibility">
    <label><input type="checkbox" role="switch" checked={props.mode === "respect"} onChange={event => props.onModeChange(event.currentTarget.checked ? "respect" : "ignore")} /><Icon name="moon" size={15} /><span>Respect sleep</span></label>
    <label><input type="checkbox" checked={props.hideSleeping} onChange={event => props.onHideChange(event.currentTarget.checked)} /><span>Hide sleeping tasks</span></label>
  </div>;
}
