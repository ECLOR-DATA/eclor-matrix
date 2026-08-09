// Format helpers extracted from visual.ts so the Excel-style format-string
// parser is unit-testable in isolation. The visual.ts hot path imports both
// `formatActualLabel` (pillars / bridges / variance labels) and
// `formatVarianceValue` (the lower-level parser) from here.

import { valueFormatter as pbiValueFormatter } from "powerbi-visuals-utils-formattingutils";

export type DisplayScale = { scale: number; suffix: string };

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const SHORT_HEX_RE = /^#[0-9a-fA-F]{3}$/;

/** Validate a ColorPicker value before injection into SVG attributes. Anything
 *  that doesn't match a 3- or 6-digit hex literal falls back to the provided
 *  default. Shared by visual.ts and tooltip.ts (audit dup-safehex-two-files). */
export function safeHex(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  if (HEX_RE.test(value) || SHORT_HEX_RE.test(value)) return value;
  return fallback;
}

/** Validate a ColorPicker value but treat empty / whitespace as "no colour"
 *  (returns ""). Used by every label-background resolution chain so the
 *  renderer's empty-string gate keeps short-circuiting. Plain `safeHex`
 *  would coerce "" into the fallback, which defeats the toggle-less UX. */
export function safeHexOrEmpty(value: unknown): string {
  if (typeof value !== "string") return "";
  const v = value.trim();
  if (!v) return "";
  return safeHex(v, "");
}

export function computeAutoScale(maxAbs: number): DisplayScale {
  if (maxAbs >= 1e12) return { scale: 1e12, suffix: "T" };
  if (maxAbs >= 1e9) return { scale: 1e9, suffix: "bn" };
  if (maxAbs >= 1e6) return { scale: 1e6, suffix: "M" };
  if (maxAbs >= 1e3) return { scale: 1e3, suffix: "K" };
  return { scale: 1, suffix: "" };
}

export function getDisplayScale(units: string, maxAbsForAuto: number): DisplayScale {
  switch (units) {
    case "none":
      return { scale: 1, suffix: "" };
    case "thousands":
      return { scale: 1e3, suffix: "K" };
    case "millions":
      return { scale: 1e6, suffix: "M" };
    case "billions":
      return { scale: 1e9, suffix: "bn" };
    case "auto":
    default:
      return computeAutoScale(maxAbsForAuto);
  }
}

export function formatWithScale(
  value: number,
  scale: DisplayScale,
  decimals: number,
  locale: string = "en-US"
): string {
  const scaled = value / scale.scale;
  try {
    return (
      scaled.toLocaleString(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }) + scale.suffix
    );
  } catch {
    return scaled.toFixed(decimals) + scale.suffix;
  }
}

/** Excel-style format-string parser. Honours `$#,##0`, `0%`, `0.00`,
 *  `+#,##0;-#,##0;0`, parenthesised-negative `(#,##0)`, etc.
 *
 *  Strips Excel colour / locale codes (`[Red]`, `[$-409]`, `[>0]`) so they
 *  don't leak into the rendered text.
 *
 *  `decimalsOverride` ignores the format's own decimal portion (used when the
 *  user sets a `Decimal places` override on a card while we keep the rest of
 *  the model format).
 */
