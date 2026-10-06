export function animationsEnabled(preference: string | null, reducedMotion: boolean): boolean {
  if (preference === "on") return true;
  if (preference === "off") return false;
  return !reducedMotion;
}
