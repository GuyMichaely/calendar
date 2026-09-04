import type { Item } from "./types";

export type EditorRequest = {
  item: Item | null;
  kind: "task" | "event";
  date?: Date;
  nonce: number;
};
