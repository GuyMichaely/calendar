export function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function textMatches(item, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    item.title,
    item.notes,
    ...(Array.isArray(item.tags) ? item.tags : []),
    ...(Array.isArray(item.attachments) ? item.attachments.map((x) => x?.name || "") : []),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return haystack.includes(q);
}
