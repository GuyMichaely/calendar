import { For } from "solid-js";

// Stand-in rows where items go while the calendar loads: the page's shape, without saying it's empty.
const widths = [[34, 58], [52, 41], [28, 66], [45, 50], [38, 72], [56, 44]];
export function SkeletonRows(props: { count?: number }) {
  return <div class="skeleton-rows" aria-hidden="true">
    <For each={widths.slice(0, props.count ?? 5)}>{([meta, title]) =>
      <div class="skeleton-row"><span style={{ width: `${meta}%` }} /><span style={{ width: `${title}%` }} /></div>}
    </For>
  </div>;
}
