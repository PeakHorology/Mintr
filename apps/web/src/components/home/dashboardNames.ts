export function formatUpdated(timestamp: number) {
  const age = Date.now() - timestamp;
  if (age < 60_000) return "Just now";
  if (age < 3_600_000) return `${Math.max(1, Math.round(age / 60_000))} min ago`;
  if (age < 86_400_000) return "Today";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
}

export function formatLibraryDate(timestamp = Date.now()) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
}

export function uniqueLibraryName(base: string, existing: string[]) {
  const names = new Set(existing.map((name) => name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  let suffix = 2;
  while (names.has(`${base} (${suffix})`.toLowerCase())) suffix += 1;
  return `${base} (${suffix})`;
}

export function nextDesignName(projects: Array<{ name: string }>) {
  return uniqueLibraryName(`Design · ${formatLibraryDate()}`, projects.map((project) => project.name));
}

export function nextFolderName(folders: Array<{ name: string }>) {
  return uniqueLibraryName(`Folder · ${formatLibraryDate()}`, folders.map((folder) => folder.name));
}
