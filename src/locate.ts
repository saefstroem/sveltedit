export interface Loc {
  file: string;
  line: number;
  column: number;
}

export interface Spot {
  parentElement: Spot | null;
  childNodes: ArrayLike<{ nodeType: number; textContent: string | null }>;
  __svelte_meta?: { loc?: Loc };
}

export function locate(start: Spot | null): { element: Spot; loc: Loc } | undefined {
  const worded = (spot: Spot): boolean => {
    for (const child of Array.from(spot.childNodes)) {
      if (child.nodeType === 3 && (child.textContent ?? "").trim() !== "") return true;
    }
    return false;
  };
  for (let spot = start; spot !== null; spot = spot.parentElement) {
    const loc = spot.__svelte_meta?.loc;
    if (loc !== undefined && worded(spot)) return { element: spot, loc };
  }
  return undefined;
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  const text = (words: string) => ({ nodeType: 3, textContent: words });
  const node = (
    children: { nodeType: number; textContent: string | null }[],
    loc?: Loc,
    parent: Spot | null = null,
  ): Spot =>
    loc === undefined
      ? { parentElement: parent, childNodes: children }
      : { parentElement: parent, childNodes: children, __svelte_meta: { loc } };
  const loc = (line: number): Loc => ({ file: "page.svelte", line, column: 0 });

  it("climbs to the nearest located element that holds visible text", () => {
    const parent = node([text("words")], loc(5));
    const child = node([text("inner")], undefined, parent);
    expect(locate(child)).toEqual({ element: child.parentElement, loc: loc(5) });
    expect(locate(parent)?.loc.line).toBe(5);
  });

  it("skips located elements whose own child text is blank", () => {
    const wrapper = node([{ nodeType: 1, textContent: "nested elements only" }, text("  \n ")], loc(2));
    const target = node([text("real")], loc(9), wrapper);
    expect(locate(target)?.loc.line).toBe(9);
    expect(locate(wrapper)).toBe(undefined);
  });

  it("answers undefined with nothing to find", () => {
    expect(locate(null)).toBe(undefined);
    expect(locate(node([text("plain")]))).toBe(undefined);
  });
}
