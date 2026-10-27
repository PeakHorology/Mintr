/**
 * A status toast is for a command that did not do what was asked.
 * Confirmations ("Box added", "Undo") and next-click coaching stay off the screen.
 */
export function noticeIsActionable(message: string): boolean {
  const text = message.trim();
  if (!text || text === "Ready") return false;
  if (/(could not|couldn't|cannot|can't|failed|unable)/i.test(text)) return true;
  if (/(try again|is locked|unlock the|before undoing|before redoing)/i.test(text)) return true;
  if (/(clipboard is empty|project changed|clamped|mintr pro|only available)/i.test(text)) return true;
  if (/(too small|nothing to undo|nothing to redo|nothing to mirror|no editable|no stored|no edge feature)/i.test(text)) return true;
  if (/(close at least one profile|close a profile first|close an outline first)/i.test(text)) return true;
  if (/(needs a flat face|needs a width|needs an outline|needs a closed|two lines meet|two straight lines|one side of the axis|straight edges)/i.test(text)) return true;
  if (/^select /i.test(text) && !/highlighted edges/i.test(text)) return true;
  if (/^(choose an edge|choose a png|pick corners)/i.test(text)) return true;
  if (/cancel the fillet or chamfer/i.test(text)) return true;
  if (/the (scene|object) changed/i.test(text)) return true;
  return false;
}

/** A command failed. Refusals such as "Select a shape first" are not failures. */
export function noticeIsFailure(message: string): boolean {
  const text = message.trim();
  if (!text || text === "Ready") return false;
  return /(could not|couldn't|cannot|can't|failed|unable)/i.test(text);
}
