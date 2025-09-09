// Basic Naviar-Stokes implementation somewhat based on the one from:
// http://graphics.cs.cmu.edu/nsp/course/15-464/Fall09/papers/StamFluidforGames.pdf

/////////////////////////////////////////////////////
/*          ~~~ Globals for Debugging ~~~          */
/////////////////////////////////////////////////////
// Helpers to encode higher precision signed floats into the frame buffer.
// A bit hacky, but it'll have to work.
let FORCE_ONE_CHANNEL_ENCODING = false;
let CHANNEL_ENCODING_MACROS = `
#define VOffset 2.0
#define VBound 4.0
#define VBoundi 1.0 / VBound
#define DMax 10.0
#define DMaxi 1.0 / DMax
#define C4 16581375.0
#define C4i (1.0 / C4)
#define C3 65025.0
#define C3i (1.0 / C3)
#define C2 255.0
#define C2i (1.0 / C2)`
let CHANNEL_DECODING_HELPERS = `
highp vec2 fromV(highp vec4 v) {
    return vec2(
        (v.r) +
        (v.g * C2i),
        (v.b) +
        (v.a * C2i)
        ) * VBound - vec2(VOffset, VOffset);
}
highp float fromD(highp vec4 d) {
    return (
        (d.r) +
        (d.g * C2i) +
        (d.b * C3i) +
        (d.a * C4i)
        ) * DMax;
}`;
let CHANNEL_ENCODING_HELPERS = `
highp vec4 toV(highp vec2 i) {
    i += vec2(VOffset, VOffset);
    i *= VBoundi;
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
}
highp vec4 toD(highp float i) {
    i *=DMaxi;
    highp float t;
    highp vec4 o = vec4(0.0, 0.0, 0.0, 0.0);
    // channel 4 (least significant)
    t = mod(i, C4i);
    i -= t;
    o.a = t * C4;
    // channel 3
    t = mod(i, C3i);
    i -= t;
    o.b = t * C3;
    // channel 2
    t = mod(i, C2i);
    i -= t;
    o.g = t * C2;
    // channel 1 (most significant)
    o.r = i;
    return o;
}`;

//////////////////////////////////////////////
/*          ~~~ Vertex Shaders ~~~          */
//////////////////////////////////////////////
const SHADERSTR_FLUID_SIM_VERT = `#version 300 es
in vec4 aVertexPosition;
in vec2 aTextureCoord;

uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;

out highp vec2 vST;

void main() {
    gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
    vST = aTextureCoord;
}
`;

const SHADERSTR_FLUID_DRAW_VERT = `#version 300 es
in vec4 aVertexPosition;
in vec2 aTextureCoord;

uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;

out highp vec2 vST;

void main() {
    gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
    vST = aTextureCoord;
}
`;

