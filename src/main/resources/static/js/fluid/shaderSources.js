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
#define POffset 5.0
#define PBound 10.0
#define PBoundi 1.0 / PBound
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
let CHANNEL_DECODING_HELPERS_PROJECTION = `
highp vec2 fromP(highp vec4 v) {
    return vec2(
        (v.r) +
        (v.g * C2i),
        (v.b) +
        (v.a * C2i)
        ) * PBound - vec2(POffset, POffset);
}`;
let CHANNEL_ENCODING_HELPERS = `
highp vec4 toV(highp vec2 i) {
    i += vec2(VOffset, VOffset);
    i *= VBoundi;
    i = vec2(min(VBound, max(0.0, i.x)), min(VBound, max(0.0, i.y)));
    highp float t;
    highp vec4 o = vec4(0.0, 0.0, 0.0, 0.0);
    // dimension 1 channel 2 (least significant)
    t = mod(i.x, C2i);
    i.x -= t;
    o.g = t * C2;
    // dimension 1 channel 1 (most significant)
    o.r = i.x;
    // dimension 2 channel 2 (least significant)
    t = mod(i.y, C2i);
    i.y -= t;
    o.a = t * C2;
    // dimension 2 channel 1 (most significant)
    o.b = i.y;
    return o;
}
highp vec4 toD(highp float i) {
    i *= DMaxi;
    i = min(DMax, max(0.0, i));
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
let CHANNEL_ENCODING_HELPERS_PROJECTION = `
highp vec4 toP(highp vec2 i) {
    i += vec2(POffset, POffset);
    i *= PBoundi;
    i = vec2(min(PBound, max(0.0, i.x)), min(PBound, max(0.0, i.y)));
    highp float t;
    highp vec4 o = vec4(0.0, 0.0, 0.0, 0.0);
    // dimension 1 channel 2 (least significant)
    t = mod(i.x, C2i);
    i.x -= t;
    o.g = t * C2;
    // dimension 1 channel 1 (most significant)
    o.r = i.x;
    // dimension 2 channel 2 (least significant)
    t = mod(i.y, C2i);
    i.y -= t;
    o.a = t * C2;
    // dimension 2 channel 1 (most significant)
    o.b = i.y;
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
layout(location = 2) out highp vec4 outProject;

in highp vec2 vST;

uniform bool uInitializeFields;
uniform lowp uint uSimID;
const lowp uint SIMID_D_DIFFUSE = 1u;
const lowp uint SIMID_D_ADVECT = 2u;
const lowp uint SIMID_V_DIFFUSE = 4u;
const lowp uint SIMID_V_PROJECT_G = 8u; // gradient
const lowp uint SIMID_V_PROJECT_R = 16u; // relax
const lowp uint SIMID_V_PROJECT_A = 32u; // apply
const lowp uint SIMID_V_ADVECT = 64u;
const lowp uint SIMID_INPUTS = 128u;

uniform sampler2D uTexV;
uniform sampler2D uTexP;
uniform sampler2D uTexD;
uniform int uTexWidth;
uniform int uTexHeight;

uniform highp float uDeltaTime;
uniform highp vec2 uMouseStart;
uniform highp vec2 uMouseDir;
uniform highp float uMouseMag;

const highp vec2 INIT_VELOCITY = vec2(0.0, 0.0);
const highp float INIT_DENSITY_LOW = 0.0;
const highp float INIT_DENSITY_HIGH = 10.0;

const highp float SPIRAL_STRENGTH = 0.0;
const highp float SOURCE_SPEED = 2.50;
const highp float DENSITY_DIFFUSION = 10.0;
const highp float VELOCITY_DIFFUSION = 25.0;

const highp float MOUSE_MAX_DIST = 0.03;
const highp float MOUSE_STRENGTH = 14.0;
const highp float MOUSE_FALLOFF_EXP = 1.25;

const highp float sqrt2 = 1.41421356237;
const highp float sqrt2i = 1.0 / sqrt2;

//#define ROUNDED_MOUSE_CORNERS
${CHANNEL_ENCODING_MACROS}
${CHANNEL_DECODING_HELPERS}
${CHANNEL_DECODING_HELPERS_PROJECTION}
${CHANNEL_ENCODING_HELPERS}
${CHANNEL_ENCODING_HELPERS_PROJECTION}

void main() {
    if (uInitializeFields) {
        outVelocity = toV(INIT_VELOCITY);
        bool isDense = vST.x >= 0.0 && vST.x <= 0.5 &&
                       vST.y >= 0.5 && vST.y <= 1.0;
        outDensity = toD(isDense ? INIT_DENSITY_HIGH : INIT_DENSITY_LOW);
        return;
    }

    // Common calculations
    highp vec2 newV = fromV(texture(uTexV, vST));
    highp float w = 1.0 / float(uTexWidth);
    highp float h = 1.0 / float(uTexHeight);

    // Velocity calculation
    {        
        // Get velocities around current for & projection
        // (n is -1, p is +1)
        // ((clipping isn't a problem b/c of wrapping))
        highp vec2 c_0n = fromV(texture(uTexV, vST + vec2(0.0, -h)));
        highp vec2 c_n0 = fromV(texture(uTexV, vST + vec2(-w, 0.0)));
        highp vec2 c_p0 = fromV(texture(uTexV, vST + vec2(w, 0.0)));
        highp vec2 c_0p = fromV(texture(uTexV, vST + vec2(0.0, h)));
        
        // Sample nearby "projected" values
        highp float p_0n = fromP(texture(uTexP, vST + vec2(0.0, -h))).y;
        highp float p_n0 = fromP(texture(uTexP, vST + vec2(-w, 0.0))).y;
        highp float p_p0 = fromP(texture(uTexP, vST + vec2(w, 0.0))).y;
        highp float p_0p = fromP(texture(uTexP, vST + vec2(0.0, h))).y;

        if ((uSimID & SIMID_INPUTS) == SIMID_INPUTS) {
            // Mouse calculation
            // Get proximity to mouse (capsule-shaped influence)
            highp vec2 mouseEnd = uMouseStart + uMouseDir * uMouseMag;
            highp vec2 temp = vST - uMouseStart; // relative offset
            highp float alongLine = dot(temp, uMouseDir); // distance/shadow along mouse dir
            temp = uMouseStart + uMouseDir * alongLine; // closest point on line
            highp float lineProx = alongLine > 0.0 && alongLine < uMouseMag ? distance(vST, temp) : MOUSE_MAX_DIST;
            #ifdef ROUNDED_MOUSE_CORNERS
            highp float circleProxStart = distance(vST, uMouseStart);
            highp float circleProxEnd = distance(vST, mouseEnd);
            #endif
            highp float mouseInfluence =
            #ifdef ROUNDED_MOUSE_CORNERS
                min(lineProx, min(circleProxStart, circleProxEnd));
            #else
                lineProx;
            #endif
            mouseInfluence = max(0.0, MOUSE_MAX_DIST - mouseInfluence) / MOUSE_MAX_DIST;
            mouseInfluence = pow(mouseInfluence, MOUSE_FALLOFF_EXP) * MOUSE_STRENGTH;

            // Add in the mouse movement
            newV += uMouseDir * uMouseMag * mouseInfluence;

            // FOR DEBUG FLOW!
            // Middle part swirls in a spiral
            highp vec2 toCenter = vec2(0.5, 0.5) - vST;
            highp float centerDist = length(toCenter);
            toCenter /= centerDist;
            if (centerDist <= 0.25)
                newV += vec2(toCenter.y, -toCenter.x) * SPIRAL_STRENGTH * uDeltaTime;
        }

        else if ((uSimID & SIMID_V_DIFFUSE) == SIMID_V_DIFFUSE) {
            highp float vel_diffusion = VELOCITY_DIFFUSION * uDeltaTime;
            newV = (newV + vel_diffusion * (c_0n + c_n0 + c_p0 + c_0p)) / (1.0 + 4.0 * vel_diffusion);
        }

        else if ((uSimID & SIMID_V_PROJECT_G) == SIMID_V_PROJECT_G) {
            // Find velocity gradient around/at pixel
            highp float grad = -0.5 * (c_p0.x - c_n0.x + c_0p.y - c_0n.y);
            // Output as initial values of projection variables (gradient, project)
            // (reused velocity packing code)
            outProject = toP(vec2(grad, grad));
        }


        else if ((uSimID & SIMID_V_PROJECT_R) == SIMID_V_PROJECT_R) {
            highp vec2 pVars = fromP(texture(uTexP, vST));

            // Iteratively relax each projected value to be 25% more than the average of its gradients
            // and neighboring projected values? I don't really understand this one if I'm honest
            pVars.y = (pVars.x + p_0n + p_n0 + p_p0 + p_0p) * 0.25;

            outProject = toP(pVars);
        }

        else if ((uSimID & SIMID_V_PROJECT_A) == SIMID_V_PROJECT_A) {
            highp vec2 pVars = fromP(texture(uTexP, vST));
            // Finally, move each pixel's velocity away from the gradient of its projected values
            newV.x -= 0.5 * (p_p0 - p_n0);
            newV.y -= 0.5 * (p_0p - p_0n);
        }

        else if ((uSimID & SIMID_V_ADVECT) == SIMID_V_ADVECT) {
            // Get velocity around sample for advection
            // Interpolation is already done for us!
            newV = fromV(texture(uTexV, vST + newV * uDeltaTime / vec2(w, h)));
        }

        outVelocity = toV(newV);
    }

    // Density calculation
    {
        highp float newD = fromD(texture(uTexD, vST));

        if ((uSimID & SIMID_INPUTS) == SIMID_INPUTS) {
            // FOR DEBUG FLOW!
            // Top left of the screen is a source
            if (vST.x > 0.1 && vST.x < 0.2 &&
                vST.y > 0.8 && vST.y < 0.9)
                newD += SOURCE_SPEED * uDeltaTime;
            // Bottom right of the screen is a sink
            if (vST.x > 0.8 && vST.x < 0.9 &&
                vST.y > 0.1 && vST.y < 0.2)
                newD -= SOURCE_SPEED * uDeltaTime;
        }

        else if ((uSimID & SIMID_D_DIFFUSE) == SIMID_D_DIFFUSE) {
            // Get density around current for diffusion
            // (n is -1, p is +1)
            // ((clipping isn't a problem b/c of wrapping))
            highp float c_0n = fromD(texture(uTexD, vST + vec2(0.0, -h)));
            highp float c_n0 = fromD(texture(uTexD, vST + vec2(-w, 0.0)));
            highp float c_p0 = fromD(texture(uTexD, vST + vec2(w, 0.0)));
            highp float c_0p = fromD(texture(uTexD, vST + vec2(0.0, h)));

            highp float dens_diffusion = DENSITY_DIFFUSION * uDeltaTime;
            newD = (newD + dens_diffusion * (c_0n + c_n0 + c_p0 + c_0p)) / (1.0 + 4.0 * dens_diffusion);
        }

        else if ((uSimID & SIMID_D_ADVECT) == SIMID_D_ADVECT) {
            // Get density around sample for advection
            // Interpolation is already done for us!
            // (velocity sample is safe to use because sampled after done relaxing)
            newD = fromD(texture(uTexD, vST + newV * uDeltaTime / vec2(w, h)));
        }

        outDensity = toD(newD);
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
    // mediump vec2 vel = fromV(texture(uTexV, vST));
    // outColor = vec4((vel.x + VOffset) * VBoundi, (vel.y + VOffset) * VBoundi, 0.5, 1.0);

    // Sample simulation at pixel
    mediump vec2 vel = fromV(texture(uTexV, vST));
    mediump float density = fromD(texture(uTexD, vST));

    // // Create a normal of the fluid's surface
    // mediump vec3 n = normalize(vec3(vel.x, vel.y, UPRIGHTNESS));

    // // Calculate lighting
    // mediump float l = max(0.0, dot(-LIGHT_DIR, n));
    // l = l * LIGHT_DIF + LIGHT_MIN;

    // outColor = COL * l;
    outColor = COL * pow(density, 0.5);
    // outColor = COL * l * (density * 0.1 * 0.65 + 0.35);

    // mediump vec2 mov = from(texture(uTex, vST));
    // outColor = vec4(mov.x * 0.25 + 0.5, mov.y * 0.25 + 0.5, 1.0, 1.0);
}`;