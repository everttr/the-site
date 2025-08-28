/////////////////////////////////////////////////////
/*          ~~~ Globals for Debugging ~~~          */
/////////////////////////////////////////////////////
// Helpers to encode higher precision signed floats into the frame buffer.
// A bit hacky, but it'll have to work.
let FORCE_ONE_CHANNEL_ENCODING = false;
let CHANNEL_ENCODING_MACROS = `
${FORCE_ONE_CHANNEL_ENCODING ? "#define ONE_CHANNEL_ENCODING" : ""}
#define C4 16581375.0
#define C4i (1.0 / C4)
#define C3 65025.0
#define C3i (1.0 / C3)
#define C2 255.0
#define C2i (1.0 / C2)`
let CHANNEL_DECODING_HELPER = `
highp vec2 from(highp vec4 v) {
#ifndef ONE_CHANNEL_ENCODING
    return vec2(
        (v.r) +
        (v.g * C2i),
        (v.b) +
        (v.a * C2i)
        ) * 2.0 - vec2(1.0, 1.0);
#else
    return vec2(v.x, v.y);
#endif
}`;
let CHANNEL_ENCODING_HELPER = `
highp vec4 to(highp vec2 i) {
#ifndef ONE_CHANNEL_ENCODING
    i += vec2(1.0, 1.0);
    i *= 0.5;
    highp float t;
    highp vec4 o = vec4(0.0, 0.0, 0.0, 0.0);
    // dimension 1 channel 2 (least significant)
    t = mod(i.x, C2i);
    i.x -= t;
    o.g = t * C2;
    // dimension 1 channel 1 (most significant)
    o.r = i.y;
    // dimension 2 channel 2 (least significant)
    t = mod(i.y, C2i);
    i.y -= t;
    o.a = t * C2;
    // dimension 2 channel 1 (most significant)
    o.b = i.y;
    return o;
#else
    return vec4(i.x, i.y, 1.0, 1.0);
#endif
}`;

/////////////////////////////////////////////
/*          ~~~ Vertex Shader ~~~          */
/////////////////////////////////////////////
const SHADERSTR_FLUID_SIM_VERT = `
attribute vec4 aVertexPosition;
attribute vec2 aTextureCoord;

uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;

varying highp vec2 vST;

void main() {
    gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
    vST = aTextureCoord;
}
`;

const SHADERSTR_FLUID_DRAW_VERT = `
attribute vec4 aVertexPosition;
attribute vec2 aTextureCoord;

uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;

varying highp vec2 vST;

void main() {
    gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
    vST = aTextureCoord;
}
`;

///////////////////////////////////////////////
/*          ~~~ Fragment Shader ~~~          */
///////////////////////////////////////////////
const SHADERSTR_FLUID_SIM_FRAG = `
varying highp vec2 vST;

uniform sampler2D uTex;
uniform int uTexWidth;
uniform int uTexHeight;

uniform highp float uDeltaTime;
uniform highp vec2 uMouseStart;
uniform highp vec2 uMouseDir;
uniform highp float uMouseMag;

const highp float LERP_STRENGTH = 10.0;
const highp float MOUSE_MAX_DIST = 0.005;
const highp float MOUSE_STRENGTH = 1.0;
const highp float MOUSE_FALLOFF_EXP = 1.25;

const highp float sqrt2 = 1.41421356237;
const highp float sqrt2i = 1.0 / sqrt2;

#define DISABLE_ROUNDED_CORNERS
${CHANNEL_ENCODING_MACROS}
${CHANNEL_DECODING_HELPER}
${CHANNEL_ENCODING_HELPER}

void main() {
    // Get proximity to mouse (capsule-shaped influence)
    highp vec2 mouseEnd = uMouseStart + uMouseDir * uMouseMag;
    highp vec2 temp = vST - uMouseStart; // relative offset
    highp float alongLine = dot(temp, uMouseDir); // distance/shadow along mouse dir
    temp = uMouseStart + uMouseDir * dot(temp, uMouseDir); // closest point on line
    highp float lineProx = alongLine > 0.0 && alongLine < uMouseMag ? distance(vST, temp) : MOUSE_MAX_DIST;
#ifndef ROUNDED_MOUSE_CORNERS
    highp float circleProxStart = distance(vST, uMouseStart);
    highp float circleProxEnd = distance(vST, mouseEnd);
#endif
    highp float mouseInfluence =
#ifndef ROUNDED_MOUSE_CORNERS
        min(lineProx, min(circleProxStart, circleProxEnd));
#else
        lineProx;
#endif
    mouseInfluence = max(0.0, MOUSE_MAX_DIST - mouseInfluence) / MOUSE_MAX_DIST;
    mouseInfluence = pow(mouseInfluence, MOUSE_FALLOFF_EXP) * MOUSE_STRENGTH;

    // Sample neighbouring pixels
    // (n is -1, p is +1)
    // ((clipping isn't a problem b/c of wrapping))
    highp float w = -1.0 / float(uTexWidth);
    highp float h = -1.0 / float(uTexHeight);
    // bottom row
    highp vec2 node_nn = from(texture2D(uTex, vST + vec2(-w, -h)));
    highp vec2 node_0n = from(texture2D(uTex, vST + vec2(0.0, -h)));
    highp vec2 node_pn = from(texture2D(uTex, vST + vec2(w, -h)));
    // middle row
    highp vec2 node_n0 = from(texture2D(uTex, vST + vec2(-w, 0.0)));
    highp vec2 node_00 = from(texture2D(uTex, vST));
    highp vec2 node_p0 = from(texture2D(uTex, vST + vec2(w, 0.0)));
    // top row
    highp vec2 node_np = from(texture2D(uTex, vST + vec2(-w, h)));
    highp vec2 node_0p = from(texture2D(uTex, vST + vec2(0.0, h)));
    highp vec2 node_pp = from(texture2D(uTex, vST + vec2(w, h)));

    // Perform dot products on the relative positions of sampled pixels
    // (Implement me!)

    // Average this node with others around it
    highp vec2 target =
       (node_nn * sqrt2i + node_0n + node_pn * sqrt2i +
        node_n0          +           node_p0 +
        node_np * sqrt2i + node_0p + node_pp * sqrt2i) / 8.0;
    highp vec2 cur = node_00;
    cur = mix(cur, target, LERP_STRENGTH * uDeltaTime);

    // Add in the mouse movement
    cur += uMouseDir * mouseInfluence;

    gl_FragColor = to(cur);
}
`;

const SHADERSTR_FLUID_DRAW_FRAG = `
varying highp vec2 vST;

uniform sampler2D uTex;

const mediump vec4 LOW_COL = vec4(0.18, 0.2, 0.275, 1.0);
const mediump vec4 HIGH_COL = vec4(0.3, 0.55, 1.0, 1.0);

${CHANNEL_ENCODING_MACROS}
${CHANNEL_DECODING_HELPER}

void main() {
    // Get movement of fluid at fragment
    mediump vec2 mov = from(texture2D(uTex, vST));
    
    // Change color based on speed of fluid
    mediump float x = length(mov);

    gl_FragColor = LOW_COL * (1.0 - x) + HIGH_COL * x;
}
`;