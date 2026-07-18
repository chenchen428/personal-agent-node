export type MasonryPosition = { x: number; y: number };

export function computeOrderedMasonryLayout(
  heights: number[],
  columnWidth: number,
  columnGap = 12,
  rowGap = 19,
) {
  const columnHeights = [0, 0];
  const positions = heights.map((height, index) => {
    const column = index % 2;
    const position = { x: column * (columnWidth + columnGap), y: columnHeights[column] };
    columnHeights[column] += Math.max(0, height) + rowGap;
    return position;
  });
  const height = positions.length ? Math.max(...columnHeights) - rowGap : 0;
  return { positions, height: Math.max(0, height) };
}
