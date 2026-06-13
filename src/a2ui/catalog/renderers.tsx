"use client";

import { clsx } from "clsx";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart as RLineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart as RScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RendererProps } from "@copilotkit/a2ui-renderer";

/* The runtime walks `{path}` bindings against the data model before
 * handing props to renderers, so every prop value below is post-resolution. */

const GAP = {
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
  xl: "gap-10",
};
const JUSTIFY = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  spaceBetween: "justify-between",
};
const ALIGN = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

/* CopilotKit brand-accent palette in fixed legend order. */
const CHART_PALETTE = ["#7c70f5", "#3aa37f", "#e89232", "#d5b62c", "#d54b53"];

const fmtNumber = (n: number) =>
  Math.abs(n) >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : Math.abs(n) >= 1_000
      ? `${(n / 1_000).toFixed(1)}k`
      : n.toLocaleString();

/* A delta value is "meaningful" if it has a digit. Bare "+" / "-" or empty
 * strings shouldn't render a badge; that just produces an empty pill. */
const hasMeaningfulDelta = (v?: string) =>
  typeof v === "string" && /\d/.test(v);

/* Reduce verbose delta strings to the badge's job: just the magnitude.
 * Agents sometimes dump comparison prose like "vs. $89,498M in Q4 FY23"
 * into delta when asked about quarterly comparisons. The badge can't hold
 * that without breaking the card layout, so we extract the first signed
 * number/percent token and let the surrounding context (StatCard caption,
 * table cell) carry the comparison text instead. */
const condenseDelta = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length <= 8) return trimmed;
  const patterns = [
    /[+-]\s*\d+(?:[.,]\d+)?\s*%/,
    /\d+(?:[.,]\d+)?\s*%/,
    /[+-]\s*\$?\d+(?:[.,]\d+)?\s*[KMB]?/i,
    /\$?\d+(?:[.,]\d+)?\s*[KMB]?/i,
  ];
  for (const p of patterns) {
    const m = trimmed.match(p);
    if (m) return m[0].replace(/\s+/g, "");
  }
  return trimmed;
};

/* Pull the first number from a free-form string. Handles $X, X.XM, etc.
 * Returns the number's magnitude (sign + numeric value), preserving the
 * order-of-magnitude suffix (k/M/B) when present. */
const parseMoneyish = (s: string): number | null => {
  if (typeof s !== "string") return null;
  const m = s.replace(/[,_]/g, "").match(/(-?\d+(?:\.\d+)?)\s*([kKmMbB]?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  const suffix = (m[2] || "").toLowerCase();
  const mult =
    suffix === "k"
      ? 1_000
      : suffix === "m"
        ? 1_000_000
        : suffix === "b"
          ? 1_000_000_000
          : 1;
  return n * mult;
};

/* When the agent leaves `delta` empty but caption carries a prior-period
 * value like "vs. $89,498M in Q4 FY23", compute the percentage from
 * value vs. that prior number so the user still sees the badge they
 * asked for. Returns a string like "+6.1%" / "-3.0%" or null when we
 * can't extract two comparable numbers. Loose by design: this is a
 * fallback for noisy prompts; the agent should provide its own delta. */
const autoDelta = (value?: string, caption?: string): string | null => {
  if (!value || !caption) return null;
  // Caption needs to look like a comparison. Anchor on "vs.", "from",
  // "compared", "prior", or a leading "$" right after the verb.
  if (!/vs\.|from|compared|prior|previous|last|relative to/i.test(caption)) {
    return null;
  }
  const current = parseMoneyish(value);
  const prior = parseMoneyish(caption);
  if (current == null || prior == null || prior === 0) return null;
  const pct = ((current - prior) / Math.abs(prior)) * 100;
  if (!isFinite(pct)) return null;
  const sign = pct >= 0 ? "+" : "";
  // 1 decimal for sub-10% movements, integer otherwise: easier to scan.
  return `${sign}${Math.abs(pct) < 10 ? pct.toFixed(1) : pct.toFixed(0)}%`;
};

const Stack = ({
  props,
  children,
}: RendererProps<{
  children: string[] | { componentId: string; path: string };
  gap?: keyof typeof GAP;
  align?: keyof typeof ALIGN;
}>) => (
  <div
    className={clsx(
      "flex flex-col",
      GAP[props.gap ?? "md"],
      props.align && ALIGN[props.align],
    )}
  >
    {Array.isArray(props.children)
      ? props.children.map((id) => <Slot key={id} render={children(id)} />)
      : null}
  </div>
);

const Row = ({
  props,
  children,
}: RendererProps<{
  children: string[];
  gap?: keyof typeof GAP;
  justify?: keyof typeof JUSTIFY;
  align?: keyof typeof ALIGN;
}>) => (
  <div
    className={clsx(
      "flex flex-wrap",
      GAP[props.gap ?? "sm"],
      props.justify && JUSTIFY[props.justify],
      ALIGN[props.align ?? "center"],
    )}
  >
    {Array.isArray(props.children)
      ? props.children.map((id) => <Slot key={id} render={children(id)} />)
      : null}
  </div>
);

const Grid = ({
  props,
  children,
}: RendererProps<{
  children: string[];
  columns?: number;
  gap?: keyof typeof GAP;
}>) => {
  const cols = props.columns ?? 3;
  const colMap: Record<number, string> = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
    5: "grid-cols-2 lg:grid-cols-5",
    6: "grid-cols-2 lg:grid-cols-6",
  };
  return (
    <div className={clsx("grid", colMap[cols], GAP[props.gap ?? "md"])}>
      {Array.isArray(props.children)
        ? props.children.map((id) => <Slot key={id} render={children(id)} />)
        : null}
    </div>
  );
};

const Section = ({
  props,
  children,
}: RendererProps<{ title: string; eyebrow?: string; child: string }>) => (
  <section className="flex flex-col gap-3">
    <div className="flex flex-col gap-1">
      {props.eyebrow && (
        <span className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)] font-medium">
          {props.eyebrow}
        </span>
      )}
      <h2 className="text-[18px] font-semibold tracking-tight text-[var(--ink)]">
        {props.title}
      </h2>
    </div>
    {children(props.child)}
  </section>
);

const Card = ({
  props,
  children,
}: RendererProps<{
  child: string;
  tone?: "default" | "lilac" | "mint" | "warning";
}>) => {
  const tones: Record<string, string> = {
    default: "bg-[var(--surface)] border-[var(--line)]",
    lilac:
      "bg-[color-mix(in_oklab,var(--lilac)_8%,white)] border-[var(--lilac)]",
    mint: "bg-[color-mix(in_oklab,var(--mint)_10%,white)] border-[color-mix(in_oklab,var(--mint)_60%,white)]",
    warning:
      "bg-[color-mix(in_oklab,var(--orange)_8%,white)] border-[color-mix(in_oklab,var(--orange)_50%,white)]",
  };
  return (
    <div
      className={clsx(
        "rounded-[var(--radius)] border p-5",
        tones[props.tone ?? "default"],
      )}
    >
      {children(props.child)}
    </div>
  );
};

