const SELECTED_MANAGER_PROJECT_KEY = "cr.manager.selectedProjectId";

export function readSelectedManagerProjectId(): string | null {
  try {
    const value = localStorage.getItem(SELECTED_MANAGER_PROJECT_KEY);
    return value?.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function writeSelectedManagerProjectId(value: string | null): void {
  try {
    if (value) localStorage.setItem(SELECTED_MANAGER_PROJECT_KEY, value);
    else localStorage.removeItem(SELECTED_MANAGER_PROJECT_KEY);
  } catch {
    // ignore unavailable browser storage
  }
}
