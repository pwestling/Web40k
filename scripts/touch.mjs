// Touch gestures for Playwright pages (#60): taps, drags, long presses, pinches and twists sent as real
// multi-touch input through the DevTools protocol, so the app sees pointerType "touch" pointer events.
// The page needs a context made with hasTouch.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Points between `a` and `b`, `n` steps, eased. */
const between = (a, b, n) =>
  Array.from({ length: n }, (_, i) => {
    const k = (i + 1) / n;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  });

export async function touch(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 4, radiusY: 4, force: 1 })),
    });
  const api = {
    async tap(x, y) {
      await send("touchStart", [{ x, y }]);
      await sleep(40);
      await send("touchEnd", []);
      await sleep(60);
    },
    /** One finger from `from` to `to`; `hold` ms still first (a long press, then drag). */
    async drag(from, to, { steps = 14, hold = 0, stepMs = 16 } = {}) {
      await send("touchStart", [from]);
      if (hold) await sleep(hold);
      for (const p of between(from, to, steps)) {
        await send("touchMove", [p]);
        await sleep(stepMs);
      }
      await sleep(40);
      await send("touchEnd", []);
      await sleep(80);
    },
    /** A stylus stroke along `points` (pointerType "pen"). */
    async pen(points) {
      const at = (type, p, buttons) =>
        cdp.send("Input.dispatchMouseEvent", {
          type,
          x: p.x,
          y: p.y,
          button: "left",
          buttons,
          clickCount: 1,
          pointerType: "pen",
        });
      await at("mousePressed", points[0], 1);
      for (const p of points.slice(1)) {
        await at("mouseMoved", p, 1);
        await sleep(16);
      }
      await at("mouseReleased", points.at(-1), 0);
      await sleep(80);
    },
    /** One finger held still for `ms`. */
    async press(x, y, ms = 650) {
      await send("touchStart", [{ x, y }]);
      await sleep(ms);
      await send("touchEnd", []);
      await sleep(80);
    },
    /** Two fingers around `c`: spread from `d0` to `d1` px apart, turning from `a0` to `a1` radians, moving the centre by `pan`. */
    async two(c, { d0 = 120, d1 = 120, a0 = 0, a1 = 0, pan = { x: 0, y: 0 }, steps = 14 } = {}) {
      const at = (k) => {
        const d = (d0 + (d1 - d0) * k) / 2;
        const a = a0 + (a1 - a0) * k;
        const cx = c.x + pan.x * k;
        const cy = c.y + pan.y * k;
        return [
          { x: cx - Math.cos(a) * d, y: cy - Math.sin(a) * d },
          { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d },
        ];
      };
      await send("touchStart", at(0));
      for (let i = 1; i <= steps; i++) {
        await send("touchMove", at(i / steps));
        await sleep(16);
      }
      await sleep(40);
      await send("touchEnd", []);
      await sleep(80);
    },
  };
  return api;
}
