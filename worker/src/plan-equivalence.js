export function planSignature(raw) {
  const plan = raw?.plan || raw;
  if (!plan || typeof plan !== "object") return "";
  const members = Array.isArray(plan.members) ? plan.members : [];
  const point = (value) => ({
    label: String(value?.label || ""),
    lat: Number(value?.lat),
    lon: Number(value?.lon),
  });
  return JSON.stringify({
    v: Number(plan.v) || 1,
    members: members.map((member) => ({
      name: String(member?.name || ""),
      color: String(member?.color || ""),
      origin: point(member?.origin),
    })),
    destination: point(plan.destination),
    priority: Array.isArray(plan.priority) ? plan.priority.map(Number) : [],
    mode: String(plan.mode || ""),
    timing: String(plan.timing || ""),
    date: String(plan.date || ""),
    time: String(plan.time || ""),
  });
}

export function plansEquivalent(a, b) {
  const left = planSignature(a);
  return Boolean(left) && left === planSignature(b);
}
