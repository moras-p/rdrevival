export const TOOL_FAMILIES = Object.freeze([
  { id: "draw", label: "Draw", primary: "pencil", tools: ["pencil", "eraser", "fill", "eyedropper"] },
  { id: "shapes", label: "Shapes", primary: "line", tools: ["line", "rectangle", "ellipse"] },
  { id: "select", label: "Select", primary: "selection", tools: ["selection", "wand"] },
  { id: "transform", label: "Transform", primary: "move", tools: ["move"] },
  { id: "navigate", label: "Navigate", primary: "hand", tools: ["hand"] },
]);

export const TOOL_META = Object.freeze({
  pencil: { label: "Pencil", shortcut: "P", icon: "pencil", context: "brush" },
  eraser: { label: "Eraser", shortcut: "E", icon: "eraser", context: "eraser" },
  fill: { label: "Fill", shortcut: "F", icon: "fill", context: "fill" },
  eyedropper: { label: "Eyedropper", shortcut: "I", icon: "eyedropper", context: "eyedropper" },
  line: { label: "Line", shortcut: "L", icon: "line", context: "shape" },
  rectangle: { label: "Rectangle", shortcut: "R", icon: "rectangle", context: "shape" },
  ellipse: { label: "Ellipse", shortcut: "O", icon: "ellipse", context: "shape" },
  selection: { label: "Rectangle select", shortcut: "S", icon: "selection", context: "selection" },
  wand: { label: "Wand", shortcut: "W", icon: "wand", context: "wand" },
  move: { label: "Move selection", shortcut: "M", icon: "move", context: "move" },
  hand: { label: "Pan", shortcut: "H", icon: "hand", context: "navigate" },
});

export const DOCKS = Object.freeze([
  { id: "color", label: "Color", icon: "color" },
  { id: "layers", label: "Layers", icon: "layers" },
  { id: "animation", label: "Animation", icon: "animation" },
  { id: "properties", label: "Properties", icon: "properties" },
  { id: "review", label: "Review", icon: "review" },
  { id: "output", label: "Output", icon: "output" },
]);

export function toolFamilyFor(tool) {
  return TOOL_FAMILIES.find((family) => family.tools.includes(tool)) ?? TOOL_FAMILIES[0];
}

export function contextForTool(tool) {
  return TOOL_META[tool]?.context ?? "navigate";
}
