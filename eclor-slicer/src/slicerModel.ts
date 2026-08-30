// PURE slicer tree model — no host coupling, fully testable (same discipline
// as eclor-matrix's matrixModel.ts). Builds an N-level tree from the
// categorical DataView's parallel category columns (leaf-grain cross-join),
// computes search visibility, selection tri-state and the value/count
// aggregates displayed next to each item.

/** Raw cell value as delivered by the host at leaf grain. */
export type RawValue = string | number | boolean | Date | null;

export interface SlicerNode {
  /** Display string (null → "(Blank)" is resolved by the caller's locale). */
  label: string;
  /** Raw values from the root down to this node (length = level + 1). */
  rawPath: RawValue[];
  /** JSON path key — stable identity for selection / expansion sets. */
  key: string;
  level: number;
  parent: SlicerNode | null;
  children: SlicerNode[];
  /** Number of leaf rows under this node. */
  count: number;
  /** Sum of the bound measure under this node (null when no measure). */
  value: number | null;
}

export interface SlicerTree {
  root: SlicerNode;
  /** Total number of leaf nodes. */
  leafCount: number;
  /** Number of levels (bound category columns). */
  levelCount: number;
  /** Max |value| across leaf nodes — display-unit auto-scale input. */
  maxAbsValue: number;
}

/** Serialise a raw path into a stable string key. Date → ISO so keys survive
 *  re-parses; everything else via JSON (distinguishes 1 vs "1" vs null). */
export function pathKey(rawPath: RawValue[]): string {
  return JSON.stringify(rawPath.map((v) => (v instanceof Date ? v.toISOString() : v)));
}

/** Build the tree from parallel level arrays (one per bound field, all the
 *  same length = leaf row count) plus an optional measure array. */
export function buildTree(levels: RawValue[][], measure?: (number | null)[]): SlicerTree {
  const root: SlicerNode = {
    label: "",
    rawPath: [],
    key: "[]",
    level: -1,
    parent: null,
    children: [],
    count: 0,
    value: measure ? 0 : null
  };
  const levelCount = levels.length;
  const rowCount = levelCount > 0 ? levels[0].length : 0;
  let maxAbsValue = 0;

  for (let r = 0; r < rowCount; r++) {
    let node = root;
    for (let l = 0; l < levelCount; l++) {
      const raw = levels[l][r] ?? null;
      const label = rawToLabel(raw);
      let child = node.children.length > 0 ? node.children[node.children.length - 1] : undefined;
      // Rows arrive sorted by the host query, so consecutive rows share
      // prefixes — checking the last child first keeps the build O(rows).
      if (!child || child.label !== label || !sameRaw(child.rawPath[l], raw)) {
        child = findChild(node, l, raw, label);
      }
      if (!child) {
        child = {
          label,
          rawPath: [...node.rawPath, raw],
          key: "",
          level: l,
          parent: node,
          children: [],
          count: 0,
          value: measure ? 0 : null
        };
        child.key = pathKey(child.rawPath);
        node.children.push(child);
      }
      node = child;
    }
    // Walk back up accumulating counts / measure.
    const mv = measure ? coerceNumber(measure[r]) : null;
    let up: SlicerNode | null = node;
    while (up) {
      up.count += 1;
      if (measure && mv !== null) up.value = (up.value ?? 0) + mv;
      up = up.parent;
    }
    if (mv !== null && Math.abs(mv) > maxAbsValue) maxAbsValue = Math.abs(mv);
  }

  return { root, leafCount: rowCount, levelCount, maxAbsValue };
}

function findChild(node: SlicerNode, level: number, raw: RawValue, label: string): SlicerNode | undefined {
  for (const c of node.children) {
    if (c.label === label && sameRaw(c.rawPath[level], raw)) return c;
  }
  return undefined;
}

function sameRaw(a: RawValue | undefined, b: RawValue): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

export function rawToLabel(raw: RawValue): string {
  if (raw === null || raw === undefined) return "";
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return String(raw);
}