////////////////////////////////////////////////
/*          ~~~ Fragment Shaders ~~~          */
////////////////////////////////////////////////
const SHADERSTR_FLUID_SIM_FRAG = `#version 300 es
layout(location = 0) out highp vec4 outVelocity;
layout(location = 1) out highp vec4 outDensity;

in highp vec2 vST;

uniform bool uInitializeFields;

uniform sampler2D uTexV;
uniform sampler2D uTexD;
uniform int uTexWidth;
uniform int uTexHeight;

uniform highp float uDeltaTime;
uniform highp vec2 uMouseStart;
uniform highp vec2 uMouseDir;
uniform highp float uMouseMag;

const highp vec2 INIT_VELOCITY = vec2(0.0, 0.0);
const highp float INIT_DENSITY_LOW = 2.0;
const highp float INIT_DENSITY_HIGH = 6.5;

const highp float SOURCE_SPEED = 8.50;
const highp float DENSITY_DIFFUSION = 2.0;
const highp float VELOCITY_DIFFUSION = 0.4;
const highp float VELOCITY_GRADIENT_PULL = 1.0;
const highp float DRAG_STRENGTH = 0.30;

const highp float MOUSE_MAX_DIST = 0.015;
const highp float MOUSE_STRENGTH = 1.0;
const highp float MOUSE_FALLOFF_EXP = 1.25;

const highp float sqrt2 = 1.41421356237;
const highp float sqrt2i = 1.0 / sqrt2;

#define DISABLE_ROUNDED_CORNERS
${CHANNEL_ENCODING_MACROS}
${CHANNEL_DECODING_HELPERS}
${CHANNEL_ENCODING_HELPERS}

void main() {
    if (uInitializeFields) {
        outVelocity = toV(INIT_VELOCITY);
        bool isDense = vST.x >= 0.0 && vST.x <= 0.5 &&
                       vST.y >= 0.5 && vST.y <= 1.0;
        outDensity = toD(isDense ? INIT_DENSITY_HIGH : INIT_DENSITY_LOW);
        return;
    }

    // Mouse calculation
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

    // Common calculations
    // Find where we will source our fluid from
    highp float w = float(uTexWidth);
    highp float h = float(uTexHeight);
    highp vec2 move_delta = fromV(texture(uTexV, vST)) * uDeltaTime * vec2(w, h);
    w = -1.0 / w;
    h = -1.0 / h;

    // Density calculation
    {
        // Get density around sample for advection
        // Interpolation is already done for us!
        highp float new = fromD(texture(uTexD, vST + move_delta));

        // Get density around current for diffusion
        // (n is -1, p is +1)
        // ((clipping isn't a problem b/c of wrapping))
        highp float c_0n = fromD(texture(uTexD, vST + vec2(0.0, -h)));
        highp float c_n0 = fromD(texture(uTexD, vST + vec2(-w, 0.0)));
        highp float c_p0 = fromD(texture(uTexD, vST + vec2(w, 0.0)));
        highp float c_0p = fromD(texture(uTexD, vST + vec2(0.0, h)));

        new += DENSITY_DIFFUSION * (c_0n + c_n0 + c_p0 + c_0p - 4.0 * new);
        // (no smoothing or anything here for the time being)
        // Implement me!

        // // FOR DEBUG FLOW!
        // // Top left of the screen is a source
        // if (vST.x > 0.1 && vST.x < 0.2 &&
        //     vST.y > 0.8 && vST.y < 0.9)
        //     new += SOURCE_SPEED * uDeltaTime;
        // // Bottom right of the screen is a sink
        // if (vST.x > 0.8 && vST.x < 0.9 &&
        //     vST.y > 0.1 && vST.y < 0.2)
        //     new -= SOURCE_SPEED * uDeltaTime;

        outDensity = toD(new);
    }

    // Velocity calculation
    {
        // Get velocity around sample for advection
        // Interpolation is already done for us!
        highp vec2 new = fromV(texture(uTexV, vST + move_delta));

        // Sample velocity gradient around pixel
        highp vec2 gradient = vec2(
            fromV(texture(uTexV, vST + vec2(w, 0.0))).x - fromV(texture(uTexV, vST + vec2(-w, 0.0))).x,
            fromV(texture(uTexV, vST + vec2(0.0, h))).y - fromV(texture(uTexV, vST + vec2(0.0, -h))).y);

        // Get velocities around current for diffusion
        // (n is -1, p is +1)
        // ((clipping isn't a problem b/c of wrapping))
        highp vec2 c_0n = fromV(texture(uTexV, vST + vec2(0.0, -h)));
        highp vec2 c_n0 = fromV(texture(uTexV, vST + vec2(-w, 0.0)));
        highp vec2 c_p0 = fromV(texture(uTexV, vST + vec2(w, 0.0)));
        highp vec2 c_0p = fromV(texture(uTexV, vST + vec2(0.0, h)));

        new += VELOCITY_DIFFUSION * (c_0n + c_n0 + c_p0 + c_0p - 4.0 * new);
        // (no smoothing or anything here for the time being)
        // Implement me!

        // Move it towards the gradient
        new += gradient * VELOCITY_GRADIENT_PULL * uDeltaTime;

        // Apply some slowdown
        new = mix(new, vec2(0.0, 0.0), min(DRAG_STRENGTH * uDeltaTime, 1.0));

        // Add in the mouse movement
        new += uMouseDir * mouseInfluence;

        outVelocity = toV(new);
    }
}`;

const SHADERSTR_FLUID_DRAW_FRAG = `#version 300 es
layout(location = 0) out mediump vec4 outColor;

in mediump vec2 vST;

uniform sampler2D uTexV;
uniform sampler2D uTexD;
uniform int uTexWidth;
uniform int uTexHeight;

const mediump vec4 COL = vec4(0.275, 0.573, 0.988, 1.0);

const mediump float UPRIGHTNESS = 0.2; // how much the normals tend upwards

const mediump vec3  LIGHT_DIR = normalize(vec3(-0.2, 0.4, -1.0));
const mediump float LIGHT_MIN = 0.1;
const mediump float LIGHT_MAX = 1.0;
const mediump float LIGHT_DIF = LIGHT_MAX - LIGHT_MIN;

${CHANNEL_ENCODING_MACROS}
${CHANNEL_DECODING_HELPERS}

void main() {
    mediump vec2 vel = fromV(texture(uTexV, vST));
    outColor = vec4((vel.x + VOffset) * VBoundi, (vel.y + VOffset) * VBoundi, 1.0, 1.0);

    // // Sample simulation at pixel
    // mediump vec2 vel = fromV(texture(uTexV, vST));
    // mediump float density = fromD(texture(uTexD, vST));

    // // Create a normal of the fluid's surface
    // mediump vec3 n = normalize(vec3(vel.x, vel.y, UPRIGHTNESS));

    // // Calculate lighting
    // mediump float l = max(0.0, dot(-LIGHT_DIR, n));
    // l = l * LIGHT_DIF + LIGHT_MIN;

    // // outColor = COL * l;
    // // outColor = COL * density * 0.1;
    // // outColor = COL * l * (density * 0.1 * 0.65 + 0.35);

    // // mediump vec2 mov = from(texture(uTex, vST));
    // // outColor = vec4(mov.x * 0.25 + 0.5, mov.y * 0.25 + 0.5, 1.0, 1.0);
}`;