const Divider = () => <hr className="border-0 border-t border-[var(--line)]" />;

const Heading = ({
  props,
}: RendererProps<{ text: string; level?: "1" | "2" | "3" }>) => {
  const level = props.level ?? "2";
  const Tag = level === "1" ? "h1" : level === "3" ? "h3" : "h2";
  const sizes = {
    "1": "text-[30px] font-semibold tracking-tight leading-[1.1]",
    "2": "text-[20px] font-semibold tracking-tight leading-[1.2]",
    "3": "text-[15px] font-semibold leading-tight",
  } as const;
  return (
    <Tag className={clsx(sizes[level], "text-[var(--ink)]")}>{props.text}</Tag>
  );
};

const Text = ({
  props,
}: RendererProps<{
  text: string;
  tone?: "default" | "muted";
  size?: "sm" | "md" | "lg";
  weight?: "regular" | "medium" | "semibold";
}>) => (
  <p
    className={clsx(
      props.size === "sm"
        ? "text-[13px]"
        : props.size === "lg"
          ? "text-[16px]"
          : "text-[14px]",
      props.tone === "muted" ? "text-[var(--ink)]" : "text-[var(--ink-2)]",
      props.weight === "medium"
        ? "font-medium"
        : props.weight === "semibold"
          ? "font-semibold"
          : "font-normal",
      "leading-relaxed",
    )}
  >
    {props.text}
  </p>
);

const Overline = ({ props }: RendererProps<{ text: string }>) => (
  <span className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)] font-medium">
    {props.text}
  </span>
);

const Badge = ({
  props,
}: RendererProps<{
  label: string;
  tone?: "neutral" | "positive" | "warning" | "danger" | "info";
}>) => {
  const tones = {
    neutral:
      "bg-[var(--surface-soft)] text-[var(--ink-2)] border-[var(--line)]",
    info: "bg-[color-mix(in_oklab,var(--lilac)_18%,white)] text-[#2e2c75] border-[color-mix(in_oklab,var(--lilac)_60%,white)]",
    positive:
      "bg-[color-mix(in_oklab,var(--mint)_18%,white)] text-[#0a5d44] border-[color-mix(in_oklab,var(--mint)_70%,white)]",
    warning:
      "bg-[color-mix(in_oklab,var(--orange)_18%,white)] text-[#7a3f0f] border-[color-mix(in_oklab,var(--orange)_60%,white)]",
    danger:
      "bg-[color-mix(in_oklab,var(--red)_12%,white)] text-[#7a1b22] border-[color-mix(in_oklab,var(--red)_55%,white)]",
  } as const;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] mono uppercase tracking-wider font-medium",
        tones[props.tone ?? "neutral"],
      )}
    >
      {props.label}
    </span>
  );
};

const Callout = ({
  props,
}: RendererProps<{
  body: string;
  title?: string;
  tone?: "info" | "positive" | "warning" | "neutral";
}>) => {
  const tone = props.tone ?? "info";
  const accents: Record<
    typeof tone,
    { bar: string; bg: string; chip: string }
  > = {
    info: {
      bar: "bg-[var(--lilac)]",
      bg: "bg-[color-mix(in_oklab,var(--lilac)_7%,var(--surface))]",
      chip: "text-[#2e2c75]",
    },
    positive: {
      bar: "bg-[var(--mint)]",
      bg: "bg-[color-mix(in_oklab,var(--mint)_8%,var(--surface))]",
      chip: "text-[#0a5d44]",
    },
    warning: {
      bar: "bg-[var(--orange)]",
      bg: "bg-[color-mix(in_oklab,var(--orange)_8%,var(--surface))]",
      chip: "text-[#7a3f0f]",
    },
    neutral: {
      bar: "bg-[var(--ink-2)]",
      bg: "bg-[var(--surface-soft)]",
      chip: "text-[var(--ink)]",
    },
  };
  const a = accents[tone];
  return (
    <div
      className={clsx(
        "relative rounded-[var(--radius)] border border-[var(--line)] pl-4 pr-5 py-4 flex flex-col gap-1.5 overflow-hidden",
        a.bg,
      )}
    >
      <span
        aria-hidden
        className={clsx("absolute left-0 top-0 bottom-0 w-1", a.bar)}
      />
      {props.title && (
        <span
          className={clsx(
            "mono text-[10.5px] uppercase tracking-[0.14em] font-medium",
            a.chip,
          )}
        >
          {props.title}
        </span>
      )}
      <span className="text-[13.5px] leading-relaxed text-[var(--ink-2)]">
        {props.body}
      </span>
    </div>
  );
};

const BulletList = ({
  props,
}: RendererProps<{
  items: string[];
  ordered?: boolean;
}>) => {
  const items = Array.isArray(props.items) ? props.items : [];
  if (!items.length) return null;
  const Tag = props.ordered ? "ol" : "ul";
  // We render markers manually inside each <li>. `display: flex` on the
  // li (which we want for clean alignment) kills the browser's native
  // `list-decimal` / `list-disc` rendering, so for ordered lists we
  // synthesize the "1." / "2." prefix ourselves.
  return (
    <Tag className="flex flex-col gap-2 text-[14px] text-[var(--ink-2)] leading-relaxed list-none pl-0 m-0">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2.5">
          {props.ordered ? (
            <span
              aria-hidden
              className="mono tabular-nums text-[12px] text-[var(--ink)] font-medium leading-relaxed min-w-[1.25rem] flex-none"
            >
              {i + 1}.
            </span>
          ) : (
            <span
              aria-hidden
              className="mt-2 w-1.5 h-1.5 rounded-full bg-[var(--lilac)] flex-none"
            />
          )}
          <span className="flex-1 min-w-0">{it}</span>
        </li>
      ))}
    </Tag>
  );
};

