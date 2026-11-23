import { describe, expect, it } from 'vitest';
import { packWorkspaceRows } from './workspace-layout';

// คำนวณกล่องจริง (px) จากผลลัพธ์ เพื่อตรวจว่าไม่มีการ์ดซ้อนกัน
function boxes(items: { key: string; span: number; height: number }[], width = 1200) {
  const packed = packWorkspaceRows(items, { width });
  return Object.entries(packed).map(([key, p]) => ({
    key,
    x: (p.x / 100) * width,
    w: (p.w / 100) * width,
    y: p.y,
    h: p.h,
  }));
}

describe('packWorkspaceRows', () => {
  it('จัดเต็มแถว 12 คอลัมน์ และให้การ์ดในแถวสูงเท่ากัน', () => {
    const packed = packWorkspaceRows(
      [
        { key: 'a', span: 6, height: 300 },
        { key: 'b', span: 6, height: 120 },
        { key: 'c', span: 12, height: 180 },
      ],
      { width: 1200 },
    );
    expect(packed['a'].h).toBe(304); // snap ขึ้นทีละ 8 จาก 300
    expect(packed['b'].h).toBe(304);
    expect(packed['a'].y).toBe(0);
    expect(packed['b'].y).toBe(0);
    expect(packed['c'].y).toBe(304 + 16);
    expect(packed['c'].h).toBe(184);
  });

  it('ไม่มีการ์ดซ้อนกันและความสูงอยู่ในกริด 8px', () => {
    const items = [
      { key: 'a', span: 12, height: 183 },
      { key: 'b', span: 6, height: 343 },
      { key: 'c', span: 6, height: 79 },
      { key: 'd', span: 7, height: 320 },
      { key: 'e', span: 5, height: 299 },
      { key: 'f', span: 4, height: 200 },
      { key: 'g', span: 4, height: 150 },
      { key: 'h', span: 4, height: 260 },
    ];
    const list = boxes(items);
    for (const item of list) expect(item.h % 8).toBe(0);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(overlapX > 1 && overlapY > 1).toBe(false);
      }
    }
  });

  it('จัดเต็มแถวเมื่อมีชุดการ์ดที่รวมได้ 12 คอลัมน์', () => {
    const packed = packWorkspaceRows(
      [
        { key: 'a', span: 6, height: 200 },
        { key: 'b', span: 7, height: 200 },
        { key: 'c', span: 5, height: 200 },
      ],
      { width: 1200 },
    );
    // b (7) + c (5) เต็ม 12 ก่อน แล้ว a ขึ้นแถวใหม่
    expect(packed['b'].y).toBe(packed['c'].y);
    expect(packed['a'].y).toBeGreaterThan(packed['b'].y);
  });

  it('คืนค่าว่างเมื่อความกว้างไม่พอ', () => {
    expect(packWorkspaceRows([{ key: 'a', span: 6, height: 100 }], { width: 10 })).toEqual({});
  });
});
