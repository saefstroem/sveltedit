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
