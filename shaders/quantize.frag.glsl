#version 300 es
precision highp float;

uniform sampler2D u_src;
uniform vec3 u_palette[128];
uniform int u_paletteSize;
uniform int u_enableDither;

in vec2 v_uv;
out vec4 fragColor;

ivec3 nearestIndex(vec3 rgb) {
  ivec3 best = ivec3(0, 0, 0);
  float bestD = 1e9;
  for (int i = 0; i < 128; i++) {
    if (i >= u_paletteSize) break;
    vec3 diff = u_palette[i] - rgb;
    float d = dot(diff, diff);
    if (d < bestD) {
      bestD = d;
      best = ivec3(i, 0, 0);
    }
  }
  return best;
}

void main() {
  vec4 src = texture(u_src, v_uv);
  vec3 rgb = src.rgb * 255.0;
  if (u_enableDither == 1) {
    ivec2 pixel = ivec2(gl_FragCoord.xy);
    float n = mod((pixel.x + pixel.y * 2) * 3.0, 8.0) / 8.0 - 0.5;
    rgb += n * 8.0;
  }
  ivec3 idx3 = nearestIndex(rgb);
  vec3 chosen = u_palette[idx3.x];
  fragColor = vec4(chosen / 255.0, src.a);
}
