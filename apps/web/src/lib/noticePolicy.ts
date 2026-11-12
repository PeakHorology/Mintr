/**
 * A status toast is for a command that did not do what was asked.
 * Confirmations ("Box added", "Undo") and next-click coaching stay off the screen.
 */
export function noticeIsActionable(message: string): boolean {
  const text = message.trim();
  if (!text || text === "Ready") return false;
  if (/(could not|couldn't|cannot|can't|failed|unable)/i.test(text)) return true;
  if (/(try again|is locked|unlock the|before undoing|before redoing)/i.test(text)) return true;
  if (/(clipboard is empty|project changed|clamped|at the 10 m limit|is already part of a \w+ pattern|mintr pro|only available)/i.test(text)) return true;
  if (/(too small|nothing to undo|nothing to redo|nothing to mirror|no editable|no stored|no edge feature)/i.test(text)) return true;
  if (/(close at least one profile|close a profile first|close an outline first)/i.test(text)) return true;
  if (/(needs a flat face|needs a width|needs an outline|needs a closed|two lines meet|two straight lines|one side of the axis|straight edges)/i.test(text)) return true;
  if (/^select /i.test(text) && !/highlighted edges/i.test(text)) return true;
  if (/^(choose an edge|choose a png|pick corners)/i.test(text)) return true;
  if (/cancel the fillet or chamfer/i.test(text)) return true;
  if (/(no magnet pockets|has none of (those|the) letters|the font has no |a set holds up to |printer plates:|bigger than the \d+ × \d+ mm bed)/i.test(text)) return true;
  if (/the (scene|object|design) changed/i.test(text)) return true;
  // Refusals that explain why nothing happened: without these, Group on a locked part or an
  // unsupported file just did nothing.
  if (/(unlock every|try (that )?again|too dense|unsupported|does not work|doesn't work|stay in one piece|dissolve that pattern|could not read|left out)/i.test(text)) return true;
  if (/^(nothing |finish the |wait for |type (the|an) |revolve needs |the outline |the profile |add a (model|part) |please select |model a few steps |no hidden shapes|sketch is empty|sketch on a face of a part first|that is the shape being copied|that part has no |the selected object has |this model has no |choose select )/i.test(text)) return true;
  if (/(needs an exact|finish or exit the sketch first|can cut one hole|the cut has to cross it)/i.test(text)) return true;
  // A hole that swallowed the solid leaves an empty plane; say so, or the parts just vanish.
  if (/nothing is left/i.test(text)) return true;
  return false;
}

/** A command failed. Refusals such as "Select a shape first" are not failures. */
export function noticeIsFailure(message: string): boolean {
  const text = message.trim();
  if (!text || text === "Ready") return false;
  return /(could not|couldn't|cannot|can't|failed|unable)/i.test(text);
}
