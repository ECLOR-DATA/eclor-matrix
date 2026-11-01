// build-test-report.mjs — (re)generates audit/test-report/ for the cert audit loop.
//
// Model  = the shared demo base (sample/base/semantic-model, Financial Sample)
//          + IBCS scenario measures (PY, Plan) + the hostile scenario tables
//          already living in test-report.SemanticModel (Nulls, Negatives, …).
// Report = one page per IBCS template (T01-T04) on the demo base, then the
//          nominal / interactions / formats / edge-case pages, all bound to
//          the packaged Eclor Matrix (dist/*.pbiviz embedded as a private visual).
//
// Usage: node audit/tools/build-test-report.mjs   (after `npm run package`)
// Idempotent: owns test-report.Report/definition/pages and CustomVisuals/.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tr = path.join(repo, "audit", "test-report");
const sm = path.join(tr, "test-report.SemanticModel", "definition");
const rp = path.join(tr, "test-report.Report");
const base = path.join(repo, "sample", "base");
const pbiviz = JSON.parse(fs.readFileSync(path.join(repo, "pbiviz.json"), "utf8"));
const GUID = pbiviz.visual.guid;
const VERSION = pbiviz.visual.version;

const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");
};

// ---------------------------------------------------------------- model --
const SCENARIO_TABLES = ["Nominal", "Nulls", "Negatives", "HostileLabels", "OneRow", "TwoRows", "Huge10k", "KPI"];
for (const f of ["DIM_TIME.tmdl", "FACT_ECLOR_FINANCIALS.tmdl"]) {
  fs.copyFileSync(path.join(base, "semantic-model", "tables", f), path.join(sm, "tables", f));
}
// IBCS scenario measures on top of the base (names chosen so the visual's
// token detection reads them as AC / PY / BU without any override).
const measures = fs
  .readFileSync(path.join(base, "semantic-model", "tables", "_MEASURES.tmdl"), "utf8")
  .replace(
    /\n\tpartition _MEASURES/,
    [
      "",
      // Same months as the actuals: Financial Sample 2026 only covers Sep-Dec,
      // a full-year PY would make every variance look like -70 %.
      "\tmeasure PY = CALCULATE([Actual], SAMEPERIODLASTYEAR(CALCULATETABLE(VALUES('DIM_TIME'[Date]), FACT_ECLOR_FINANCIALS)))",
      "\t\tformatString: #,0",
      "\t\tdisplayFolder: IBCS",
      "\t\tlineageTag: 6f1c2a10-5e2b-4c1e-9d0a-1b2c3d4e5f60",
      "",
      "\tmeasure Plan = ROUND([PY] * 1.05, 0)",
      "\t\tformatString: #,0",
      "\t\tdisplayFolder: IBCS",
      "\t\tlineageTag: 6f1c2a10-5e2b-4c1e-9d0a-1b2c3d4e5f61",
      "",
      "\tpartition _MEASURES"
    ].join("\n")
  );
write(path.join(sm, "tables", "_MEASURES.tmdl"), measures);
write(
  path.join(sm, "expressions.tmdl"),
  fs
    .readFileSync(path.join(base, "semantic-model", "expressions.tmdl"), "utf8")
    .replace(/"C:\\pbiviz\\sample-base"/, `"${base.replace(/\//g, "\\")}"`)
);
fs.copyFileSync(path.join(base, "semantic-model", "relationships.tmdl"), path.join(sm, "relationships.tmdl"));
write(
  path.join(sm, "model.tmdl"),
  [
    "model Model",
    "\tculture: en-US",
    "\tdefaultPowerBIDataSourceVersion: powerBI_V3",
    "\tsourceQueryCulture: en-US",
    "\tdataAccessOptions",
    "\t\tlegacyRedirects",
    "\t\treturnErrorValuesAsNull",
    "",
    "annotation __PBI_TimeIntelligenceEnabled = 0",
    "",
    'annotation PBI_ProTooling = ["DevMode"]',
    "",
    ...["_MEASURES", "FACT_ECLOR_FINANCIALS", "DIM_TIME", ...SCENARIO_TABLES].map((t) => `ref table ${t}`),
    ""
  ].join("\n")
);

