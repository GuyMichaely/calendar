import type { Item } from "./model";

export function listItems(): Promise<Item[]>;
export function listItemsSnapshot(): Promise<Item[]>;
export function putItem(item: Item): Promise<void>;
export function deleteItem(id: string): Promise<void>;
export function canUndo(): boolean;
export function canRedo(): boolean;
export function undoLabel(): string;
export function redoLabel(): string;
export function undo(): Promise<boolean>;
export function redo(): Promise<boolean>;
export function exportData(): Promise<string>;
export function importData(text: string): Promise<number>;