const StatCard = ({
  props,
}: RendererProps<{
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "positive" | "negative" | "neutral";
  caption?: string;
}>) => {
  // Prefer the agent's delta. Fall back to auto-computing from value vs.
  // the prior number in caption when the agent left delta blank.
  const explicitDelta = hasMeaningfulDelta(props.delta)
    ? condenseDelta(props.delta!)
    : null;
  const computedDelta = explicitDelta
    ? null
    : autoDelta(props.value, props.caption);
  const finalDelta = explicitDelta ?? computedDelta;

  // Derive tone from the sign of the computed delta when the agent
  // didn't set deltaTone (or set it incorrectly relative to the actual
  // movement). For explicit deltas, trust the agent's tone choice.
  const inferredTone: "positive" | "negative" | "neutral" =
    computedDelta?.startsWith("-")
      ? "negative"
      : computedDelta?.startsWith("+")
        ? "positive"
        : (props.deltaTone ?? "neutral");
  const effectiveTone = explicitDelta
    ? (props.deltaTone ?? "neutral")
    : inferredTone;

  const deltaClass =
    effectiveTone === "positive"
      ? "text-[#0a5d44] bg-[color-mix(in_oklab,var(--mint)_22%,white)] border-[color-mix(in_oklab,var(--mint)_60%,white)]"
      : effectiveTone === "negative"
        ? "text-[#7a1b22] bg-[color-mix(in_oklab,var(--red)_15%,white)] border-[color-mix(in_oklab,var(--red)_45%,white)]"
        : "text-[var(--ink-2)] bg-[var(--surface-soft)] border-[var(--line)]";

  const arrow =
    effectiveTone === "positive"
      ? "↑"
      : effectiveTone === "negative"
        ? "↓"
        : "→";

  return (
    <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface)] p-5 flex flex-col gap-2.5">
      <span className="mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--ink)] font-medium">
        {props.label}
      </span>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="text-[28px] font-semibold tracking-tight text-[var(--ink)] leading-none tabular-nums">
          {props.value}
        </span>
        {finalDelta && (
          <span
            className={clsx(
              "mono text-[11px] px-1.5 py-0.5 rounded-md border font-medium tabular-nums inline-flex items-center gap-1",
              deltaClass,
            )}
          >
            <span aria-hidden>{arrow}</span>
            {finalDelta}
          </span>
        )}
      </div>
      {props.caption && (
        <span className="text-[12px] text-[var(--ink)] leading-snug">
          {props.caption}
        </span>
      )}
    </div>
  );
};

type Series = { label: string; value: number }[];

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 12,
  padding: "6px 10px",
  color: "var(--ink)",
  boxShadow: "0 4px 12px -2px rgba(10, 10, 15, 0.08)",
};

/* Per-item text inside the tooltip. Recharts otherwise inherits the
 * series fill color (light lilac for our charts), which renders as
 * washed-out text. Force a saturated dark purple so the numbers stay
 * readable and on-brand. */
const tooltipItemStyle = {
  color: "#3b3a8a",
  fontSize: 12,
  fontWeight: 500,
};
const tooltipLabelStyle = {
  color: "var(--ink)",
  fontSize: 11,
  fontWeight: 600,
  marginBottom: 2,
};

const axisTickStyle = {
  fontSize: 11,
  fill: "var(--ink)",
  fontWeight: 500,
};

/* If long or many x-axis labels would collide, rotate them and let
 * recharts auto-skip overlapping ones. The threshold is conservative:
 * any label over 6 chars OR more than 6 data points → angle. */
function xAxisProps(data: Series) {
  const maxLen = data.reduce((m, d) => Math.max(m, (d.label ?? "").length), 0);
  const tilt = maxLen > 6 || data.length > 6;
  return {
    angle: tilt ? -28 : 0,
    height: tilt ? 56 : 24,
    textAnchor: tilt ? ("end" as const) : ("middle" as const),
    interval: "preserveStartEnd" as const,
    minTickGap: 8,
    dy: tilt ? 4 : 0,
  };
}

const BarChart = ({
  props,
}: RendererProps<{ data: Series; height?: number }>) => {
  const data = props.data ?? [];
  const xa = xAxisProps(data);
  return (
    <div style={{ width: "100%", height: props.height ?? 240 }}>
      <ResponsiveContainer>
        <RBarChart
          data={data}
          margin={{ top: 24, right: 12, left: 4, bottom: xa.angle ? 16 : 4 }}
        >
          <CartesianGrid
            stroke="var(--line-2)"
            vertical={false}
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="label"
            tick={axisTickStyle}
            axisLine={false}
            tickLine={false}
            angle={xa.angle}
            height={xa.height}
            textAnchor={xa.textAnchor}
            interval={xa.interval}
            minTickGap={xa.minTickGap}
            dy={xa.dy}
          />
          <YAxis
            tick={axisTickStyle}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={fmtNumber}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            itemStyle={tooltipItemStyle}
            labelStyle={tooltipLabelStyle}
            cursor={{ fill: "var(--lilac-softer)" }}
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="var(--lilac)">
            <LabelList
              dataKey="value"
              position="top"
              style={{ fontSize: 11, fontWeight: 600, fill: "var(--ink)" }}
              formatter={(v: unknown) => fmtNumber(Number(v))}
            />
          </Bar>
        </RBarChart>
      </ResponsiveContainer>
    </div>
  );
};

const LineChart = ({
  props,
}: RendererProps<{ data: Series; height?: number }>) => {
  const data = props.data ?? [];
  const xa = xAxisProps(data);
  return (
    <div style={{ width: "100%", height: props.height ?? 240 }}>
      <ResponsiveContainer>
        <RLineChart
          data={data}
          margin={{ top: 24, right: 16, left: 4, bottom: xa.angle ? 16 : 4 }}
        >
          <CartesianGrid
            stroke="var(--line-2)"
            vertical={false}
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="label"
            tick={axisTickStyle}
            axisLine={false}
            tickLine={false}
            angle={xa.angle}
            height={xa.height}
            textAnchor={xa.textAnchor}
            interval={xa.interval}
            minTickGap={xa.minTickGap}
            dy={xa.dy}
          />
          <YAxis
            tick={axisTickStyle}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={fmtNumber}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            itemStyle={tooltipItemStyle}
            labelStyle={tooltipLabelStyle}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#3b3a8a"
            strokeWidth={2.5}
            dot={{
              r: 3.5,
              fill: "var(--lilac)",
              stroke: "#3b3a8a",
              strokeWidth: 1.5,
            }}
            activeDot={{ r: 5 }}
          >
            <LabelList
              dataKey="value"
              position="top"
              style={{ fontSize: 11, fontWeight: 600, fill: "var(--ink)" }}
              formatter={(v: unknown) => fmtNumber(Number(v))}
            />
          </Line>
        </RLineChart>
      </ResponsiveContainer>
    </div>
  );
};

const HorizontalBarChart = ({
  props,
}: RendererProps<{ data: Series; height?: number }>) => {
  const data = props.data ?? [];
  // Auto-size: ~32px per row + padding. Caller can override via height.
  const height = props.height ?? Math.max(180, data.length * 32 + 48);
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <RBarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 56, left: 4, bottom: 8 }}
        >
          <CartesianGrid
            stroke="var(--line-2)"
            horizontal={false}
            strokeDasharray="3 3"
          />
          <XAxis
            type="number"
            tick={axisTickStyle}
            axisLine={false}
            tickLine={false}
            tickFormatter={fmtNumber}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={axisTickStyle}
            axisLine={false}
            tickLine={false}
            width={120}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            itemStyle={tooltipItemStyle}
            labelStyle={tooltipLabelStyle}
            cursor={{ fill: "var(--lilac-softer)" }}
          />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} fill="var(--lilac)">
            <LabelList
              dataKey="value"
              position="right"
              style={{ fontSize: 11, fontWeight: 600, fill: "var(--ink)" }}
              formatter={(v: unknown) => fmtNumber(Number(v))}
            />
          </Bar>
        </RBarChart>
      </ResponsiveContainer>
    </div>
  );
};

