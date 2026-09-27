// This prototype owns a separate browser dataset, even when served beside other builds.
export const STORAGE_NAMESPACE = "calendar-todo-prototype";
export const storageKey = name => `${STORAGE_NAMESPACE}:${name}`;
