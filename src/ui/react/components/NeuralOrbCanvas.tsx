import React, { useEffect, useRef } from 'react';

interface NeuralOrbCanvasProps {
  className?: string;
}

interface Particle {
  baseX: number;
  baseY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phaseOffset: number;
  size: number;
  alpha: number;
  role: 'wave' | 'transitioning' | 'orbiting';
  startX: number;
  startY: number;
  transitionStartMs: number;
  transitionDurationMs: number;
  ox: number;
  oy: number;
  oz: number;
  jitterPhase: number;
  // Projected screen coords + depth (refreshed each frame for orbiting nodes)
  projZ: number;
  projPersp: number;
  projVisible: boolean;
}

interface NodeLink {
  a: Particle;
  b: Particle;
  d3: number;
}

const PARTICLE_COUNT_DESKTOP = 200;
const PARTICLE_COUNT_NARROW = 100;
const NARROW_WIDTH = 360;
const ORB_NODE_COUNT = 70;

const ENTER_FADE_MS = 600;
const CONVERGE_START_MS = 600;
const CONVERGE_END_MS = 2000;
const PULSE_END_MS = 2400;
const TRANSITION_MIN_MS = 1100;
const TRANSITION_MAX_MS = 1400;
const BREATHE_PERIOD_MS = 6000;

const WAVE_AMPLITUDE = 18;
const WAVE_FREQ_X = 0.012;
const WAVE_SPEED = 0.0008;

const MOUSE_REPEL_RADIUS = 90;
const MOUSE_REPEL_FORCE = 28;
const MOUSE_SPRING = 0.06;
const MOUSE_DAMPING = 0.85;

const ROTATION_SPEED = 0.0015;
const LINK_DIST_3D = 0.65;
const ORB_RADIUS_FACTOR = 0.28;
const ORB_BREATHE_AMP = 0.015;

const COLOR_PARTICLE_FALLBACK = '180, 200, 230';
const COLOR_NODE_FALLBACK = '180, 210, 255';
const COLOR_GLOW_FALLBACK = '140, 180, 240';

function fibSphere(count: number): { x: number; y: number; z: number }[] {
  const points: { x: number; y: number; z: number }[] = [];
  const goldenAngle = Math.PI * (Math.sqrt(5) - 1);
  const denom = Math.max(count - 1, 1);
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / denom) * 2;
    const radius = Math.sqrt(Math.max(1 - y * y, 0));
    const theta = goldenAngle * i;
    points.push({
      x: Math.cos(theta) * radius,
      y,
      z: Math.sin(theta) * radius,
    });
  }
  return points;
}

function easeOutCubic(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return 1 - Math.pow(1 - clamped, 3);
}