type ScatterPoint = { x: number; y: number; label?: string };

const ScatterChart = ({
  props,
}: RendererProps<{
  data: ScatterPoint[];
  xLabel?: string;
  yLabel?: string;
  height?: number;
}>) => {
  const data = props.data ?? [];
  return (
    <div style={{ width: "100%", height: props.height ?? 280 }}>
      <ResponsiveContainer>
        <RScatterChart margin={{ top: 16, right: 24, left: 8, bottom: 28 }}>
          <CartesianGrid stroke="var(--line-2)" strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="x"
            name={props.xLabel ?? "x"}
            tick={axisTickStyle}
            axisLine={false}
            tickLine={false}
            tickFormatter={fmtNumber}
            label={
              props.xLabel
                ? {
                    value: props.xLabel,
                    position: "insideBottom",
                    offset: -8,
                    style: { fontSize: 11, fill: "var(--ink)" },
                  }
                : undefined
            }
          />
          <YAxis
            type="number"
            dataKey="y"
            name={props.yLabel ?? "y"}
            tick={axisTickStyle}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={fmtNumber}
            label={
              props.yLabel
                ? {
                    value: props.yLabel,
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 11, fill: "var(--ink)" },
                  }
                : undefined
            }
          />
          <Tooltip
            contentStyle={tooltipStyle}
            itemStyle={tooltipItemStyle}
            labelStyle={tooltipLabelStyle}
            cursor={{ strokeDasharray: "3 3" }}
            formatter={(v: unknown, name: unknown) => [
              fmtNumber(Number(v)),
              name == null ? "" : String(name),
            ]}
          />
          <Scatter
            data={data}
            fill="var(--lilac)"
            stroke="#3b3a8a"
            strokeWidth={1.5}
          />
        </RScatterChart>
      </ResponsiveContainer>
    </div>
  );
};

