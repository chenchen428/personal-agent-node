import * as React from "react";
import { compactTokenUnit, formatCompactTokenCount, TOKEN_UNIT_DETAILS } from "./format";

export function CompactTokenCount({ value }: { value: number }) {
  const formatted = formatCompactTokenCount(value);
  const unit = compactTokenUnit(value);
  if (!unit) return <>{formatted}</>;

  const number = formatted.slice(0, -unit.length);
  const detail = TOKEN_UNIT_DETAILS[unit];
  return <>{number}<abbr className="token-count-unit" title={detail.description} aria-label={detail.accessibleDescription} tabIndex={0}>{unit}</abbr></>;
}