function readVar(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Neural orb visual: a wave-field of soft particles condenses into a slowly
 * rotating wireframe sphere, then breathes idly. Pure Canvas 2D for bundle
 * size; uses RAF + IntersectionObserver to pause when off-screen and respects
 * prefers-reduced-motion by rendering a single static frame.
 */
export function NeuralOrbCanvas({ className }: NeuralOrbCanvasProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let particleCount = PARTICLE_COUNT_DESKTOP;
    let particles: Particle[] = [];
    const orbNodes = fibSphere(ORB_NODE_COUNT);
    let nodeLinks: NodeLink[] = [];
    let rotation = 0;
    let enterStartMs = performance.now();
    let mouseX = -10000;
    let mouseY = -10000;
    let rafId = 0;
    let isPaused = false;
    let isMounted = true;

    let colorParticle = COLOR_PARTICLE_FALLBACK;
    let colorNode = COLOR_NODE_FALLBACK;
    let colorGlow = COLOR_GLOW_FALLBACK;

    function readColors(): void {
      colorParticle = readVar(container!, '--socratic-particle-color', COLOR_PARTICLE_FALLBACK);
      colorNode = readVar(container!, '--socratic-orb-node-color', COLOR_NODE_FALLBACK);
      colorGlow = readVar(container!, '--socratic-orb-glow', COLOR_GLOW_FALLBACK);
    }

    function setupSize(): void {
      const rect = container!.getBoundingClientRect();
      width = Math.max(rect.width, 1);
      height = Math.max(rect.height, 1);
      const dpr = window.devicePixelRatio || 1;
      canvas!.width = Math.floor(width * dpr);
      canvas!.height = Math.floor(height * dpr);
      canvas!.style.width = width + 'px';
      canvas!.style.height = height + 'px';
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      particleCount = width <= NARROW_WIDTH ? PARTICLE_COUNT_NARROW : PARTICLE_COUNT_DESKTOP;
    }

    function initParticles(): void {
      const arr: Particle[] = [];
      for (let i = 0; i < particleCount; i++) {
        const baseX = Math.random() * width;
        const baseY = Math.random() * height;
        const node = i < orbNodes.length ? orbNodes[i] : undefined;
        arr.push({
          baseX,
          baseY,
          x: baseX,
          y: baseY,
          vx: 0,
          vy: 0,
          phaseOffset: Math.random() * Math.PI * 2,
          size: 0.85 + Math.random() * 1.1,
          alpha: 0.35 + Math.random() * 0.45,
          role: 'wave',
          startX: baseX,
          startY: baseY,
          transitionStartMs: 0,
          transitionDurationMs: 0,
          ox: node ? node.x : 0,
          oy: node ? node.y : 0,
          oz: node ? node.z : 0,
          jitterPhase: Math.random() * Math.PI * 2,
          projZ: 0,
          projPersp: 1,
          projVisible: false,
        });
      }
      particles = arr;
    }

    function scheduleConvergence(): void {
      const limit = Math.min(orbNodes.length, particles.length);
      for (let i = 0; i < limit; i++) {
        const p = particles[i];
        if (!p) continue;
        p.transitionStartMs = CONVERGE_START_MS + Math.random() * 500;
        p.transitionDurationMs =
          TRANSITION_MIN_MS + Math.random() * (TRANSITION_MAX_MS - TRANSITION_MIN_MS);
      }
    }

    function precomputeLinks(): void {
      const links: NodeLink[] = [];
      const limit = Math.min(orbNodes.length, particles.length);
      for (let i = 0; i < limit; i++) {
        const a = particles[i];
        if (!a) continue;
        for (let j = i + 1; j < limit; j++) {
          const b = particles[j];
          if (!b) continue;
          const dx = a.ox - b.ox;
          const dy = a.oy - b.oy;
          const dz = a.oz - b.oz;
          const d3 = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d3 <= LINK_DIST_3D) {
            links.push({ a, b, d3 });
          }
        }
      }
      nodeLinks = links;
    }

    function projectNode(
      ox: number,
      oy: number,
      oz: number,
      cx: number,
      cy: number,
      radius: number,
      rot: number,
      breathe: number,
    ): { sx: number; sy: number; z3: number; persp: number } {
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const x3 = ox * cosR - oz * sinR;
      const z3 = ox * sinR + oz * cosR;
      const persp = 1 / (1 - z3 * 0.35);
      const sx = cx + x3 * radius * persp * breathe;
      const sy = cy + oy * radius * persp * breathe;
      return { sx, sy, z3, persp };
    }

    function drawWaveParticle(p: Particle, t: number, fadeIn: number): void {
      const phase = Math.sin(p.baseX * WAVE_FREQ_X + t * WAVE_SPEED + p.phaseOffset);
      const targetX = p.baseX;
      const targetY = p.baseY + phase * WAVE_AMPLITUDE;
      const dx = p.x - mouseX;
      const dy = p.y - mouseY;
      const distSq = dx * dx + dy * dy;
      if (distSq < MOUSE_REPEL_RADIUS * MOUSE_REPEL_RADIUS && distSq > 0.5) {
        const dist = Math.sqrt(distSq);
        const force = (1 - dist / MOUSE_REPEL_RADIUS) * MOUSE_REPEL_FORCE;
        p.vx += (dx / dist) * force * 0.04;
        p.vy += (dy / dist) * force * 0.04;
      }
      p.vx += (targetX - p.x) * MOUSE_SPRING;
      p.vy += (targetY - p.y) * MOUSE_SPRING;
      p.vx *= MOUSE_DAMPING;
      p.vy *= MOUSE_DAMPING;
      p.x += p.vx;
      p.y += p.vy;
      const wavePhaseFactor = (phase + 1) / 2;
      const sizeMul = 0.7 + wavePhaseFactor * 0.6;
      const alphaMul = 0.5 + wavePhaseFactor * 0.5;
      ctx!.globalAlpha = p.alpha * fadeIn * alphaMul;
      ctx!.beginPath();
      ctx!.arc(p.x, p.y, p.size * sizeMul, 0, Math.PI * 2);
      ctx!.fill();
    }

    function draw(now: number): void {
      const t = now - enterStartMs;
      const fadeIn = Math.min(t / ENTER_FADE_MS, 1);
      const orbCenterX = width * 0.5;
      const orbCenterY = height * 0.3;
      const orbRadius = Math.min(width, height) * ORB_RADIUS_FACTOR;

      const breathePhase = (t % BREATHE_PERIOD_MS) / BREATHE_PERIOD_MS;
      const breatheScale =
        t < CONVERGE_END_MS ? 1.0 : 1.0 + Math.sin(breathePhase * Math.PI * 2) * ORB_BREATHE_AMP;

      let pulseMul = 1.0;
      if (t >= CONVERGE_END_MS && t < PULSE_END_MS) {
        const pp = (t - CONVERGE_END_MS) / (PULSE_END_MS - CONVERGE_END_MS);
        pulseMul = 1.0 + Math.sin(pp * Math.PI) * 0.6;
      }

      ctx!.clearRect(0, 0, width, height);

      // Update role transitions
      for (const p of particles) {
        if (
          p.role === 'wave' &&
          p.transitionDurationMs > 0 &&
          t >= p.transitionStartMs
        ) {
          p.role = 'transitioning';
          p.startX = p.x;
          p.startY = p.y;
        }
        if (p.role === 'transitioning') {
          const tt = (t - p.transitionStartMs) / p.transitionDurationMs;
          if (tt >= 1) p.role = 'orbiting';
        }
        p.projVisible = false;
      }

      // Wave particles
      ctx!.fillStyle = `rgba(${colorParticle}, 1)`;
      for (const p of particles) {
        if (p.role === 'wave') drawWaveParticle(p, t, fadeIn);
      }

      // Transitioning particles fly toward node positions
      for (const p of particles) {
        if (p.role !== 'transitioning') continue;
        const tt = (t - p.transitionStartMs) / p.transitionDurationMs;
        const eased = easeOutCubic(tt);
        const proj = projectNode(p.ox, p.oy, p.oz, orbCenterX, orbCenterY, orbRadius, rotation, 1.0);
        const sx = p.startX + (proj.sx - p.startX) * eased;
        const sy = p.startY + (proj.sy - p.startY) * eased;
        p.x = sx;
        p.y = sy;
        ctx!.globalAlpha = p.alpha * fadeIn;
        ctx!.beginPath();
        ctx!.arc(sx, sy, p.size * 1.05, 0, Math.PI * 2);
        ctx!.fill();
      }

      // Project orbiting positions onto particle (refreshed each frame)
      for (const p of particles) {
        if (p.role !== 'orbiting') continue;
        const jitterX = Math.sin(t * 0.001 + p.jitterPhase) * 0.008;
        const jitterY = Math.cos(t * 0.0013 + p.jitterPhase) * 0.008;
        const proj = projectNode(
          p.ox + jitterX,
          p.oy + jitterY,
          p.oz,
          orbCenterX,
          orbCenterY,
          orbRadius,
          rotation,
          breatheScale,
        );
        p.x = proj.sx;
        p.y = proj.sy;
        p.projZ = proj.z3;
        p.projPersp = proj.persp;
        p.projVisible = true;
      }

      // Connecting lines between orbiting nodes
      ctx!.strokeStyle = `rgba(${colorGlow}, 1)`;
      for (const link of nodeLinks) {
        if (!link.a.projVisible || !link.b.projVisible) continue;
        const zAvg = (link.a.projZ + link.b.projZ) / 2;
        const linkAlpha =
          Math.max(0, 0.42 - (link.d3 / LINK_DIST_3D) * 0.32) *
          (0.45 + zAvg * 0.55) *
          fadeIn *
          pulseMul;
        if (linkAlpha < 0.012) continue;
        ctx!.globalAlpha = linkAlpha;
        ctx!.lineWidth = 0.55 * ((link.a.projPersp + link.b.projPersp) / 2);
        ctx!.beginPath();
        ctx!.moveTo(link.a.x, link.a.y);
        ctx!.lineTo(link.b.x, link.b.y);
        ctx!.stroke();
      }

      // Node circles + radial glow
      for (const p of particles) {
        if (!p.projVisible) continue;
        const nodeAlpha = Math.min(1, (0.45 + p.projZ * 0.5) * fadeIn * pulseMul);
        const r = 1.4 * p.projPersp;
        ctx!.globalAlpha = nodeAlpha;
        ctx!.fillStyle = `rgba(${colorNode}, 1)`;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx!.fill();
        const halo = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4);
        halo.addColorStop(0, `rgba(${colorGlow}, ${nodeAlpha * 0.45})`);
        halo.addColorStop(1, `rgba(${colorGlow}, 0)`);
        ctx!.globalAlpha = 1;
        ctx!.fillStyle = halo;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, r * 4, 0, Math.PI * 2);
        ctx!.fill();
      }

      ctx!.globalAlpha = 1;

      if (t >= CONVERGE_END_MS) rotation += ROTATION_SPEED;
    }

    function loop(): void {
      if (!isMounted || isPaused) return;
      draw(performance.now());
      rafId = requestAnimationFrame(loop);
    }

    function onMouseMove(e: MouseEvent): void {
      const rect = canvas!.getBoundingClientRect();
      mouseX = e.clientX - rect.left;
      mouseY = e.clientY - rect.top;
    }

    function onMouseLeave(): void {
      mouseX = -10000;
      mouseY = -10000;
    }

    let resizeTimer: number | null = null;
    function onResize(): void {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (!isMounted) return;
        setupSize();
        initParticles();
        scheduleConvergence();
        precomputeLinks();
        enterStartMs = performance.now();
      }, 200);
    }

    const themeObserver = new MutationObserver(() => readColors());
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    const visObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          if (isPaused) {
            isPaused = false;
            rafId = requestAnimationFrame(loop);
          }
        } else if (!isPaused) {
          isPaused = true;
          if (rafId) cancelAnimationFrame(rafId);
        }
      },
      { threshold: 0.05 },
    );
    visObserver.observe(canvas);

    // Re-initialize when the container's own size changes. Window 'resize' is
    // not enough: in Obsidian, the leaf container may finish laying out after
    // mount without firing a window resize, so the first getBoundingClientRect
    // can read a too-small height and squeeze particles into the top strip.
    const containerObserver = new ResizeObserver(() => onResize());
    containerObserver.observe(container);

    readColors();
    setupSize();
    initParticles();
    scheduleConvergence();
    precomputeLinks();

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
    window.addEventListener('resize', onResize);

    if (reduced) {
      const limit = Math.min(orbNodes.length, particles.length);
      for (let i = 0; i < limit; i++) {
        const p = particles[i];
        if (p) p.role = 'orbiting';
      }
      enterStartMs = performance.now() - PULSE_END_MS - 50;
      draw(performance.now());
    } else {
      rafId = requestAnimationFrame(loop);
    }

    return () => {
      isMounted = false;
      if (rafId) cancelAnimationFrame(rafId);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      themeObserver.disconnect();
      visObserver.disconnect();
      containerObserver.disconnect();
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div ref={containerRef} className={className} aria-hidden="true">
      <canvas ref={canvasRef} className="socratic-orb-canvas" />
    </div>
  );
}
