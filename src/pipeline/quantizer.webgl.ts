import type { Palette } from '@/types';

const VERT_SRC = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vert: WebGLShader, frag: WebGLShader): WebGLProgram {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link failed: ${log}`);
  }
  return prog;
}

export function isWebGL2Available(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!canvas.getContext('webgl2');
  } catch {
    return false;
  }
}

export class WebGLQuantizer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private tex: WebGLTexture;
  private fbo: WebGLFramebuffer;
  private fboSize = { w: 0, h: 0 };
  private paletteSize: number;

  constructor(palette: Palette, fragSrc: string) {
    if (!isWebGL2Available()) {
      throw new Error('WebGL2 not available');
    }
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2')!;
    this.gl = gl;
    this.paletteSize = palette.length;

    const vert = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    const frag = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
    this.prog = link(gl, vert, frag);
    gl.deleteShader(vert);
    gl.deleteShader(frag);

    const aPos = gl.getAttribLocation(this.prog, 'a_pos');
    const aUv = gl.getAttribLocation(this.prog, 'a_uv');

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 0,
       1, -1, 1, 0,
      -1,  1, 0, 1,
       1,  1, 1, 1,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);

    this.tex = gl.createTexture()!;
    this.fbo = gl.createFramebuffer()!;

    this.setPalette(palette);
  }

  setPalette(palette: Palette): void {
    const flat = new Float32Array(128 * 3);
    for (let i = 0; i < palette.length && i < 128; i++) {
      flat[i * 3]     = palette[i].rgb[0];
      flat[i * 3 + 1] = palette[i].rgb[1];
      flat[i * 3 + 2] = palette[i].rgb[2];
    }
    this.gl.useProgram(this.prog);
    this.gl.uniform3fv(
      this.gl.getUniformLocation(this.prog, 'u_palette'),
      flat
    );
    this.paletteSize = palette.length;
  }

  quantize(src: ImageData, enableDither: boolean): Uint8Array {
    const { width: w, height: h, data } = src;
    const gl = this.gl;

    if (this.fboSize.w !== w || this.fboSize.h !== h) {
      this.fboSize = { w, h };
      gl.canvas.width = w;
      gl.canvas.height = h;
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }

    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'u_src'), 0);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'u_paletteSize'), this.paletteSize);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'u_enableDither'), enableDither ? 1 : 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const out = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);

    return out;
  }
}