function coerceNumber(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

// ---------- Search ----------

/** Locale-tolerant normalisation: lowercase + strip combining accents so
 *  "élé" matches "Electronique". */
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** TRUE when the node itself matches the (already normalised) needle. */
export function nodeMatches(node: SlicerNode, needle: string): boolean {
  if (!needle) return true;
  return normalizeSearch(node.label).includes(needle);
}

/** TRUE when the node or any descendant matches — drives tree visibility
 *  while searching (ancestors of a match stay visible as context). */
export function subtreeMatches(node: SlicerNode, needle: string): boolean {
  if (nodeMatches(node, needle)) return true;
  for (const c of node.children) {
    if (subtreeMatches(c, needle)) return true;
  }
  return false;
}

// ---------- Selection tri-state ----------

export type CheckState = "on" | "off" | "partial";

/** A node reads "on" when itself or an ancestor is in the selected set,
 *  "partial" when only part of its subtree is selected. */
export function checkState(node: SlicerNode, selected: ReadonlySet<string>): CheckState {
  if (selfOrAncestorSelected(node, selected)) return "on";
  if (anyDescendantSelected(node, selected)) return "partial";
  return "off";
}

function selfOrAncestorSelected(node: SlicerNode, selected: ReadonlySet<string>): boolean {
  let n: SlicerNode | null = node;
  while (n && n.level >= 0) {
    if (selected.has(n.key)) return true;
    n = n.parent;
  }
  return false;
}

function anyDescendantSelected(node: SlicerNode, selected: ReadonlySet<string>): boolean {
  for (const c of node.children) {
    if (selected.has(c.key) || anyDescendantSelected(c, selected)) return true;
  }
  return false;
}

/** Toggle a node in the selected set. Selecting a node prunes any selected
 *  descendants (the parent now covers them); deselecting a node whose
 *  ancestor is selected re-expresses the ancestor as its other children so
 *  unticking one leaf under a ticked parent behaves like users expect. */
export function toggleNode(node: SlicerNode, selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  if (checkState(node, selected) === "on") {
    if (next.has(node.key)) {
      next.delete(node.key);
      pruneDescendants(node, next);
    } else {
      // Covered by a selected ancestor: split the ancestor.
      let anc: SlicerNode | null = node.parent;
      let selectedAnc: SlicerNode | null = null;
      while (anc && anc.level >= 0) {
        if (next.has(anc.key)) {
          selectedAnc = anc;
          break;
        }
        anc = anc.parent;
      }
      if (selectedAnc) {
        next.delete(selectedAnc.key);
        // Re-select every sibling branch except the path to `node`.
        let pathChild: SlicerNode = node;
        while (pathChild.parent && pathChild.parent !== selectedAnc) pathChild = pathChild.parent;
        for (const c of selectedAnc.children) {
          if (c !== pathChild) next.add(c.key);
        }
        // Recurse down the path: select node's siblings at each level.
        let cursor: SlicerNode = pathChild;
        while (cursor !== node) {
          let deeper: SlicerNode = node;
          while (deeper.parent && deeper.parent !== cursor) deeper = deeper.parent;
          for (const c of cursor.children) {
            if (c !== deeper) next.add(c.key);
          }
          cursor = deeper;
        }
      }
    }
  } else {
    next.add(node.key);
    pruneDescendants(node, next);
    collapseIfComplete(node.parent, next);
  }
  return next;
}

function pruneDescendants(node: SlicerNode, selected: Set<string>): void {
  for (const c of node.children) {
    selected.delete(c.key);
    pruneDescendants(c, selected);
  }
}

/** When every child of `parent` is selected, replace them with the parent
 *  itself — keeps the set (and the resulting filter) minimal. */
function collapseIfComplete(parent: SlicerNode | null, selected: Set<string>): void {
  if (!parent || parent.level < 0 || parent.children.length === 0) return;
  if (parent.children.every((c) => selected.has(c.key))) {
    for (const c of parent.children) selected.delete(c.key);
    selected.add(parent.key);
    collapseIfComplete(parent.parent, selected);
  }
}

// ---------- Visible flattening ----------

export interface VisibleItem {
  node: SlicerNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  state: CheckState;
  matches: boolean;
}

/** Flatten the tree into the ordered list of visible items given the
 *  expansion set and the search text. While searching, matched subtrees are
 *  force-expanded so results are reachable without manual clicks. */
export function flattenVisible(
  tree: SlicerTree,
  expanded: ReadonlySet<string>,
  searchText: string,
  selected: ReadonlySet<string>
): VisibleItem[] {
  const needle = normalizeSearch(searchText.trim());
  const out: VisibleItem[] = [];
  const walk = (node: SlicerNode, depth: number): void => {
    for (const c of node.children) {
      if (needle && !subtreeMatches(c, needle)) continue;
      const hasChildren = c.children.length > 0;
      const isExpanded = hasChildren && (expanded.has(c.key) || (!!needle && !nodeMatches(c, needle)));
      out.push({
        node: c,
        depth,
        hasChildren,
        expanded: isExpanded,
        state: checkState(c, selected),
        matches: nodeMatches(c, needle)
      });
      if (isExpanded) walk(c, depth + 1);
    }
  };
  walk(tree.root, 0);
  return out;
}

/** Selected nodes in display order, pruned of covered descendants — feeds
 *  the badge (chip) row and the filter builder. */
export function selectedNodesInOrder(tree: SlicerTree, selected: ReadonlySet<string>): SlicerNode[] {
  const out: SlicerNode[] = [];
  const walk = (node: SlicerNode): void => {
    for (const c of node.children) {
      if (selected.has(c.key)) {
        out.push(c);
      } else {
        walk(c);
      }
    }
  };
  walk(tree.root);
  return out;
}

/** Leaf raw-value tuples under the selected nodes (deduped, document order).
 *  Single-level trees produce 1-tuples; deeper trees full paths. */
export function selectedLeafTuples(tree: SlicerTree, selected: ReadonlySet<string>): RawValue[][] {
  const tuples: RawValue[][] = [];
  const seen = new Set<string>();
  const emitLeaves = (node: SlicerNode): void => {
    if (node.children.length === 0) {
      if (!seen.has(node.key)) {
        seen.add(node.key);
        tuples.push(node.rawPath);
      }
      return;
    }
    for (const c of node.children) emitLeaves(c);
  };
  for (const n of selectedNodesInOrder(tree, selected)) emitLeaves(n);
  return tuples;
}

/** Keys of the currently visible ROOT-level items (search-aware) — the
 *  population "Select all" and "Invert" operate on. */
export function visibleRootKeys(tree: SlicerTree, searchText: string): string[] {
  const needle = normalizeSearch(searchText.trim());
  return tree.root.children
    .filter((c) => !needle || subtreeMatches(c, needle))
    .map((c) => c.key);
}

/** Rebuild a minimal selection set from arbitrary wanted keys (e.g. leaf
 *  tuples restored from a persisted JSON filter): unknown keys are dropped,
 *  fully-selected sibling groups collapse onto their parent so the set stays
 *  identical to what toggleNode would have produced. */
export function normalizeSelection(tree: SlicerTree, keys: Iterable<string>): Set<string> {
  const wanted = new Set(keys);
  const out = new Set<string>();
  const visit = (node: SlicerNode): boolean => {
    if (node.level >= 0 && wanted.has(node.key)) return true;
    if (node.children.length === 0) return false;
    const childSel = node.children.map(visit);
    if (node.level >= 0 && childSel.every(Boolean)) return true;
    node.children.forEach((c, i) => {
      if (childSel[i]) out.add(c.key);
    });
    return false;
  };
  if (visit(tree.root)) {
    for (const c of tree.root.children) out.add(c.key);
  }
  return out;
}

/** Invert: visible root keys not fully selected become selected, previously
 *  selected ones are dropped. Runs on checkState so a partially-selected
 *  branch counts as "not selected" and flips to fully selected. */
export function invertSelection(tree: SlicerTree, searchText: string, selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  const needle = normalizeSearch(searchText.trim());
  for (const c of tree.root.children) {
    if (needle && !subtreeMatches(c, needle)) continue;
    if (checkState(c, selected) === "on") {
      next.delete(c.key);
      pruneDescendants(c, next);
    } else {
      next.add(c.key);
      pruneDescendants(c, next);
    }
  }
  return next;
}
