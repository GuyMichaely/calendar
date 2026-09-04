import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CalendarView from "../src/CalendarView.svelte";
import ItemEditor from "../src/ItemEditor.svelte";
import TasksView from "../src/TasksView.svelte";
import { DEFAULT_SHORTCUTS } from "../src/shortcuts";
import type { Item, Task } from "../src/types";

const mounted: ReturnType<typeof mount>[] = [];

function target() {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id || "task-1",
    kind: "task",
    title: overrides.title || "Test task",
    state: overrides.state || "open",
    createdAt: overrides.createdAt || "2026-09-01T12:00:00.000Z",
    updatedAt: overrides.updatedAt || "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  Object.defineProperty(HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ width: 1, height: 1 }],
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  });
});

afterEach(async () => {
  while (mounted.length) await unmount(mounted.pop()!);
  vi.restoreAllMocks();
});

describe("task interactions", () => {
  test("focused task hotkeys dispatch semantic sleep actions", () => {
    const onSleepTomorrow = vi.fn(async (_task: Task) => undefined);
    const component = mount(TasksView, {
      target: target(),
      props: {
        items: [task()], query: "", compact: false, horizonDays: 7, horizonMode: "rolling",
        now: new Date("2026-09-04T12:00:00.000Z"), shortcuts: DEFAULT_SHORTCUTS,
        onCompactChange: vi.fn(), onHorizonChange: vi.fn(), onHorizonModeChange: vi.fn(), onEdit: vi.fn(),
        onComplete: vi.fn(async () => undefined), onWake: vi.fn(async () => undefined), onSleepTomorrow,
        onSleepIndefinite: vi.fn(async () => undefined), onSleepCustom: vi.fn(),
        onSleepToWait: vi.fn(async () => undefined), onWaitToSleep: vi.fn(async () => undefined),
      },
    });
    mounted.push(component);
    flushSync();
    const card = document.querySelector<HTMLElement>('[data-task-card="true"]')!;
    card.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    expect(onSleepTomorrow).toHaveBeenCalledOnce();
    expect(onSleepTomorrow.mock.calls[0][0].id).toBe("task-1");
  });

  test("sleeping tasks expose a direct wake action", () => {
    const onWake = vi.fn(async () => undefined);
    const component = mount(TasksView, {
      target: target(),
      props: {
        items: [task({ sleep: { startedAt: "2026-09-03T12:00:00.000Z", until: "2026-09-06T12:00:00.000Z" } })],
        query: "", compact: false, horizonDays: 7, horizonMode: "rolling", now: new Date("2026-09-04T12:00:00.000Z"),
        shortcuts: DEFAULT_SHORTCUTS, onCompactChange: vi.fn(), onHorizonChange: vi.fn(), onHorizonModeChange: vi.fn(),
        onEdit: vi.fn(), onComplete: vi.fn(async () => undefined), onWake,
        onSleepTomorrow: vi.fn(async () => undefined), onSleepIndefinite: vi.fn(async () => undefined),
        onSleepCustom: vi.fn(), onSleepToWait: vi.fn(async () => undefined), onWaitToSleep: vi.fn(async () => undefined),
      },
    });
    mounted.push(component);
    flushSync();
    const wake = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Wake")!;
    wake.click();
    expect(onWake).toHaveBeenCalledOnce();
  });
});

describe("editor behavior", () => {
  test("creates a task from the dialog", async () => {
    const onSave = vi.fn(async (_item: Item, _created: boolean) => undefined);
    const component = mount(ItemEditor, {
      target: target(),
      props: {
        request: { item: null, kind: "task", nonce: 1 },
        onClose: vi.fn(), onDelete: vi.fn(async () => undefined), onSave,
      },
    });
    mounted.push(component);
    flushSync();
    const title = document.querySelector<HTMLInputElement>('input[name="title"]')!;
    title.value = "Created in Svelte";
    title.dispatchEvent(new InputEvent("input", { bubbles: true }));
    document.querySelector<HTMLFormElement>("form")!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0]).toMatchObject({ kind: "task", title: "Created in Svelte", state: "open" });
    expect(onSave.mock.calls[0][1]).toBe(true);
  });

  test("dirty dialogs require confirmation before closing", () => {
    const onClose = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const existing = task();
    const component = mount(ItemEditor, {
      target: target(),
      props: { request: { item: existing, kind: "task", nonce: 2 }, onClose, onDelete: vi.fn(async () => undefined), onSave: vi.fn(async () => undefined) },
    });
    mounted.push(component);
    flushSync();
    const title = document.querySelector<HTMLInputElement>('input[name="title"]')!;
    title.value = "Changed";
    title.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const cancel = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Cancel")!;
    cancel.click();
    expect(confirm).toHaveBeenCalledWith("Discard your unsaved changes?");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("calendar sleep projection", () => {
  test("respect and ignore modes project a sleeping task to different dates", () => {
    const sleeping = task({
      title: "Sleepy",
      availableFrom: "2026-09-05T09:00:00.000Z",
      sleep: { startedAt: "2026-09-04T12:00:00.000Z", until: "2026-09-07T09:00:00.000Z" },
    });
    const common = {
      items: [sleeping], query: "", month: new Date(2026, 8, 1), now: new Date("2026-09-04T12:00:00.000Z"),
      onMonthChange: vi.fn(), onSleepModeChange: vi.fn(), onEdit: vi.fn(), onCreateForDay: vi.fn(), onOpenTodayTasks: vi.fn(),
    };

    const respectTarget = target();
    const respect = mount(CalendarView, { target: respectTarget, props: { ...common, sleepMode: "respect" as const } });
    mounted.push(respect);
    flushSync();
    const respectChip = respectTarget.querySelector<HTMLButtonElement>('button[title="Sleepy: projected start"]')!;
    expect(respectChip.closest(".calendar-day")?.querySelector(".day-number")?.textContent).toBe("7");

    const ignoreTarget = target();
    const ignore = mount(CalendarView, { target: ignoreTarget, props: { ...common, sleepMode: "ignore" as const } });
    mounted.push(ignore);
    flushSync();
    const ignoreChip = ignoreTarget.querySelector<HTMLButtonElement>('button[title="Sleepy: projected start while sleep is ignored"]')!;
    expect(ignoreChip.closest(".calendar-day")?.querySelector(".day-number")?.textContent).toBe("5");
  });
});