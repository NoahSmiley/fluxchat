import { useState, useRef, useEffect } from "react";
import { X, Shuffle } from "lucide-react";
import { dbg } from "../../lib/debug.js";

// ── Kaleidoscopic Shader Visualizer (Easter Egg) ──

const VERT_SRC = `#version 300 es
in vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG_SRC = `#version 300 es
precision highp float;
out vec4 O;
uniform vec2 u_res;
uniform float u_time;
uniform float u_zoom;
uniform float u_colorShift;
uniform float u_sides;
uniform float u_speed;
uniform float u_contrast;
uniform float u_orbSize;

#define PI 3.14159265359

vec2 kaleidoscope(vec2 uv, float sides) {
  float angle = atan(uv.y, uv.x);
  float segment = PI * 2.0 / sides;
  angle = abs(mod(angle, segment) - segment * 0.5);
  float r = length(uv);
  return vec2(cos(angle), sin(angle)) * r;
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - u_res * 0.5) / min(u_res.x, u_res.y);
  float t = u_time * u_speed * 0.3;

  // Apply zoom
  uv *= u_zoom;

  // Kaleidoscope fold
  uv = kaleidoscope(uv, u_sides);

  // Fractal iteration — Julia-like with orbit trapping
  vec2 z = uv;
  vec2 c = vec2(
    0.38 * sin(t * 0.7) - 0.25 * cos(t * 0.4),
    0.38 * cos(t * 0.5) + 0.22 * sin(t * 0.6)
  );

  float trap = 1e10;
  float glow = 0.0;
  const int ITER = 32;

  for (int i = 0; i < ITER; i++) {
    // z = z^2 + c
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;

    // Orbit trap — distance to origin and to a circle
    float d = length(z);
    trap = min(trap, abs(d - u_orbSize));
    glow += exp(-d * 4.0) / float(ITER);

    if (d > 8.0) break;
  }

  // Color from trap distance and iteration glow
  float h = fract(trap * 2.0 + u_colorShift / 360.0 + t * 0.1);
  float s = 0.85;
  float v = pow(glow * 8.0, u_contrast) * 1.5;

  // Add trap-based brightness
  v += exp(-trap * 8.0) * 0.6;
  v = clamp(v, 0.0, 1.0);

  vec3 col = hsv2rgb(vec3(h, s, v));

  // Slight vignette
  float vig = 1.0 - length((gl_FragCoord.xy / u_res - 0.5) * 1.4);
  col *= smoothstep(0.0, 0.7, vig);

  O = vec4(col, 1.0);
}`;

interface VisualizerParams {
  zoom: number;
  speed: number;
  colorShift: number;
  sides: number;
  contrast: number;
  orbSize: number;
}

const PRESETS: VisualizerParams[] = [
  { zoom: 1.8, speed: 1.0, colorShift: 120, sides: 6, contrast: 1.2, orbSize: 0.5 },
  { zoom: 2.5, speed: 0.6, colorShift: 260, sides: 8, contrast: 1.5, orbSize: 0.8 },
  { zoom: 1.2, speed: 1.5, colorShift: 30, sides: 5, contrast: 1.0, orbSize: 0.3 },
];

function randomParams(): VisualizerParams {
  return {
    zoom: 0.8 + Math.random() * 3.2,
    speed: 0.3 + Math.random() * 2.0,
    colorShift: Math.random() * 360,
    sides: 3 + Math.floor(Math.random() * 10),
    contrast: 0.6 + Math.random() * 1.4,
    orbSize: 0.1 + Math.random() * 1.2,
  };
}

export interface MusicVisualizerProps {
  isPaused: boolean;
  albumArtUrl?: string;
  onClose: () => void;
}

export function MusicVisualizer({ isPaused, albumArtUrl, onClose }: MusicVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<{ gl: WebGL2RenderingContext; prog: WebGLProgram; locs: Record<string, WebGLUniformLocation | null> } | null>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const lastFrameRef = useRef(performance.now());
  const [params, setParams] = useState<VisualizerParams>(PRESETS[0]);
  const [showControls, setShowControls] = useState(false);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // WebGL init
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
    if (!gl) return;

    function compile(type: number, src: string) {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
        dbg("music", "Shader compile error:", gl!.getShaderInfoLog(s));
      }
      return s;
    }

    const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      dbg("music", "Program link error:", gl.getProgramInfoLog(prog));
    }

    gl.useProgram(prog);

    // Fullscreen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const locs: Record<string, WebGLUniformLocation | null> = {};
    for (const name of ["u_res", "u_time", "u_zoom", "u_colorShift", "u_sides", "u_speed", "u_contrast", "u_orbSize"]) {
      locs[name] = gl.getUniformLocation(prog, name);
    }

    glRef.current = { gl, prog, locs };

    // Cleanup
    return () => {
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
      glRef.current = null;
    };
  }, []);

  // Render loop
  useEffect(() => {
    function frame() {
      const g = glRef.current;
      const canvas = canvasRef.current;
      if (!g || !canvas) return;
      const { gl, locs } = g;

      // Resize
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);

      // Advance time only when playing
      const now = performance.now();
      if (!isPaused) {
        timeRef.current += (now - lastFrameRef.current) / 1000;
      }
      lastFrameRef.current = now;

      const p = paramsRef.current;
      gl.uniform2f(locs.u_res, w, h);
      gl.uniform1f(locs.u_time, timeRef.current);
      gl.uniform1f(locs.u_zoom, p.zoom);
      gl.uniform1f(locs.u_colorShift, p.colorShift);
      gl.uniform1f(locs.u_sides, p.sides);
      gl.uniform1f(locs.u_speed, p.speed);
      gl.uniform1f(locs.u_contrast, p.contrast);
      gl.uniform1f(locs.u_orbSize, p.orbSize);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      animRef.current = requestAnimationFrame(frame);
    }

    animRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animRef.current);
  }, [isPaused]);

  return (
    <div
      className="music-visualizer"
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      <canvas
        ref={canvasRef}
        className="music-visualizer-canvas"
      />

      {/* Close button */}
      <button className="viz-close-btn" onClick={onClose} title="Back to vinyl">
        <X size={16} />
      </button>

      {/* Controls overlay */}
      <div className={`viz-controls ${showControls ? "visible" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="viz-presets">
          {PRESETS.map((p, i) => (
            <button key={i} className="viz-preset-btn" onClick={() => setParams(p)}>{i + 1}</button>
          ))}
          <button className="viz-preset-btn" onClick={() => setParams(randomParams())} title="Randomize">
            <Shuffle size={12} />
          </button>
        </div>

        {([
          { key: "zoom", label: "ZOOM", min: 0.5, max: 5, step: 0.1 },
          { key: "contrast", label: "CONTRAST", min: 0.3, max: 2.5, step: 0.1 },
          { key: "orbSize", label: "ORBSIZE", min: 0.05, max: 1.5, step: 0.05 },
          { key: "colorShift", label: "COLORSHIFT", min: 0, max: 360, step: 1 },
          { key: "sides", label: "SIDES", min: 3, max: 12, step: 1 },
          { key: "speed", label: "SPEED", min: 0.1, max: 3, step: 0.1 },
        ] as const).map((s) => (
          <label key={s.key} className="viz-slider-row">
            <span className="viz-slider-label">{s.label}</span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={params[s.key]}
              onChange={(e) => setParams((prev) => ({ ...prev, [s.key]: parseFloat(e.target.value) }))}
              className="viz-slider"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
