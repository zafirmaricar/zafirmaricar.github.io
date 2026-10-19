// WebGL renderer: rocks with procedural stone shading and bevel lighting, and
// the fluid as screen-space metaballs (particles splatted into a half-res
// density buffer, then thresholded and shaded in a full-screen pass).
(function (root) {
  'use strict';

  const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

  const ROCK_VS = `
attribute vec2 a_pos;
attribute vec2 a_normal;
attribute float a_edge;
uniform vec2 u_scroll;
uniform vec2 u_res;
uniform vec2 u_offset;
varying vec2 v_world;
varying vec2 v_normal;
varying float v_edge;
void main() {
  vec2 p = a_pos + u_offset - u_scroll;
  v_world = a_pos;
  v_normal = a_normal;
  v_edge = a_edge;
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);
}`;

  const ROCK_FS = PRECISION + `
varying vec2 v_world;
varying vec2 v_normal;
varying float v_edge;
uniform float u_shadow;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
void main() {
  if (u_shadow > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.38); return; }
  vec2 w = v_world;
  float large = fbm(w * 0.006);
  float mid = fbm(w * 0.03 + 7.0);
  float fine = noise(w * 0.45);
  vec3 dark = vec3(0.16, 0.17, 0.19);
  vec3 light = vec3(0.36, 0.36, 0.37);
  vec3 col = mix(dark, light, smoothstep(0.25, 0.8, large * 0.6 + mid * 0.5));
  col *= 0.9 + 0.18 * fine;
  // Thin mineral veins.
  float vein = abs(fbm(w * 0.012 + 3.0) - 0.5);
  col = mix(col * 0.75, col, smoothstep(0.0, 0.025, vein));
  // Bevel: rim is lit from the top left, face stays darker for text contrast.
  float e = clamp(v_edge, 0.0, 1.0);
  vec3 N = normalize(vec3(v_normal * 1.3 * (1.0 - e) + (mid - 0.5) * 0.25, 0.45 + e));
  vec3 L = normalize(vec3(-0.45, -0.75, 0.6));
  float diff = clamp(dot(N, L), 0.0, 1.0);
  col *= 0.35 + 0.95 * diff;
  col *= mix(1.0, 0.62, smoothstep(0.55, 1.0, e));
  gl_FragColor = vec4(col, 1.0);
}`;

  const POINT_VS = `
attribute vec3 a_p;
uniform vec2 u_scroll;
uniform vec2 u_res;
uniform float u_size;
varying float v_speed;
void main() {
  vec2 p = a_p.xy - u_scroll;
  v_speed = a_p.z;
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);
  gl_PointSize = u_size;
}`;

  const POINT_FS = `
precision mediump float;
varying float v_speed;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(c, c);
  if (d2 > 1.0) discard;
  float w = 1.0 - d2;
  w *= w;
  gl_FragColor = vec4(w * 0.45, w * clamp(v_speed * 0.08, 0.0, 1.0) * 0.45, 0.0, 1.0);
}`;

  const QUAD_VS = `
attribute vec2 a_q;
varying vec2 v_uv;
void main() {
  v_uv = a_q * 0.5 + 0.5;
  gl_Position = vec4(a_q, 0.0, 1.0);
}`;

  const COMPOSITE_FS = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_texel;
varying vec2 v_uv;
void main() {
  vec4 s = texture2D(u_tex, v_uv);
  float d = s.r;
  float a = smoothstep(0.3, 0.42, d);
  if (a <= 0.001) discard;
  float l = texture2D(u_tex, v_uv - vec2(u_texel.x, 0.0)).r;
  float r = texture2D(u_tex, v_uv + vec2(u_texel.x, 0.0)).r;
  float b = texture2D(u_tex, v_uv - vec2(0.0, u_texel.y)).r;
  float t = texture2D(u_tex, v_uv + vec2(0.0, u_texel.y)).r;
  vec3 N = normalize(vec3(-(r - l) * 3.0, -(t - b) * 3.0, 1.0));
  vec3 L = normalize(vec3(-0.4, 0.6, 0.7));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(N, H), 0.0), 40.0);
  float rim = 1.0 - smoothstep(0.42, 0.75, d);
  float foam = clamp(s.g / max(d, 0.05), 0.0, 1.0);
  vec3 deep = vec3(0.10, 0.38, 0.74);
  vec3 shallow = vec3(0.38, 0.70, 0.96);
  vec3 col = mix(deep, shallow, rim * 0.8);
  col = mix(col, vec3(0.88, 0.96, 1.0), foam * 0.55);
  col += spec * 0.9;
  float alpha = a * (0.72 + 0.2 * rim);
  gl_FragColor = vec4(col * alpha, alpha);
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const info = { p, a: {}, u: {} };
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) { const n = gl.getActiveAttrib(p, i).name; info.a[n] = gl.getAttribLocation(p, n); }
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) { const n = gl.getActiveUniform(p, i).name; info.u[n] = gl.getUniformLocation(p, n); }
    return info;
  }

  class Renderer {
    static create(canvas, opts) {
      try {
        const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true });
        if (!gl) return null;
        return new Renderer(canvas, gl, opts);
      } catch (e) {
        console.warn('Fluid renderer unavailable:', e);
        return null;
      }
    }

    constructor(canvas, gl, opts) {
      this.canvas = canvas;
      this.gl = gl;
      this.particleSize = (opts && opts.particleSize) || 22;
      this.rock = program(gl, ROCK_VS, ROCK_FS);
      this.point = program(gl, POINT_VS, POINT_FS);
      this.composite = program(gl, QUAD_VS, COMPOSITE_FS);
      this.rockBuf = gl.createBuffer();
      this.rockVerts = 0;
      this.partBuf = gl.createBuffer();
      this.partData = new Float32Array(3 * ((opts && opts.maxParticles) || 4096));
      this.quadBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this.fbo = null;
      this.width = 0; this.height = 0; this.dpr = 1;
    }

    resize(w, h, dpr) {
      if (w === this.width && h === this.height && dpr === this.dpr) return;
      this.width = w; this.height = h; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      const gl = this.gl;
      const fw = Math.max(1, Math.round(w / 2)), fh = Math.max(1, Math.round(h / 2));
      if (this.fbo) { gl.deleteFramebuffer(this.fbo.fb); gl.deleteTexture(this.fbo.tex); }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.fbo = { fb, tex, w: fw, h: fh };
    }

    setRocks(rocks) {
      // Per vertex: x, y, nx, ny, edge. Rim strip between outer and inner
      // rings, then a fan over the (convex) inner ring.
      const verts = [];
      const push = (x, y, nx, ny, e) => verts.push(x, y, nx, ny, e);
      for (const r of rocks) {
        const n = r.n, o = r.outer, inn = r.inner, nm = r.normals;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          push(o[2 * i], o[2 * i + 1], nm[2 * i], nm[2 * i + 1], 0);
          push(o[2 * j], o[2 * j + 1], nm[2 * j], nm[2 * j + 1], 0);
          push(inn[2 * i], inn[2 * i + 1], 0, 0, 1);
          push(inn[2 * i], inn[2 * i + 1], 0, 0, 1);
          push(o[2 * j], o[2 * j + 1], nm[2 * j], nm[2 * j + 1], 0);
          push(inn[2 * j], inn[2 * j + 1], 0, 0, 1);
          push(r.cx, r.cy, 0, 0, 1);
          push(inn[2 * i], inn[2 * i + 1], 0, 0, 1);
          push(inn[2 * j], inn[2 * j + 1], 0, 0, 1);
        }
      }
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rockBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
      this.rockVerts = verts.length / 5;
    }

    render(sim, scrollX, scrollY) {
      const gl = this.gl;
      const W = this.width, H = this.height;

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      // Rocks: drop shadow, then the stone.
      if (this.rockVerts) {
        const R = this.rock;
        gl.useProgram(R.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.rockBuf);
        gl.enableVertexAttribArray(R.a.a_pos);
        gl.vertexAttribPointer(R.a.a_pos, 2, gl.FLOAT, false, 20, 0);
        gl.enableVertexAttribArray(R.a.a_normal);
        gl.vertexAttribPointer(R.a.a_normal, 2, gl.FLOAT, false, 20, 8);
        gl.enableVertexAttribArray(R.a.a_edge);
        gl.vertexAttribPointer(R.a.a_edge, 1, gl.FLOAT, false, 20, 16);
        gl.uniform2f(R.u.u_scroll, scrollX, scrollY);
        gl.uniform2f(R.u.u_res, W, H);
        gl.uniform2f(R.u.u_offset, 6, 12);
        gl.uniform1f(R.u.u_shadow, 1);
        gl.drawArrays(gl.TRIANGLES, 0, this.rockVerts);
        gl.uniform2f(R.u.u_offset, 0, 0);
        gl.uniform1f(R.u.u_shadow, 0);
        gl.drawArrays(gl.TRIANGLES, 0, this.rockVerts);
        gl.disableVertexAttribArray(R.a.a_normal);
        gl.disableVertexAttribArray(R.a.a_edge);
      }

      // Fluid density splat.
      const n = sim.fill(this.partData);
      if (!n) return;
      const P = this.point;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo.fb);
      gl.viewport(0, 0, this.fbo.w, this.fbo.h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(P.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.partData.subarray(0, 3 * n), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(P.a.a_p);
      gl.vertexAttribPointer(P.a.a_p, 3, gl.FLOAT, false, 0, 0);
      gl.uniform2f(P.u.u_scroll, scrollX, scrollY);
      gl.uniform2f(P.u.u_res, W, H);
      gl.uniform1f(P.u.u_size, this.particleSize * (this.fbo.w / W));
      gl.drawArrays(gl.POINTS, 0, n);

      // Composite onto the canvas.
      const C = this.composite;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(C.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
      gl.enableVertexAttribArray(C.a.a_q);
      gl.vertexAttribPointer(C.a.a_q, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fbo.tex);
      gl.uniform1i(C.u.u_tex, 0);
      gl.uniform2f(C.u.u_texel, 1 / this.fbo.w, 1 / this.fbo.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  root.FluidRenderer = Renderer;
})(window);
