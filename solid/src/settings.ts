export function loadPollSeconds(): number {
  const stored = localStorage.getItem("calendar.pollSeconds");
  const value = stored === null ? 15 : Number(stored);
  return [0, 5, 15, 30, 60, 300].includes(value) ? value : 15;
}

export function animationsEnabled(preference: string | null, reducedMotion: boolean): boolean {
  if (preference === "on") return true;
  if (preference === "off") return false;
  return !reducedMotion;
}