// ------------------------------------------------------- custom visual --
const cv = path.join(rp, "CustomVisuals");
fs.rmSync(cv, { recursive: true, force: true });
const pkg = path.join(repo, "dist", `${GUID}.${VERSION}.pbiviz`);
if (!fs.existsSync(pkg)) throw new Error(`missing ${pkg} — run npm run package first`);
fs.mkdirSync(path.join(cv, GUID), { recursive: true });
execFileSync("powershell", [
  "-NoProfile",
  "-Command",
  `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory('${pkg}', '${path.join(cv, GUID)}')`
]);

// --------------------------------------------------------- PBIR helpers --
const lit = (v) => ({ expr: { Literal: { Value: v } } });
const str = (s) => lit(`'${s.replace(/'/g, "''")}'`);
const col = (entity, prop) => ({ Column: { Expression: { SourceRef: { Entity: entity } }, Property: prop } });
const meas = (entity, prop) => ({ Measure: { Expression: { SourceRef: { Entity: entity } }, Property: prop } });
const sum = (entity, prop) => ({ Aggregation: { Expression: col(entity, prop), Function: 0 } });
const proj = (field, active = false) => {
  const k = Object.keys(field)[0];
  const ent = (field[k].Expression.SourceRef ?? field[k].Expression.Column.Expression.SourceRef).Entity;
  const prop = field[k].Property ?? field[k].Expression.Column.Property;
  const qr = k === "Aggregation" ? `Sum(${ent}.${prop})` : `${ent}.${prop}`;
  const native = k === "Aggregation" ? `Sum of ${prop}` : prop;
  return { field, queryRef: qr, nativeQueryRef: native, ...(active ? { active: true } : {}) };
};
const inFilter = (name, entity, prop, values, intLiteral = false) => ({
  name,
  field: col(entity, prop),
  type: "Categorical",
  filter: {
    Version: 2,
    From: [{ Name: "t", Entity: entity, Type: 0 }],
    Where: [
      {
        Condition: {
          In: {
            Expressions: [{ Column: { Expression: { SourceRef: { Source: "t" } }, Property: prop } }],
            Values: values.map((v) => [{ Literal: { Value: intLiteral ? `${v}L` : `'${v}'` } }])
          }
        }
      }
    ]
  }
});
const title = (text) => ({
  title: [{ properties: { show: lit("true"), text: str(text) } }]
});

let z = 1000;
const container = (name, pos, visual, extra = {}) => ({
  $schema:
    "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.4.0/schema.json",
  name,
  position: { ...pos, z: (z += 1000), tabOrder: z },
  visual,
  ...extra
});
const matrix = (name, pos, roles, opts = {}) =>
  container(
    name,
    pos,
    {
      visualType: GUID,
      query: {
        queryState: Object.fromEntries(
          Object.entries(roles).map(([role, fields]) => [role, { projections: fields.map((f) => proj(f)) }])
        )
      },
      ...(opts.objects ? { objects: opts.objects } : {}),
      ...(opts.title ? { visualContainerObjects: title(opts.title) } : {}),
      drillFilterOtherVisuals: true
    },
    opts.filters ? { filterConfig: { filters: opts.filters } } : {}
  );

const FULL = { x: 16, y: 16, width: 1248, height: 688 };
const F = "FACT_ECLOR_FINANCIALS";
const M = "_MEASURES";
const year2026 = inFilter("pfYear", "DIM_TIME", "Year", [2026], true);
const salesOnly = inFilter("pfCategory", F, "Category", ["Sales"]);
const scheme = inFilter("vfScheme", F, "Category", ["Gross Sales", "Discounts", "COGS"]);
const scenarios = [meas(M, "Actual"), meas(M, "PY"), meas(M, "Plan")];
const ibcs = (t) => ({ ibcs: [{ properties: { enabled: lit("true"), template: str(t) } }] });

