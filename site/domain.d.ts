export type IsoDateString = string & { readonly __isoDateString: unique symbol };
export type DateInput = Date | string | number | null | undefined;

declare global {
  interface Date {
    toISOString(): IsoDateString;
  }
}

export function toDate(value: IsoDateString): Date;
export function toDate(value: DateInput): Date | null;
export function textMatches(item: import("./model").Item, query: string): boolean;
export function formatDateTime(value: DateInput): string;
export function isoToLocalInput(value: DateInput): string;
export function localInputToIso(value: string | FormDataEntryValue | null | undefined): IsoDateString | null;
export function startOfMonth(date: Date): Date;
export function calendarGridStart(date: Date): Date;
export function dateKey(value: DateInput): string;