const DonutChart = ({
  props,
}: RendererProps<{ data: Series; height?: number }>) => {
  const data = props.data ?? [];
  const total = data.reduce((s, d) => s + d.value, 0);
  const height = props.height ?? 240;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer>
          <PieChart>
            <Tooltip
              contentStyle={tooltipStyle}
              itemStyle={tooltipItemStyle}
              labelStyle={tooltipLabelStyle}
              formatter={(value: unknown, name: unknown) => [
                fmtNumber(Number(value)),
                String(name),
              ]}
            />
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius="60%"
              outerRadius="92%"
              paddingAngle={1.5}
              stroke="var(--surface)"
              strokeWidth={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {/* Total in the middle of the donut */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink)]">
            Total
          </span>
          <span className="text-[20px] font-semibold tracking-tight text-[var(--ink)] tabular-nums leading-tight">
            {fmtNumber(total)}
          </span>
        </div>
      </div>

      {/* External legend with values */}
      <ul className="flex-1 min-w-0 flex flex-col gap-1.5">
        {data.map((d, i) => {
          const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
          return (
            <li
              key={`${d.label}-${i}`}
              className="flex items-center gap-3 text-[13px]"
            >
              <span
                className="w-3 h-3 rounded-sm shrink-0"
                style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }}
              />
              <span className="text-[var(--ink-2)] truncate flex-1 min-w-0">
                {d.label}
              </span>
              <span className="mono tabular-nums text-[12.5px] text-[var(--ink)] font-medium shrink-0">
                {fmtNumber(d.value)}
              </span>
              <span className="mono text-[11px] text-[var(--ink)] shrink-0 w-9 text-right">
                {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const DataTable = ({
  props,
}: RendererProps<{
  columns: { key: string; label: string; align?: "left" | "right" }[];
  rows: Record<string, string | number>[];
}>) => {
  const columns = props.columns ?? [];
  const rows = props.rows ?? [];
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface)]">
      <table className="w-full text-[13.5px] border-collapse">
        <thead className="bg-[var(--surface-soft)]">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={clsx(
                  "px-4 py-2.5 font-medium mono uppercase tracking-[0.1em] text-[10.5px] text-[var(--ink)] border-b border-[var(--line)]",
                  c.align === "right" ? "text-right" : "text-left",
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={clsx(
                "border-b border-[var(--line-2)] last:border-b-0 transition-colors hover:bg-[var(--surface-soft)]",
              )}
            >
              {columns.map((c) => {
                const raw = row[c.key];
                const text = raw == null ? "" : String(raw);
                const looksLikeDelta = c.key === "delta" || c.key === "Δ";
                const meaningful = !looksLikeDelta || hasMeaningfulDelta(text);
                if (looksLikeDelta && meaningful) {
                  const tone = text.trim().startsWith("-")
                    ? "text-[#7a1b22]"
                    : text.trim().startsWith("+")
                      ? "text-[#0a5d44]"
                      : "text-[var(--ink-2)]";
                  return (
                    <td
                      key={c.key}
                      className={clsx(
                        "px-4 py-3 tabular-nums mono text-[12px] font-medium",
                        c.align === "right" ? "text-right" : "text-left",
                        tone,
                      )}
                    >
                      {text}
                    </td>
                  );
                }
                return (
                  <td
                    key={c.key}
                    className={clsx(
                      "px-4 py-3 text-[var(--ink-2)]",
                      c.align === "right"
                        ? "text-right tabular-nums mono text-[13px]"
                        : "text-left",
                    )}
                  >
                    {meaningful ? (
                      (text as ReactNode)
                    ) : (
                      <span className="text-[var(--ink)]">. </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const Button = ({
  props,
  dispatch,
}: RendererProps<{
  label: string;
  variant?: "primary" | "secondary" | "ghost";
  action: { event: { name: string; context?: Record<string, unknown> } };
}>) => {
  const variants = {
    primary: "bg-[var(--ink)] text-white hover:bg-[#1d1d23]",
    secondary:
      "border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--surface-soft)]",
    ghost: "text-[var(--ink)] hover:text-[var(--ink)]",
  };
  return (
    <button
      type="button"
      data-a2ui-action={props.action?.event?.name}
      onClick={() =>
        dispatch?.({ ...props.action, sourceComponentId: undefined } as never)
      }
      className={clsx(
        "inline-flex items-center gap-2 px-4 py-2 rounded-[10px] mono text-[12.5px] font-medium transition",
        variants[props.variant ?? "secondary"],
      )}
    >
      {props.label}
    </button>
  );
};

const ChoiceChips = ({
  props,
  dispatch,
}: RendererProps<{
  label: string;
  options: { label: string; value: string }[];
  value: string | string[];
  multi?: boolean;
}>) => {
  const selected = Array.isArray(props.value)
    ? props.value
    : props.value
      ? [props.value]
      : [];
  return (
    <div className="flex flex-col gap-2">
      <span className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)] font-medium">
        {props.label}
      </span>
      <div className="flex flex-wrap gap-2">
        {(props.options ?? []).map((o) => {
          const isOn = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              onClick={() =>
                dispatch?.({
                  event: {
                    name: "select_chip",
                    context: { value: o.value, label: props.label },
                  },
                } as never)
              }
              className={clsx(
                "px-3 py-1.5 rounded-full text-[12px] border transition mono",
                isOn
                  ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                  : "bg-[var(--surface)] text-[var(--ink-2)] border-[var(--line)] hover:border-[var(--ink-2)]",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/* ── PeerReview.ai custom renderers ──────────────────────────────────────── */

const CodeBlock = ({
  props,
}: RendererProps<{
  code: string;
  language?: string;
  title?: string;
  highlight?: number[];
}>) => {
  const lines = (props.code ?? "").replace(/\n$/, "").split("\n");
  const hl = new Set(props.highlight ?? []);
  return (
    <div className="rounded-[var(--radius)] border border-[var(--line)] overflow-hidden bg-[#0f0f17]">
      {props.title && (
        <div className="px-4 py-2 border-b border-[#23232f] flex items-center gap-2">
          <span className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
          </span>
          <span className="mono text-[11px] text-[#9aa] tracking-wide">{props.title}</span>
        </div>
      )}
      <pre className="overflow-x-auto m-0 py-3 text-[12.5px] leading-[1.6]">
        <code className="mono">
          {lines.map((ln, i) => (
            <div
              key={i}
              className={clsx(
                "px-4 whitespace-pre",
                hl.has(i + 1) ? "bg-[color-mix(in_oklab,#febc2e_18%,transparent)]" : "",
              )}
            >
              <span className="inline-block w-7 mr-3 text-right text-[#54546a] select-none">
                {i + 1}
              </span>
              <span className="text-[#e6e6f0]">{ln || " "}</span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
};

const ReferenceContextPanel = ({
  props,
}: RendererProps<{
  topic: string;
  answer: string;
  sources?: { name: string; url?: string; snippet?: string }[];
  grounded?: boolean;
  usedFor?: string;
  gradingImpact?: string;
}>) => (
  <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface)] p-5 flex flex-col gap-3">
    <div className="flex items-center gap-2 flex-wrap">
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] mono uppercase tracking-wider font-medium bg-[color-mix(in_oklab,var(--lilac)_18%,white)] text-[#2e2c75] border-[color-mix(in_oklab,var(--lilac)_60%,white)]">
        LinkUp
      </span>
      <span
        className={clsx(
          "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] mono uppercase tracking-wider font-medium",
          props.grounded
            ? "bg-[color-mix(in_oklab,var(--mint)_18%,white)] text-[#0a5d44] border-[color-mix(in_oklab,var(--mint)_70%,white)]"
            : "bg-[var(--surface-soft)] text-[var(--ink-2)] border-[var(--line)]",
        )}
      >
        {props.grounded ? "live · grounded" : "offline reference"}
      </span>
      <span className="text-[13px] font-medium text-[var(--ink)]">{props.topic}</span>
    </div>
    <p className="text-[13.5px] leading-relaxed text-[var(--ink-2)]">{props.answer}</p>
    {props.sources && props.sources.length > 0 && (
      <ul className="flex flex-col gap-2 list-none p-0 m-0">
        {props.sources.map((s, i) => (
          <li key={i} className="flex flex-col gap-0.5 border-l-2 border-[var(--lilac)] pl-3">
            {s.url ? (
              <a href={s.url} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-[#3b3a8a] hover:underline">
                {s.name}
              </a>
            ) : (
              <span className="text-[13px] font-medium text-[var(--ink)]">{s.name}</span>
            )}
            {s.snippet && <span className="text-[12px] text-[var(--ink-2)] leading-snug">{s.snippet}</span>}
          </li>
        ))}
      </ul>
    )}
    <div className="rounded-md bg-[color-mix(in_oklab,var(--orange)_8%,var(--surface))] border border-[color-mix(in_oklab,var(--orange)_40%,white)] px-3 py-2">
      <span className="mono text-[10.5px] uppercase tracking-[0.12em] text-[#7a3f0f] font-medium">
        Guardrail
      </span>
      <p className="text-[12px] text-[var(--ink-2)] mt-0.5 leading-snug">
        {props.gradingImpact ?? "Reference used for explanation only — does not affect the score."}
      </p>
    </div>
  </div>
);

const STATUS_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  passed: { dot: "bg-[#28c840]", text: "text-[#0a5d44]", label: "PASS" },
  failed: { dot: "bg-[#d54b53]", text: "text-[#7a1b22]", label: "FAIL" },
  error: { dot: "bg-[#d54b53]", text: "text-[#7a1b22]", label: "ERROR" },
  skipped: { dot: "bg-[#b0b0bb]", text: "text-[var(--ink-2)]", label: "SKIP" },
};

const TestResultsPanel = ({
  props,
}: RendererProps<{
  summary: { total: number; passed: number; failed: number };
  tests: { name: string; status: string; message?: string }[];
  note?: string;
}>) => {
  const s = props.summary ?? { total: 0, passed: 0, failed: 0 };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] mono font-medium bg-[color-mix(in_oklab,var(--mint)_18%,white)] text-[#0a5d44] border-[color-mix(in_oklab,var(--mint)_70%,white)]">
          {s.passed} passed
        </span>
        <span
          className={clsx(
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] mono font-medium",
            s.failed > 0
              ? "bg-[color-mix(in_oklab,var(--red)_12%,white)] text-[#7a1b22] border-[color-mix(in_oklab,var(--red)_55%,white)]"
              : "bg-[var(--surface-soft)] text-[var(--ink-2)] border-[var(--line)]",
          )}
        >
          {s.failed} failed
        </span>
        <span className="text-[12px] text-[var(--ink-2)]">of {s.total} frozen tests · executed for real</span>
      </div>
      {props.note && (
        <div className="rounded-md border border-[color-mix(in_oklab,var(--red)_45%,white)] bg-[color-mix(in_oklab,var(--red)_8%,white)] px-3 py-2 text-[12.5px] text-[#7a1b22]">
          {props.note}
        </div>
      )}
      <ul className="flex flex-col gap-1.5 list-none p-0 m-0">
        {(props.tests ?? []).map((t, i) => {
          const st = STATUS_STYLE[t.status] ?? STATUS_STYLE.skipped;
          return (
            <li key={i} className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={clsx("w-2 h-2 rounded-full shrink-0", st.dot)} />
                <span className="mono text-[12.5px] text-[var(--ink)] truncate flex-1">{t.name}</span>
                <span className={clsx("mono text-[10.5px] font-semibold tracking-wider", st.text)}>{st.label}</span>
              </div>
              {t.status !== "passed" && t.message && (
                <p className="mono text-[11.5px] text-[#7a1b22] mt-1.5 pl-4 leading-snug whitespace-pre-wrap break-words">
                  {t.message}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const MisconceptionPanel = ({
  props,
}: RendererProps<{
  label?: string;
  title: string;
  severity?: string;
  explanation?: string;
  evidence?: string[];
  detected?: boolean;
}>) => {
  const sevTone =
    props.severity === "high"
      ? "bg-[color-mix(in_oklab,var(--red)_14%,white)] text-[#7a1b22] border-[color-mix(in_oklab,var(--red)_55%,white)]"
      : "bg-[color-mix(in_oklab,var(--orange)_16%,white)] text-[#7a3f0f] border-[color-mix(in_oklab,var(--orange)_55%,white)]";
  return (
    <div className="relative rounded-[var(--radius)] border border-[color-mix(in_oklab,var(--orange)_45%,white)] bg-[color-mix(in_oklab,var(--orange)_7%,var(--surface))] pl-4 pr-5 py-4 flex flex-col gap-2 overflow-hidden">
      <span aria-hidden className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--orange)]" />
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[15px] font-semibold text-[var(--ink)]">{props.title}</span>
        {props.severity && (
          <span className={clsx("px-2 py-0.5 rounded-full border text-[10.5px] mono uppercase tracking-wider font-medium", sevTone)}>
            {props.severity}
          </span>
        )}
        {props.label && (
          <span className="px-2 py-0.5 rounded-full border border-[var(--line)] bg-[var(--surface-soft)] text-[10.5px] mono text-[var(--ink-2)]">
            {props.label}
          </span>
        )}
      </div>
      {props.explanation && (
        <p className="text-[13.5px] leading-relaxed text-[var(--ink-2)]">{props.explanation}</p>
      )}
      {props.evidence && props.evidence.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-0.5">
          <span className="mono text-[10.5px] uppercase tracking-[0.12em] text-[#7a3f0f] font-medium">Evidence</span>
          <ul className="flex flex-col gap-1 list-none p-0 m-0">
            {props.evidence.map((e, i) => (
              <li key={i} className="flex items-start gap-2 text-[12.5px] text-[var(--ink-2)] leading-snug">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[var(--orange)] flex-none" />
                <span className="mono">{e}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

type TraceNode = { id: string; x: number; y: number; layer?: number | null };
type GraphTrace = {
  caseName?: string;
  caseStatus?: string;
  caseMessage?: string;
  nodes: TraceNode[];
  edges: { from: string; to: string }[];
  start?: string;
  goal?: string;
  expectedPath?: string[] | null;
  studentPath?: string[] | null;
  expectedEdges?: number | null;
  studentEdges?: number | null;
  isMinimal?: boolean | null;
  studentError?: string | null;
};

const VisualGraphTracePanel = ({
  props,
}: RendererProps<{
  caseName?: string;
  caseStatus?: string;
  caseMessage?: string;
  nodes: TraceNode[];
  edges: { from: string; to: string }[];
  start?: string;
  goal?: string;
  expectedPath?: string[] | null;
  studentPath?: string[] | null;
  expectedEdges?: number | null;
  studentEdges?: number | null;
  isMinimal?: boolean | null;
  studentError?: string | null;
  traces?: GraphTrace[];
}>) => {
  const W = 720;
  const H = 340;
  const PAD = 48;
  const R = 18;
  const traces = props.traces?.length
    ? props.traces
    : [
        {
          caseName: props.caseName,
          caseStatus: props.caseStatus,
          caseMessage: props.caseMessage,
          nodes: props.nodes ?? [],
          edges: props.edges ?? [],
          start: props.start,
          goal: props.goal,
          expectedPath: props.expectedPath,
          studentPath: props.studentPath,
          expectedEdges: props.expectedEdges,
          studentEdges: props.studentEdges,
          isMinimal: props.isMinimal,
          studentError: props.studentError,
        },
      ];
  const [selectedTrace, setSelectedTrace] = useState(0);
  const active = traces[Math.min(selectedTrace, traces.length - 1)] ?? traces[0];
  const nodes = active.nodes ?? [];
  const pos: Record<string, { x: number; y: number; layer: number | null }> = {};
  nodes.forEach((n) => {
    pos[n.id] = {
      x: PAD + n.x * (W - 2 * PAD),
      y: PAD + n.y * (H - 2 * PAD),
      layer: n.layer ?? null,
    };
  });
  const edgeKey = (a: string, b: string) => [a, b].sort().join("--");
  const pairs = (path?: string[] | null) => {
    const s = new Set<string>();
    if (Array.isArray(path)) for (let i = 0; i < path.length - 1; i++) s.add(edgeKey(path[i], path[i + 1]));
    return s;
  };
  const expected = pairs(active.expectedPath);
  const student = pairs(active.studentPath);
  const pathSegments = (path?: string[] | null, offset = 0) => {
    if (!Array.isArray(path)) return [];
    return path.slice(0, -1).flatMap((from, i) => {
      const to = path[i + 1];
      const a = pos[from];
      const b = pos[to];
      if (!a || !b) return [];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ox = (-dy / len) * offset;
      const oy = (dx / len) * offset;
      return [{
        key: `${from}-${to}-${i}`,
        x1: a.x + ox,
        y1: a.y + oy,
        x2: b.x + ox,
        y2: b.y + oy,
        shared: expected.has(edgeKey(from, to)) && student.has(edgeKey(from, to)),
      }];
    });
  };
  const expectedSegments = pathSegments(active.expectedPath, 0);
  const studentSegments = pathSegments(active.studentPath, 0);
  const expectedLayer = expectedSegments.map((s) => ({ ...s, offset: s.shared ? -4 : 0 }));
  const studentLayer = studentSegments.map((s) => ({ ...s, offset: s.shared ? 4 : 0 }));
  const offsetSegment = (s: (typeof expectedSegments)[number] & { offset: number }) => {
    if (!s.offset) return s;
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const len = Math.hypot(dx, dy) || 1;
    const ox = (-dy / len) * s.offset;
    const oy = (dx / len) * s.offset;
    return { ...s, x1: s.x1 + ox, y1: s.y1 + oy, x2: s.x2 + ox, y2: s.y2 + oy };
  };
  const LAYER = ["#ece9fc", "#d6cef8", "#bcb0f2", "#9d8eec", "#7c70f5"];
  const layerFill = (l: number | null) =>
    l == null ? "#e8e8ee" : LAYER[Math.min(l, LAYER.length - 1)];

  return (
    <div className="flex flex-col gap-3">
      {traces.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--ink-2)]">
            Test case
          </span>
          <select
            value={selectedTrace}
            onChange={(e) => setSelectedTrace(Number(e.target.value))}
            className="max-w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-[12.5px] text-[var(--ink)]"
          >
            {traces.map((t, i) => (
              <option key={`${t.caseName ?? "case"}-${i}`} value={i}>
                {t.caseName ?? `Case ${i + 1}`} {t.caseStatus ? `(${t.caseStatus})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] mono font-medium bg-[color-mix(in_oklab,var(--mint)_18%,white)] text-[#0a5d44] border-[color-mix(in_oklab,var(--mint)_70%,white)]">
          expected (BFS): {active.expectedEdges ?? "?"} edges
        </span>
        <span
          className={clsx(
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] mono font-medium",
            active.isMinimal
              ? "bg-[color-mix(in_oklab,var(--mint)_18%,white)] text-[#0a5d44] border-[color-mix(in_oklab,var(--mint)_70%,white)]"
              : "bg-[color-mix(in_oklab,var(--orange)_16%,white)] text-[#7a3f0f] border-[color-mix(in_oklab,var(--orange)_55%,white)]",
          )}
        >
          student: {active.studentEdges ?? (active.studentError ? "error" : "?")} edges
          {active.isMinimal === false ? " - not minimal" : active.isMinimal ? " - minimal" : ""}
        </span>
      </div>

      <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface)] p-2">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
          <defs>
            <marker id="arrow-base" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,1 L7,4 L0,7" fill="none" stroke="var(--line-2)" strokeWidth="1.2" />
            </marker>
          </defs>

          {/* base graph */}
          {active.edges.map((e, i) => {
            const a = pos[e.from];
            const b = pos[e.to];
            if (!a || !b) return null;
            return (
              <line
                key={`e${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--line-2)"
                strokeWidth={1.4}
                markerEnd="url(#arrow-base)"
                opacity={0.38}
              />
            );
          })}

          {/* expected shortest path */}
          {expectedLayer.map((raw) => {
            const s = offsetSegment(raw);
            return (
              <line
                key={`expected-${s.key}`}
                x1={s.x1}
                y1={s.y1}
                x2={s.x2}
                y2={s.y2}
                stroke="#28a06d"
                strokeWidth={3.2}
                strokeLinecap="round"
                opacity={0.96}
              />
            );
          })}

          {/* student's returned path */}
          {studentLayer.map((raw) => {
            const s = offsetSegment(raw);
            return (
              <line
                key={`student-${s.key}`}
                x1={s.x1}
                y1={s.y1}
                x2={s.x2}
                y2={s.y2}
                stroke="#e08a2b"
                strokeWidth={3.2}
                strokeLinecap="round"
                strokeDasharray="7 5"
                opacity={0.96}
              />
            );
          })}

          {/* nodes */}
          {nodes.map((n) => {
            const p = pos[n.id];
            const isStart = n.id === active.start;
            const isGoal = n.id === active.goal;
            return (
              <g key={n.id}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={R}
                  fill={layerFill(n.layer ?? null)}
                  stroke={isStart ? "#28a06d" : isGoal ? "#d54b53" : "#3b3a8a"}
                  strokeWidth={isStart || isGoal ? 3 : 1.5}
                />
                <text
                  x={p.x}
                  y={p.y + 4}
                  textAnchor="middle"
                  fontSize="13"
                  fontWeight={700}
                  fill="#1b1b22"
                  fontFamily="var(--font-mono, monospace)"
                >
                  {n.id}
                </text>
                {(isStart || isGoal) && (
                  <text x={p.x} y={p.y - R - 6} textAnchor="middle" fontSize="9.5" fill="var(--ink-2)" fontFamily="monospace">
                    {isStart ? "START" : "GOAL"}
                  </text>
                )}
                {n.layer != null && (
                  <text x={p.x} y={p.y + R + 13} textAnchor="middle" fontSize="9" fill="var(--ink-2)" fontFamily="monospace">
                    L{n.layer}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-[11.5px] text-[var(--ink-2)]">
        <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 bg-[#28a06d]" /> expected shortest path</span>
        <span className="flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed border-[#e08a2b]" /> student&apos;s returned path</span>
        <span className="flex items-center gap-1.5">L<em className="not-italic">n</em> = BFS distance from start</span>
      </div>
      {active.studentError && (
        <p className="text-[12px] text-[#7a1b22] mono">student function error: {active.studentError}</p>
      )}
      {active.caseMessage && (
        <p className="text-[12px] text-[var(--ink-2)] mono">{active.caseMessage}</p>
      )}
    </div>
  );
};

const GradeApprovalPanel = ({
  props,
  dispatch,
}: RendererProps<{
  criteria: { id: string; label: string; max: number; proposed: number; rationale?: string }[];
  total?: number;
  maxTotal?: number;
  showFailedTestsDefault?: boolean;
  workspaceId?: string;
  submissionId?: string;
  diagnosis?: {
    label?: string;
    title?: string;
    severity?: string;
    explanation?: string;
    evidence?: string[];
    detected?: boolean;
  };
}>) => {
  const criteria = props.criteria ?? [];
  const generatedDiagnosis = props.diagnosis;
  const [scores, setScores] = useState<Record<string, number>>(() =>
    Object.fromEntries(criteria.map((c) => [c.id, c.proposed])),
  );
  const [diagnosisTitle, setDiagnosisTitle] = useState(generatedDiagnosis?.title ?? "");
  const [diagnosisExplanation, setDiagnosisExplanation] = useState(generatedDiagnosis?.explanation ?? "");
  const [diagnosisEvidence, setDiagnosisEvidence] = useState((generatedDiagnosis?.evidence ?? []).join("\n"));
  const [showFailed, setShowFailed] = useState<boolean>(!!props.showFailedTestsDefault);
  const [includeResource, setIncludeResource] = useState<boolean>(false);
  const maxTotal = props.maxTotal ?? criteria.reduce((s, c) => s + c.max, 0);
  const total = criteria.reduce((s, c) => s + (Number(scores[c.id]) || 0), 0);

  const setScore = (id: string, v: number, max: number) =>
    setScores((prev) => ({ ...prev, [id]: Math.max(0, Math.min(max, v)) }));

  return (
    <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface)] p-5 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {criteria.map((c) => (
          <div key={c.id} className="flex items-start gap-3 py-1.5 border-b border-[var(--line-2)] last:border-b-0">
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] font-medium text-[var(--ink)]">{c.label}</div>
              {c.rationale && <div className="text-[12px] text-[var(--ink-2)] leading-snug">{c.rationale}</div>}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setScore(c.id, (Number(scores[c.id]) || 0) - 1, c.max)}
                className="w-7 h-7 rounded-md border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--surface-soft)] mono"
              >
                −
              </button>
              <input
                type="number"
                min={0}
                max={c.max}
                value={scores[c.id]}
                onChange={(e) => setScore(c.id, Number(e.target.value), c.max)}
                className="w-12 h-7 text-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] mono text-[13px] tabular-nums"
              />
              <button
                type="button"
                onClick={() => setScore(c.id, (Number(scores[c.id]) || 0) + 1, c.max)}
                className="w-7 h-7 rounded-md border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--surface-soft)] mono"
              >
                +
              </button>
              <span className="mono text-[12px] text-[var(--ink-2)] w-9 text-right">/ {c.max}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-2)]">Total</span>
        <span className="text-[20px] font-semibold tabular-nums text-[var(--ink)]">
          {total} <span className="text-[var(--ink-2)] text-[14px]">/ {maxTotal}</span>
        </span>
      </div>

      <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface-soft)] p-3 flex flex-col gap-2">
        <div>
          <div className="mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--ink-2)]">
            TA diagnosis
          </div>
          {generatedDiagnosis?.title && (
            <p className="mt-1 text-[11.5px] text-[var(--ink-2)]">
              Generated evidence: {generatedDiagnosis.title}
            </p>
          )}
        </div>
        <input
          value={diagnosisTitle}
          onChange={(e) => setDiagnosisTitle(e.target.value)}
          placeholder="Diagnosis title"
          className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--lilac)]"
        />
        <textarea
          value={diagnosisExplanation}
          onChange={(e) => setDiagnosisExplanation(e.target.value)}
          placeholder="Explain what the student should learn from this review."
          className="min-h-20 resize-y rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2 text-[12.5px] leading-relaxed text-[var(--ink)] outline-none focus:border-[var(--lilac)]"
        />
        <textarea
          value={diagnosisEvidence}
          onChange={(e) => setDiagnosisEvidence(e.target.value)}
          placeholder="Optional evidence or TA note, one item per line."
          className="min-h-16 resize-y rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2 text-[12px] leading-relaxed text-[var(--ink)] outline-none focus:border-[var(--lilac)] mono"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-[13px] text-[var(--ink-2)] cursor-pointer">
          <input type="checkbox" checked={showFailed} onChange={(e) => setShowFailed(e.target.checked)} />
          Show failed tests to the student in the feedback
        </label>
        <label className="flex items-center gap-2 text-[13px] text-[var(--ink-2)] cursor-pointer">
          <input type="checkbox" checked={includeResource} onChange={(e) => setIncludeResource(e.target.checked)} />
          Include the LinkUp learning resource in the feedback
        </label>
      </div>

      <button
        type="button"
        data-a2ui-action="approve_grades"
        onClick={() =>
          dispatch?.({
            event: {
              name: "approve_grades",
              context: {
                workspaceId: props.workspaceId,
                submissionId: props.submissionId,
                scores,
                showFailedTests: showFailed,
                includeResource,
                diagnosis: {
                  label: generatedDiagnosis?.label,
                  severity: generatedDiagnosis?.severity,
                  title: diagnosisTitle,
                  explanation: diagnosisExplanation,
                  evidence: diagnosisEvidence
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean),
                },
              },
            },
          } as never)
        }
        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[10px] mono text-[13px] font-medium bg-[var(--ink)] text-white hover:bg-[#1d1d23] transition"
      >
        Approve grades &amp; generate feedback
      </button>
    </div>
  );
};

const CopyFeedbackPanel = ({
  props,
}: RendererProps<{
  text: string;
  filename?: string;
}>) => {
  const [copied, setCopied] = useState(false);
  const text = props.text ?? "";
  const safeFilename = (props.filename || "feedback.txt").replace(/[^a-z0-9_.-]+/gi, "_");

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = safeFilename.endsWith(".txt") ? safeFilename : `${safeFilename}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface)] p-3 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--ink-2)]">
          Feedback handoff
        </div>
        <div className="text-[12.5px] text-[var(--ink-2)]">
          Copy or download the student-facing feedback as plain text.
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded-lg border border-[var(--line)] bg-[var(--surface-soft)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--ink)] hover:border-[var(--lilac)]"
        >
          {copied ? "Copied" : "Copy feedback"}
        </button>
        <button
          type="button"
          onClick={download}
          className="rounded-lg bg-[var(--ink)] px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-[#1d1d23]"
        >
          Download .txt
        </button>
      </div>
    </div>
  );
};

const CaseComparisonPanel = ({
  props,
}: RendererProps<{
  cases: { name: string; status: string; input: string; expected: string; actual: string }[];
}>) => {
  const cases = props.cases ?? [];
  return (
    <div className="flex flex-col gap-2">
      {cases.map((c, i) => {
        const passed = c.status === "passed";
        return (
          <div
            key={i}
            className={clsx(
              "rounded-[var(--radius)] border px-3 py-2.5",
              passed
                ? "border-[var(--line)] bg-[var(--surface)]"
                : "border-[color-mix(in_oklab,var(--red)_45%,white)] bg-[color-mix(in_oklab,var(--red)_6%,var(--surface))]",
            )}
          >
            <div className="flex items-center gap-2">
              <span className={clsx("w-2 h-2 rounded-full shrink-0", passed ? "bg-[#28c840]" : "bg-[#d54b53]")} />
              <span className="text-[13px] font-medium text-[var(--ink)] flex-1 min-w-0 truncate">{c.name}</span>
              <span className={clsx("mono text-[10.5px] font-semibold tracking-wider", passed ? "text-[#0a5d44]" : "text-[#7a1b22]")}>
                {passed ? "PASS" : "FAIL"}
              </span>
            </div>
            <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px] mono">
              <span className="text-[var(--ink)]">input</span>
              <span className="text-[var(--ink-2)] truncate">{c.input}</span>
              <span className="text-[var(--ink)]">expected</span>
              <span className="text-[#0a5d44] truncate">{c.expected}</span>
              {!passed && (
                <>
                  <span className="text-[var(--ink)]">actual</span>
                  <span className="text-[#7a1b22] truncate">{c.actual}</span>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

function Slot({ render }: { render: ReactNode }) {
  return <>{render}</>;
}

export const renderers = {
  Stack,
  Row,
  Grid,
  Section,
  Card,
  Divider,
  Heading,
  Text,
  Overline,
  Badge,
  Callout,
  BulletList,
  StatCard,
  BarChart,
  HorizontalBarChart,
  LineChart,
  DonutChart,
  ScatterChart,
  DataTable,
  Button,
  ChoiceChips,
  CodeBlock,
  ReferenceContextPanel,
  TestResultsPanel,
  MisconceptionPanel,
  VisualGraphTracePanel,
  GradeApprovalPanel,
  CopyFeedbackPanel,
  CaseComparisonPanel,
};
