/**
 * ตัวจัดวางการ์ดของโต๊ะทำงานแบบ row-grid
 * - ใช้กริด 12 คอลัมน์, gap เท่ากันทุกด้าน
 * - การ์ดที่อยู่แถวเดียวกันได้ความสูงเท่ากัน (ความสูงแถว snap ทีละ 8px)
 * - ลดช่องโหว่ด้วยการมองหาการ์ดถัดไปที่พอดีกับพื้นที่เหลือของแถว
 */

export interface PackItem {
  key: string;
  span: number;
  height: number;
}

export interface PackedPosition {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface PackOptions {
  width: number;
  columns?: number;
  gap?: number;
  rowStep?: number;
  minRowHeight?: number;
}

const COLUMNS = 12;
const GAP = 16;
const ROW_STEP = 8;
const MIN_ROW_HEIGHT = 120;

const clampSpan = (span: number, columns: number): number =>
  Math.max(1, Math.min(columns, Math.round(span) || 1));

const percent = (value: number, width: number): number =>
  Math.round((value / width) * 100 * 100) / 100;

/** หาตัวเลือกที่รวม span ได้เท่ากับ target (ใช้เติมแถวให้เต็ม 12 คอลัมน์) */
function findCombination(items: { span: number }[], target: number): number[] | null {
  const picked: number[] = [];
  const walk = (start: number, remaining: number): boolean => {
    if (remaining === 0) return true;
    for (let i = start; i < items.length; i++) {
      if (items[i].span > remaining) continue;
      picked.push(i);
      if (walk(i + 1, remaining - items[i].span)) return true;
      picked.pop();
    }
    return false;
  };
  return walk(0, target) ? [...picked] : null;
}

/**
 * จัดการ์ดเป็นแถว: เติมแถวให้เต็ม 12 คอลัมน์ก่อน แล้วขึ้นแถวใหม่
 * คืนตำแหน่งเป็น % ของความกว้าง (x, w) และ px (y, h) พร้อมลำดับ z
 */
export function packWorkspaceRows(items: PackItem[], options: PackOptions): Record<string, PackedPosition> {
  const columns = options.columns ?? COLUMNS;
  const gap = options.gap ?? GAP;
  const rowStep = options.rowStep ?? ROW_STEP;
  const minRowHeight = options.minRowHeight ?? MIN_ROW_HEIGHT;
  const width = options.width;
  if (!Number.isFinite(width) || width < 40) return {};

  const columnWidth = width / columns;
  const positions: Record<string, PackedPosition> = {};
  const remaining = items.map((item) => ({ ...item, span: clampSpan(item.span, columns) }));
  let row: (PackItem & { span: number })[] = [];
  let spanSum = 0;
  let y = 0;
  let z = 0;

  // ปิดแถวปัจจุบัน: ทุกใบได้ความสูงเท่ากับใบที่สูงสุด และ snap ขึ้นทีละ 8px
  const flush = (): void => {
    if (!row.length) return;
    const tallest = Math.max(...row.map((item) => item.height || 0), minRowHeight);
    const height = Math.max(minRowHeight, Math.ceil(tallest / rowStep) * rowStep);
    let cursor = 0;
    for (const item of row) {
      positions[item.key] = {
        x: percent(cursor * columnWidth + gap / 2, width),
        y,
        w: percent(item.span * columnWidth - gap, width),
        h: height,
        z: z++,
      };
      cursor += item.span;
    }
    y += height + gap;
    row = [];
    spanSum = 0;
  };

  while (remaining.length) {
    // เริ่มแถวใหม่: ถ้าหาชุดการ์ดที่รวม span เต็ม 12 ได้ ให้ใช้ชุดนั้นก่อน
    if (!row.length) {
      const combo = findCombination(remaining, columns);
      if (combo && combo.length) {
        for (const index of [...combo].sort((a, b) => b - a)) row.push(remaining.splice(index, 1)[0]);
        spanSum = columns;
        flush();
        continue;
      }
    }
    const leftover = columns - spanSum;
    // เลือกการ์ดที่ใหญ่ที่สุดที่ยังพอดีกับช่องว่างของแถวนี้ (ถ้าไม่มี ค่อยขึ้นแถวใหม่)
    let index = remaining.findIndex((item) => item.span <= leftover);
    if (index < 0) {
      flush();
      continue;
    }
    if (row.length) {
      let best = index;
      for (let i = index; i < remaining.length; i++) {
        if (remaining[i].span <= leftover && remaining[i].span > remaining[best].span) best = i;
      }
      index = best;
    }
    const [next] = remaining.splice(index, 1);
    row.push(next);
    spanSum += next.span;
    if (spanSum >= columns) flush();
  }
  flush();
  return positions;
}