// ---------------------------------------------------------------- pages --
const pages = [
  {
    name: "p01-ibcs-t01",
    displayName: "IBCS T01",
    filters: [year2026, salesOnly],
    visuals: [
      matrix("ibcs-t01", FULL, { rows: [col(F, "Country")], values: scenarios }, {
        objects: ibcs("t01"),
        title: "T01 — Sales 2026 by country: AC · PY · PL, variances as figures"
      })
    ]
  },
  {
    name: "p02-ibcs-t02",
    displayName: "IBCS T02",
    filters: [year2026, salesOnly],
    visuals: [
      matrix("ibcs-t02", FULL, { rows: [col(F, "Country")], values: scenarios }, {
        objects: ibcs("t02"),
        title: "T02 — Sales 2026 by country: variances as bars & pins"
      })
    ]
  },
  {
    name: "p03-ibcs-t03",
    displayName: "IBCS T03",
    filters: [year2026],
    visuals: [
      matrix("ibcs-t03", FULL, { rows: [col(F, "Category")], values: scenarios }, {
        objects: ibcs("t03"),
        title: "T03 — 2026 calculation scheme (Gross Sales + Discounts + COGS = Profit)",
        filters: [scheme]
      })
    ]
  },
  {
    name: "p04-ibcs-t04",
    displayName: "IBCS T04",
    filters: [year2026],
    visuals: [
      matrix("ibcs-t04", FULL, { rows: [col(F, "Category")], values: scenarios }, {
        objects: ibcs("t04"),
        title: "T04 — 2026 calculation scheme: waterfall bars & pins",
        filters: [scheme]
      })
    ]
  },
  {
    name: "p05-nominal",
    displayName: "Nominal",
    filters: [salesOnly],
    visuals: [
      matrix(
        "matrix-nominal",
        FULL,
        { rows: [col(F, "Segment"), col(F, "Country")], columns: [col("DIM_TIME", "Year")], values: [meas(M, "Actual")] },
        { title: "Nominal — Sales by Segment > Country × Year (engine subtotals)" }
      )
    ]
  },
  {
    name: "p06-interactions",
    displayName: "Interactions",
    filters: [salesOnly],
    visuals: [
      matrix("matrix-interactions", { x: 16, y: 16, width: 608, height: 688 }, {
        rows: [col(F, "Country")],
        values: [meas(M, "Actual"), meas(M, "Δ M-1 %")]
      }, { title: "Matrix — click a row to cross-filter" }),
      container("bar-segment", { x: 640, y: 16, width: 624, height: 400 }, {
        visualType: "clusteredBarChart",
        query: {
          queryState: {
            Category: { projections: [proj(col(F, "Segment"), true)] },
            Y: { projections: [proj(meas(M, "Actual"))] }
          }
        },
        drillFilterOtherVisuals: true
      }),
      container("slicer-product", { x: 640, y: 432, width: 624, height: 272 }, {
        visualType: "slicer",
        query: { queryState: { Values: { projections: [proj(col(F, "Product"), true)] } } },
        objects: { data: [{ properties: { mode: str("Basic") } }] },
        drillFilterOtherVisuals: true
      })
    ]
  },
  {
    name: "p07-formats",
    displayName: "Formats",
    visuals: [
      matrix("matrix-formats", FULL, {
        rows: [col("Nominal", "Category")],
        values: [meas("KPI", "Total Actual"), meas("KPI", "Pct"), meas("KPI", "Precise")]
      }, { title: "Formats — $#,##0 · 0.0% · #,##0.000 from the model" })
    ]
  },
  ...[
    ["p08-nulls", "Nulls", "Nulls"],
    ["p09-negatives", "Negatives", "Negatives"],
    ["p10-hostile", "Hostile labels", "HostileLabels"]
  ].map(([name, displayName, table]) => ({
    name,
    displayName,
    visuals: [
      matrix(`matrix-${table.toLowerCase()}`, FULL, {
        rows: [col(table, "Category")],
        values: [sum(table, "Actual"), sum(table, "Variance")]
      }, { title: `${displayName} scenario` })
    ]
  })),
  {
    name: "p11-multi",
    displayName: "Multi-instance",
    visuals: [
      matrix("matrix-onerow", { x: 16, y: 16, width: 400, height: 688 }, {
        rows: [col("OneRow", "Category")],
        values: [sum("OneRow", "Actual")]
      }, { title: "One row" }),
      matrix("matrix-tworows", { x: 432, y: 16, width: 400, height: 688 }, {
        rows: [col("TwoRows", "Category")],
        values: [sum("TwoRows", "Actual")]
      }, { title: "Two rows" }),
      matrix("matrix-nominal2", { x: 848, y: 16, width: 416, height: 688 }, {
        rows: [col("Nominal", "Category")],
        values: [sum("Nominal", "Actual"), sum("Nominal", "Variance")]
      }, { title: "Nominal (3rd instance)", objects: { general: [{ properties: { density: str("compact") } }] } })
    ]
  },
  {
    name: "p12-huge10k",
    displayName: "Huge 10k",
    visuals: [
      matrix("matrix-huge", FULL, {
        rows: [col("Huge10k", "Category")],
        values: [sum("Huge10k", "Actual"), sum("Huge10k", "Variance")]
      }, { title: "10 000 rows — virtual scrolling" })
    ]
  },
  {
    name: "p13-tiny",
    displayName: "Tiny",
    visuals: [
      matrix("matrix-tiny", { x: 8, y: 8, width: 180, height: 140 }, {
        rows: [col("Nominal", "Category")],
        values: [sum("Nominal", "Actual")]
      })
    ]
  },
  {
    name: "p14-gaps",
    displayName: "Gaps",
    filters: [salesOnly],
    visuals: [
      matrix(
        "matrix-gaps",
        FULL,
        {
          rows: [col(F, "Country")],
          columns: [col("DIM_TIME", "Year"), col("DIM_TIME", "Quarter")],
          values: [meas(M, "Actual")]
        },
        {
          title: "Gaps — blank column between groups keeps the Year > Quarter header",
          objects: { grid: [{ properties: { gapColumns: lit("true") } }] }
        }
      )
    ]
  },
  {
    name: "p15-t04-multi",
    displayName: "T04 multi",
    filters: [year2026, salesOnly],
    visuals: [
      matrix("ibcs-t04-multi", FULL, { rows: [col(F, "Segment"), col(F, "Country")], values: scenarios }, {
        objects: ibcs("t04"),
        title: "T04 on a two-level hierarchy: each subtotal spans its group's cascade"
      })
    ]
  },
  {
    name: "p16-widths",
    displayName: "Widths",
    filters: [salesOnly],
    visuals: [
      matrix("matrix-widths", FULL, { rows: [col(F, "Country")], values: [meas(M, "Actual"), meas(M, "PY")] }, {
        title: "Custom widths — grips, keyboard resize",
        objects: { columnWidths: [{ properties: { mode: str("custom") } }] }
      })
    ]
  }
];

