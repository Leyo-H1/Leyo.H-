/** Axis-locked, incremental gesture shared by touch, pen and primary mouse drag. */
export function createVerticalSwipe() {
  let gesture: { id: number; x: number; y: number; lastY: number; axis: "pending" | "vertical" | "horizontal" } | null = null;
  return {
    begin(id: number, x: number, y: number) { gesture = { id, x, y, lastY: y, axis: "pending" }; },
    move(id: number, x: number, y: number) {
      if (!gesture || id !== gesture.id) return null;
      if (gesture.axis === "pending") {
        const dx = Math.abs(x - gesture.x), dy = Math.abs(y - gesture.y);
        if (Math.max(dx, dy) < 8) return null;
        gesture.axis = dy > dx * 1.15 ? "vertical" : "horizontal";
      }
      if (gesture.axis !== "vertical") return null;
      const delta = gesture.lastY - y;
      gesture.lastY = y;
      return delta;
    },
    end(id: number) {
      if (!gesture || id !== gesture.id) return false;
      const claimed = gesture.axis === "vertical";
      gesture = null;
      return claimed;
    },
    cancel() { gesture = null; },
  };
}