export function formatVarianceValue(
  value: number | null,
  formatStr: string,
  locale: string = "en-US",
  decimalsOverride?: number
): string {
  if (value === null || value === undefined || isNaN(value)) return "";
  // No fallback default format: when the user has set nothing, we honour
  // the DAX measure's own format string verbatim — empty string means a
  // plain locale-grouped number. The sign-aware `+#,0;-#,0;0` default was
  // removed in 1.1.12.0; callers that want a "+" prefix should pass
  // `withSign: true` to formatActualLabel instead.
  const cleanFormat = (formatStr || "").replace(/\[[^\]]*\]/g, "");
  const parts = cleanFormat.split(";");

  // DAX / Excel format-string literals — common in Power BI Field Parameter
  // measures whose model format looks like `# ##0\ "€";-# ##0\ "€"`:
  //   - `\X` escapes the next character → render it literally (drop the `\`)
  //   - `"X"` quotes a literal string → render the inner text (drop the quotes)
  // Without this step the prefix/suffix extractor below grabs the raw
  // sub-string (`\ "€"`) as the suffix and we get `73 704\ "€"` on screen.
  // Applied per-section AFTER splitting on `;`, so `\;` (rare) would survive
  // the split unscathed if we ever needed to support it.
  const unescapeLiterals = (s: string): string =>
    s.replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1");
  for (let i = 0; i < parts.length; i++) parts[i] = unescapeLiterals(parts[i] || "");

  // User-friendly suffix inheritance: when the negative (or zero) pattern is
  // JUST a sign + digits (no text suffix like " m€" / " €"), but the positive
  // pattern has one, inherit the positive's suffix so users typing
  // "+#,0 m€;-#,0;0 m€" don't get "-8" without the unit. Excel's literal
  // semantics keep them apart, but the typo-vs-intent ratio strongly favours
  // sharing the suffix.
  const NUMERIC_ONLY = /^\s*[+-]?\s*[0#,.\s]+\s*$/;
  const inheritSuffix = (idx: number): void => {
    if (!parts[idx] || !NUMERIC_ONLY.test(parts[idx])) return;
    const pos = parts[0] || "";
    const posReverse = pos.split("").reverse().join("");
    const posLastNum = posReverse.search(/[0#]/);
    if (posLastNum <= 0) return;
    const posSuffix = pos.substring(pos.length - posLastNum);
    if (/[A-Za-z€£¥%$]/.test(posSuffix)) {
      parts[idx] = parts[idx].trimEnd() + posSuffix;
    }
  };
  inheritSuffix(1);
  inheritSuffix(2);

  let pattern: string;
  if (value > 0) pattern = parts[0] || "";
  else if (value < 0) pattern = parts[1] || parts[0] || "";
  else pattern = parts[2] || parts[0] || "";

  const isPct = pattern.includes("%");
  const v = isPct ? value * 100 : value;
  const absV = Math.abs(v);
  const decimalMatch = pattern.match(/\.(0+)/);
  const formatDecimals = decimalMatch ? decimalMatch[1].length : 0;
  const decimals = decimalsOverride !== undefined ? decimalsOverride : formatDecimals;
  // Thousands grouping detection covers en-US (`#,##0`), fr-FR / many EU
  // locales (`# ##0` with regular or non-breaking space) and any digit-
  // separator-digit pattern that survived unescapeLiterals above.
  const hasThousands =
    pattern.includes("#,##0") ||
    pattern.includes(",") ||
    /[#0][\s ][#0]/.test(pattern);
  let formatted: string;
  if (hasThousands) {
    try {
      formatted = absV.toLocaleString(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      });
    } catch {
      formatted = absV.toFixed(decimals);
    }
  } else {
    formatted = absV.toFixed(decimals);
  }

  const hasExplicitPlus = pattern.trimStart().startsWith("+");
  const firstNum = pattern.search(/[0#]/);
  const reversedPattern = pattern.split("").reverse().join("");
  const lastNumIdx = reversedPattern.search(/[0#]/);
  let prefix = firstNum > 0 ? pattern.substring(0, firstNum) : "";
  const suffix = lastNumIdx > 0 ? pattern.substring(pattern.length - lastNumIdx) : "";
  // Strip leading sign markers from the prefix — including any surrounding
  // whitespace. The actual sign comes from `value`, not the format string.
  // Without this, formats with leading whitespace (when PBI splits parts
  // with spaces around tokens — e.g., " -#,0" instead of "-#,0") produced
  // a duplicated sign: prefix " +" untouched by simple `.startsWith("+")`
  // → "+ +8 m€" / "- -8".
  prefix = prefix.replace(/^\s*[+-]+\s*/, "");

  // Parenthesised-negative format (`(#,##0)` or `(#,##0 m€)`) already encodes
  // the negative sign via prefix/suffix. Adding our own "-" would double-mark
  // it as "-(1,234)" / "-(8 m€)".
  const isParenthesisedNegative =
    prefix.trim().endsWith("(") && suffix.trim().endsWith(")");

  let sign = "";
  if (value > 0 && hasExplicitPlus) sign = "+";
  else if (value < 0 && !isParenthesisedNegative) sign = "-";

  return sign + prefix + formatted + suffix;
}

/** TRUE when any section of a multi-pattern format carries a percent or a
 *  literal text suffix after its last digit placeholder — `+#,0 m€;-#,0`,
 *  `+0.0%;-0.0%`. Uses the same cleaning steps as formatVarianceValue
 *  (strip `[..]` codes, unescape `\X` / `"X"` literals) so `# ##0\ "€"`
 *  style formats are detected too. Checked format-wide (any section) so a
 *  chart never mixes scaled and unscaled labels across signs. Sign markers,
 *  grouping and parenthesised negatives don't count as literal suffixes. */
function multiPatternCarriesAffix(formatStr: string): boolean {
  const clean = (formatStr || "").replace(/\[[^\]]*\]/g, "");
  return clean.split(";").some((rawPart) => {
    const part = (rawPart || "")
      .replace(/"([^"]*)"/g, "$1")
      .replace(/\\(.)/g, "$1");
    if (part.includes("%")) return true;
    const reversed = part.split("").reverse().join("");
    const lastNumIdx = reversed.search(/[0#]/);
    if (lastNumIdx <= 0) return false;
    const suffix = part.substring(part.length - lastNumIdx);
    return /[A-Za-z€£¥$]/.test(suffix);
  });
}

/** High-level formatter used by every label in the chart (pillars, bridges,
 *  rails, tooltips). Combines a model format string with optional per-card
 *  display-unit / decimal-places overrides.
 *
 *  Delegates to Power BI's official `valueFormatter` (same lib SimpleWaterfall
 *  uses) for single-pattern formats so DAX format strings — including locale-
 *  aware currency (`[$€-fr-FR]#,##0.00`), percentages (`0.0%`), thousands
 *  separators and culture-specific number conventions — render exactly the
 *  way they do in native Power BI visuals.
 *
 *  Falls back to the custom `formatVarianceValue` parser for multi-pattern
 *  Excel-style formats with sign-aware patterns (`+#,##0;-#,##0;0`), which
 *  `valueFormatter` doesn't honour natively.
 *
 *  Display-unit policy:
 *  - "Auto" + a custom model format ⇒ respect the format verbatim, NO
 *    auto-scaling (`value: 0` to valueFormatter). Avoids `5.00%K` / `$1.50M €`.
 *  - "Auto" + no model format ⇒ auto-pick K/M/bn based on data magnitude.
 *  - Explicit unit pick (thousands/millions/billions) ⇒ scale, even with a
 *    model format — the user has overridden the default behaviour — EXCEPT
 *    when a multi-pattern format carries its own literal suffix or percent:
 *    scaling would double-transform `%` values (`0.05` → `/1000` → `×100` →
 *    nonsense) and the unit suffix would collide with the format's own text
 *    (`+2 m€K`). There the format wins verbatim, mirroring the auto policy
 *    (decision 1.1.59.0, audit TG-10).
 */
export function formatActualLabel(opts: {
  value: number;
  modelFormat: string;
  cardUnits: string;
  cardDecimals: number;
  /** Decimals to use when `cardDecimals === 0` AND no model format is set. */
  autoDecimals: number;
  locale: string;
  dataMaxAbs: number;
  withSign?: boolean;
}): string {
  const {
    value,
    modelFormat,
    cardUnits,
    cardDecimals,
    autoDecimals,
    locale,
    dataMaxAbs,
    withSign
  } = opts;

  const hasModelFormat = !!modelFormat && modelFormat.length > 0;

  // Multi-pattern Excel-style format (positive;negative;zero with sign-aware
  // patterns) — the official valueFormatter doesn't honour these natively,
  // so we keep delegating to the custom Excel parser. Mirrors the legacy
  // behaviour exactly so reports with `+#,##0;-#,##0` stay pixel-identical.
  const hasMultiPattern = hasModelFormat && modelFormat.includes(";");
  if (hasMultiPattern) {
    const isAutoUnits = !cardUnits || cardUnits === "auto";
    // Format-embedded suffix / % beats the explicit unit pick — see the
    // display-unit policy in the doc comment above.
    const formatWins = isAutoUnits || multiPatternCarriesAffix(modelFormat);
    const scale = formatWins
      ? { scale: 1, suffix: "" }
      : getDisplayScale(cardUnits, dataMaxAbs);
    const scaledValue = value / scale.scale;
    const decOverride = cardDecimals > 0 ? cardDecimals : undefined;
    const body = formatVarianceValue(scaledValue, modelFormat, locale, decOverride) + scale.suffix;
    return withSign && value > 0 && !body.startsWith("+") ? "+" + body : body;
  }

  // Single-pattern path — delegate to powerbi-visuals-utils-formattingutils.
  // `value` parameter to vf.create: 0 = no scaling, 1e3 = K, 1e6 = M, 1e9 = bn.
  // The 1001 trick (SimpleWaterfall) forces the K suffix to show even for
  // small thousands so `1.2K` doesn't render as `1,234`.
  let scaleValue: number;
  if (cardUnits === "thousands") {
    scaleValue = 1e3;
  } else if (cardUnits === "millions") {
    scaleValue = 1e6;
  } else if (cardUnits === "billions") {
    scaleValue = 1e9;
  } else if (cardUnits === "none") {
    scaleValue = 0;
  } else {
    // "auto" or undefined
    if (hasModelFormat) {
      scaleValue = 0; // verbatim — let the format string carry %/currency/etc.
    } else if (dataMaxAbs >= 1e9) {
      scaleValue = 1e9;
    } else if (dataMaxAbs >= 1e6) {
      scaleValue = 1e6;
    } else if (dataMaxAbs >= 1e3) {
      scaleValue = 1001;
    } else {
      scaleValue = 0;
    }
  }

  // Precision policy:
  //   - User overrode (`cardDecimals > 0`) → take it as-is.
  //   - Else, if the format string has its own decimal portion (`.00`),
  //     let the format string drive precision (omit the field).
  //   - Else, fall back to autoDecimals on auto units / 0 on explicit units.
  const createOpts: {
    cultureSelector: string;
    format?: string;
    value: number;
    precision?: number;
  } = {
    cultureSelector: locale,
    value: scaleValue
  };
  if (hasModelFormat) createOpts.format = modelFormat;
  if (cardDecimals > 0) {
    createOpts.precision = cardDecimals;
  } else if (!hasModelFormat) {
    createOpts.precision =
      !cardUnits || cardUnits === "auto" ? autoDecimals : 0;
  }
  const formatter = pbiValueFormatter.create(createOpts);
  const body = formatter.format(value);
  return withSign && value > 0 && !body.startsWith("+") ? "+" + body : body;
}
