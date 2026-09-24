import { describe, expect, it } from 'vitest';
import { FOCUS_MS, WORLD_H, WORLD_W, clampAxis, createCamera, fitScale } from './camera';

describe('fitScale', () => {
  it('picks the integer scale that best fits the width, never below 1', () => {
    expect(fitScale(390)).toBe(1);
    expect(fitScale(640)).toBe(1);
    expect(fitScale(1170)).toBe(2);
    expect(fitScale(1920)).toBe(3);
    expect(fitScale(0)).toBe(1);
  });
});

describe('clampAxis', () => {
  it('keeps the view inside the world', () => {
    expect(clampAxis(-50, 100, 640)).toBe(0);
    expect(clampAxis(600, 100, 640)).toBe(540);
    expect(clampAxis(200, 100, 640)).toBe(200);
  });
  it('centers when the view is larger than the world', () => {
    expect(clampAxis(123, 800, 640)).toBe(-80);
  });
});

describe('createCamera', () => {
  it('fits the map width at zoom 1', () => {
    const cam = createCamera(1280, 960);
    expect(cam.scale).toBe(2);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
  });

  it('clamps pans to the map edges', () => {
    const cam = createCamera(640, 480);
    cam.setZoom(2);
    cam.panBy(10_000, 10_000);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
    cam.panBy(-10_000, -10_000);
    expect(cam.x).toBe(WORLD_W - 640 / cam.scale);
    expect(cam.y).toBe(WORLD_H - 480 / cam.scale);
  });

  it('animates focusTile over 400 ms and ends clamped on the target', () => {
    const cam = createCamera(640, 480);
    cam.setZoom(2);
    cam.focusTile(20, 15, 1000);
    expect(cam.animating).toBe(true);
    cam.update(1000 + FOCUS_MS / 2);
    const mid = cam.x;
    cam.update(1000 + FOCUS_MS);
    expect(cam.animating).toBe(false);
    const target = cam.x;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(target);
    // the target tile's center is in the middle of the view
    const c = cam.worldToScreen(20 * 16 + 8, 15 * 16 + 8);
    expect(c.x).toBeCloseTo(320);
    expect(c.y).toBeCloseTo(240);
    cam.focusTile(0, 0, 2000);
    cam.update(3000);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
  });

  it('round-trips screen and world points', () => {
    const cam = createCamera(1280, 960);
    cam.setZoom(3);
    cam.panBy(-300, -200);
    const w = cam.screenToWorld(400, 300);
    const s = cam.worldToScreen(w.x, w.y);
    expect(s.x).toBeCloseTo(400);
    expect(s.y).toBeCloseTo(300);
  });
});
