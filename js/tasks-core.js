// Tasks core — pure logic, no DOM. Drives the per-row divider control on the
// Breaks tab's one-time tasks (Cycle 04) and the node test suite.
//
// A task carries a `group` field that is either a divider's id (an entry in
// config.groups) or null ("no divider" — the general list). This module is the
// contract behind assigning/moving a task's divider from the normal view:
// nothing here ever lets a task point at a divider that doesn't exist.

// Set a task's divider. `groupId` is honored only if it names an existing
// group; any unknown id, empty string, or falsy value resolves to null
// ("no divider"). This coercion is what keeps assignments correct after a
// divider is renamed or deleted — a stale id can never stick. Mutates the
// matching task in place (config is the app's live state) and returns true if
// the value actually changed, false otherwise (incl. unknown task id).
export function setTaskGroup(config, taskId, groupId) {
  const tasks = config && Array.isArray(config.tasks) ? config.tasks : [];
  const groups = config && Array.isArray(config.groups) ? config.groups : [];
  const task = tasks.find(t => t && t.id === taskId);
  if (!task) return false;
  const exists = groupId && groups.some(g => g && g.id === groupId);
  const next = exists ? groupId : null;
  const current = task.group || null;
  if (current === next) return false;
  task.group = next;
  return true;
}

// Build the ordered option list for a task's divider control: a leading
// "no divider" entry (id: null) followed by every current divider as
// { id, name, color }. The entry matching task.group is marked selected (or
// "no divider" when the task is unset). With no dividers defined, returns just
// the no-divider entry — the app uses that to hide the control (keeps calm).
export function groupOptions(config, task) {
  const groups = config && Array.isArray(config.groups) ? config.groups : [];
  const current = (task && task.group) || null;
  const options = [{ id: null, name: 'no divider', color: null, selected: current === null }];
  for (const g of groups) {
    if (!g || !g.id) continue;
    options.push({ id: g.id, name: g.name, color: g.color, selected: current === g.id });
  }
  return options;
}
