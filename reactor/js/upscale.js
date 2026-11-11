// Pixel-art upscaling (Scale2x and Scale3x): each pixel becomes 2 × 2 or
// 3 × 3 finer ones, and corners between two flat colours are filled in, so
// curves and diagonals step at the finer size. Flat areas, straight edges
// and checkerboard dither come through unchanged. No colours are invented.
(function (root) {
  'use strict';

  // src: Uint32Array of w × h pixels. dst: Uint32Array of (w·2) × (h·2).
  function scale2x(src, w, h, dst) {
    const W2 = w * 2;
    for (let y = 0; y < h; y++) {
      const up = (y > 0 ? y - 1 : y) * w, row = y * w, down = (y < h - 1 ? y + 1 : y) * w;
      let o = y * 2 * W2;
      for (let x = 0; x < w; x++, o += 2) {
        const E = src[row + x];
        const B = src[up + x], H = src[down + x];
        const D = src[row + (x > 0 ? x - 1 : x)], F = src[row + (x < w - 1 ? x + 1 : x)];
        if (B !== H && D !== F) {
          dst[o] = D === B ? D : E;
          dst[o + 1] = B === F ? F : E;
          dst[o + W2] = D === H ? D : E;
          dst[o + W2 + 1] = H === F ? F : E;
        } else {
          dst[o] = dst[o + 1] = dst[o + W2] = dst[o + W2 + 1] = E;
        }
      }
    }
    return dst;
  }

  // dst: Uint32Array of (w·3) × (h·3).
  function scale3x(src, w, h, dst) {
    const W3 = w * 3;
    for (let y = 0; y < h; y++) {
      const up = (y > 0 ? y - 1 : y) * w, row = y * w, down = (y < h - 1 ? y + 1 : y) * w;
      let o = y * 3 * W3;
      for (let x = 0; x < w; x++, o += 3) {
        const xl = x > 0 ? x - 1 : x, xr = x < w - 1 ? x + 1 : x;
        const E = src[row + x];
        const B = src[up + x], H = src[down + x], D = src[row + xl], F = src[row + xr];
        const o1 = o + W3, o2 = o1 + W3;
        if (B !== H && D !== F) {
          const A = src[up + xl], C = src[up + xr], G = src[down + xl], I = src[down + xr];
          dst[o] = D === B ? D : E;
          dst[o + 1] = (D === B && E !== C) || (B === F && E !== A) ? B : E;
          dst[o + 2] = B === F ? F : E;
          dst[o1] = (D === B && E !== G) || (D === H && E !== A) ? D : E;
          dst[o1 + 1] = E;
          dst[o1 + 2] = (B === F && E !== I) || (H === F && E !== C) ? F : E;
          dst[o2] = D === H ? D : E;
          dst[o2 + 1] = (D === H && E !== I) || (H === F && E !== G) ? H : E;
          dst[o2 + 2] = H === F ? F : E;
        } else {
          dst[o] = dst[o + 1] = dst[o + 2] = dst[o1] = dst[o1 + 1] = dst[o1 + 2] = dst[o2] = dst[o2 + 1] = dst[o2 + 2] = E;
        }
      }
    }
    return dst;
  }

  // An upscaler for one size and factor (2, 3 or 4), reusing its buffers.
  function Upscaler(w, h, k) {
    this.w = w; this.h = h; this.k = k;
    this.mid = k === 4 ? new Uint32Array(w * 2 * h * 2) : null;
  }
  Upscaler.prototype.run = function (src, dst) {
    if (this.k === 2) return scale2x(src, this.w, this.h, dst);
    if (this.k === 3) return scale3x(src, this.w, this.h, dst);
    scale2x(src, this.w, this.h, this.mid);
    return scale2x(this.mid, this.w * 2, this.h * 2, dst);
  };

  const api = { scale2x: scale2x, scale3x: scale3x, Upscaler: Upscaler };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReactorUpscale = api;
})(typeof window !== 'undefined' ? window : globalThis);
