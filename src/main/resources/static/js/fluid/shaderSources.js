/////////////////////////////////////////////////////
/*          ~~~ Globals for Debugging ~~~          */
/////////////////////////////////////////////////////
// Helpers to encode higher precision floats into the frame buffer.
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
highp float from(highp vec4 v) {
#ifndef ONE_CHANNEL_ENCODING
    return
        (v.r) +
        (v.g * C2i);// +
        // (v.b * C3i) +
        // (v.a * C4i);
#else
    return v.x;
#endif
}`;
let CHANNEL_ENCODING_HELPER = `
highp vec4 to(highp float f) {
#ifndef ONE_CHANNEL_ENCODING
    highp float t;
    highp vec4 v = vec4(0.0, 0.0, 0.0, 0.0);
    // // channel 4 (least significant)
    // t = mod(f, C4i);
    // f -= t;
    // v.a = t * C4;
    // // channel 3
    // t = mod(f, C3i);
    // f -= t;
    // v.b = t * C3;
    // channel 2
    t = mod(f, C2i);
    f -= t;
    v.g = t * C2;
    // channel 1 (most significant)
    v.r = f;
    return v;
#else
    return vec4(f, f, f, 1.0);
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
//#define USE_AVE_SPREADING
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
    highp float node_nn = from(texture2D(uTex, vST + vec2(-w, -h)));
    highp float node_0n = from(texture2D(uTex, vST + vec2(0.0, -h)));
    highp float node_pn = from(texture2D(uTex, vST + vec2(w, -h)));
    // middle row
    highp float node_n0 = from(texture2D(uTex, vST + vec2(-w, 0.0)));
    highp float node_00 = from(texture2D(uTex, vST));
    highp float node_p0 = from(texture2D(uTex, vST + vec2(w, 0.0)));
    // top row
    highp float node_np = from(texture2D(uTex, vST + vec2(-w, h)));
    highp float node_0p = from(texture2D(uTex, vST + vec2(0.0, h)));
    highp float node_pp = from(texture2D(uTex, vST + vec2(w, h)));

    // (other sampled points not actually used at this point)
    // Just increase brightness over time to test
    // (the *0's are so I'm not yelled at for unused variables)
    highp float target =
#ifdef USE_AVE_SPREADING
       (node_nn * sqrt2i + node_0n + node_pn * sqrt2i +
        node_n0          + node_00 + node_p0 +
        node_np * sqrt2i + node_0p + node_pp * sqrt2i) / 9.0;
#else
        max(node_nn * sqrt2i, max(node_0n, max(node_pn * sqrt2i,
        max(node_n0,          max(node_00, max(node_p0,
        max(node_np * sqrt2i, max(node_0p,     node_pp * sqrt2i))))))));
#endif
    highp float cur = node_00;
    cur = mix(cur, target, LERP_STRENGTH * uDeltaTime);
    cur = min(1.0, cur + mouseInfluence);
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
    // DEBUG RENDERING is just interpolating between two colors while I make sure the sim itself works
    mediump vec4 simData = texture2D(uTex, vST);
    mediump float x = from(simData);
    gl_FragColor = LOW_COL * (1.0 - x) + HIGH_COL * x;
}
`;