// --------------------------------------------------------------- report --
const def = path.join(rp, "definition");
fs.rmSync(path.join(def, "pages"), { recursive: true, force: true });
for (const p of pages) {
  write(path.join(def, "pages", p.name, "page.json"), {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.0.0/schema.json",
    name: p.name,
    displayName: p.displayName,
    displayOption: "FitToPage",
    height: 720,
    width: 1280,
    ...(p.filters ? { filterConfig: { filters: p.filters } } : {})
  });
  for (const v of p.visuals) write(path.join(def, "pages", p.name, "visuals", v.name, "visual.json"), v);
}
write(path.join(def, "pages", "pages.json"), {
  $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.0.0/schema.json",
  pageOrder: pages.map((p) => p.name),
  activePageName: pages[0].name
});

const themeName = "eclor-light.theme.json";
write(path.join(rp, "StaticResources", "RegisteredResources", themeName), fs.readFileSync(path.join(base, themeName), "utf8"));
const report = JSON.parse(fs.readFileSync(path.join(def, "report.json"), "utf8"));
report.themeCollection.customTheme = {
  name: themeName,
  reportVersionAtImport: report.themeCollection.baseTheme.reportVersionAtImport,
  type: "RegisteredResources"
};
report.resourcePackages = [
  report.resourcePackages.find((r) => r.type === "SharedResources"),
  { name: "RegisteredResources", type: "RegisteredResources", items: [{ name: themeName, path: themeName, type: "CustomTheme" }] },
  {
    name: GUID,
    type: "CustomVisual",
    items: [{ name: `resources/${GUID}.pbiviz.json`, path: `${GUID}.pbiviz.json`, type: "CustomVisualMetadata" }]
  }
];
write(path.join(def, "report.json"), report);

console.log(`test-report rebuilt: ${pages.length} pages bound to ${GUID} ${VERSION}`);
