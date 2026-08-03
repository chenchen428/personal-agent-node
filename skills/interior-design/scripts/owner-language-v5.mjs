export function ownerTitle(value) {
  return String(value || "装修方案")
    .replace(/(?:装修设计|装修)?工作区/g, "装修方案")
    .replace(/装修装修方案/g, "装修方案")
    .replace(/装修方案装修方案/g, "装修方案")
    .replace(/\s+/g, " ")
    .trim();
}
