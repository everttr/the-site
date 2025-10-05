// Basic Naviar-Stokes implementation somewhat based on the one from:
// http://graphics.cs.cmu.edu/nsp/course/15-464/Fall09/papers/StamFluidforGames.pdf

/////////////////////////////////////////////////////
/*          ~~~ Globals for Debugging ~~~          */
/////////////////////////////////////////////////////
// Helpers to encode higher precision signed floats into the frame buffer.
// A bit hacky, but it'll have to work.
let FORCE_ONE_CHANNEL_ENCODING = false;
let CHANNEL_ENCODING_MACROS = `
#define VBound 0.025
#define VBoundi (1.0 / VBound)
#define VOffset (0.5 * VBound)
#define PBound 20.0
#define PBoundi (1.0 / PBound)
#define POffset (0.5 * PBound)
#define DMax 100.0
#define DMaxi 1.0 / DMax
#define C4 16581375.0
#define C4i (1.0 / C4)
#define C3 65025.0
#define C3i (1.0 / C3)
#define C2 255.0
#define C2i (1.0 / C2)`
let CHANNEL_DECODING_HELPERS = `
highp float fromV(highp vec4 v) {
    return (
        (v.r) +
        (v.g * C2i) +
        (v.b * C3i) +
        (v.a * C4i)
        ) * VBound - VOffset;
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
highp float fromP(highp vec4 p) {
    return (
        (p.r) +
        (p.g * C2i) +
        (p.b * C3i) +
        (p.a * C4i)
        ) * PBound - POffset;
}`;
let CHANNEL_ENCODING_HELPERS = `
highp vec4 toV(highp float i) {
    i += VOffset;
    i *= VBoundi;
    i = clamp(i, 0.0, 1.0);
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
}
highp vec4 toD(highp float i) {
    i *= DMaxi;
    i = clamp(i, 0.0, 1.0);
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
highp vec4 toP(highp float i) {
    i += POffset;
    i *= PBoundi;
    i = clamp(i, 0.0, 1.0);
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
layout(location = 0) out highp vec4 outVelocityX;
layout(location = 1) out highp vec4 outVelocityY;
layout(location = 2) out highp vec4 outVelocityTempX;
layout(location = 3) out highp vec4 outVelocityTempY;
layout(location = 4) out highp vec4 outDensity;
layout(location = 5) out highp vec4 outDensityTemp;

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

uniform sampler2D uTexVX;
uniform sampler2D uTexVY;
uniform sampler2D uTexVTempX;
uniform sampler2D uTexVTempY;
uniform sampler2D uTexD;
uniform sampler2D uTexDTemp;
uniform mediump int uTexWidth;
uniform mediump int uTexHeight;
uniform highp float uAspect;

uniform highp float uDeltaTime;
uniform highp vec2 uMouseStart;
uniform highp vec2 uMouseDir;
uniform highp float uMouseMag;

const highp vec2 INIT_VELOCITY = vec2(0.0, 0.0);
const highp float INIT_DENSITY_LOW = 0.0;
const highp float INIT_DENSITY_HIGH = 10.0;

const highp float SOURCE_SPEED = 7.50;
const highp float DENSITY_DIFFUSION = 2.5;
const highp float VELOCITY_DIFFUSION = 2.25;

const highp float MOUSE_MAX_DIST = 0.03;
const highp float MOUSE_AWAY_AMOUNT = 0.8;
const highp float MOUSE_STRENGTH = 0.6;
const highp float MOUSE_FALLOFF_EXP = 0.8;

const highp float sqrt2 = 1.41421356237;
const highp float sqrt2i = 1.0 / sqrt2;

//#define ROUNDED_MOUSE_START
${CHANNEL_ENCODING_MACROS}
${CHANNEL_DECODING_HELPERS}
${CHANNEL_DECODING_HELPERS_PROJECTION}
${CHANNEL_ENCODING_HELPERS}
${CHANNEL_ENCODING_HELPERS_PROJECTION}

void main() {
    if (uInitializeFields) {
        outVelocityX = toV(INIT_VELOCITY.x);
        outVelocityY = toV(INIT_VELOCITY.y);
        outDensity = toD(
            vST.x >= 0.0 && vST.x <= 0.5 / uAspect &&
            vST.y >= 0.5 && vST.y <= 1.0
                ? INIT_DENSITY_HIGH : INIT_DENSITY_LOW);
        return;
    }

    // Common calculations
    highp vec2 newV = vec2(fromV(texture(uTexVX, vST)), fromV(texture(uTexVY, vST)));
    highp float w = uAspect / float(uTexWidth);
    highp float h = 1.0 / float(uTexHeight);

    // Velocity calculation
    {
        // DEBUG! for storing temp values til the render stage
        outVelocityTempX = texture(uTexVTempX, vST);
        outVelocityTempY = texture(uTexVTempY, vST);

        // Get velocities around current for & projection
        // (n is -1, p is +1)
        // ((clipping isn't a problem b/c of wrapping))
        highp vec2 c_0n = vec2(fromV(texture(uTexVX, vST + vec2(0.0, -h))), fromV(texture(uTexVY, vST + vec2(0.0, -h))));
        highp vec2 c_n0 = vec2(fromV(texture(uTexVX, vST + vec2(-w, 0.0))), fromV(texture(uTexVY, vST + vec2(-w, 0.0))));
        highp vec2 c_p0 = vec2(fromV(texture(uTexVX, vST + vec2(w, 0.0))), fromV(texture(uTexVY, vST + vec2(w, 0.0))));
        highp vec2 c_0p = vec2(fromV(texture(uTexVX, vST + vec2(0.0, h))), fromV(texture(uTexVY, vST + vec2(0.0, h))));
        
        // Sample nearby "projected" values
        highp float p_0n = fromP(texture(uTexVTempY, vST + vec2(0.0, -h)));
        highp float p_n0 = fromP(texture(uTexVTempY, vST + vec2(-w, 0.0)));
        highp float p_p0 = fromP(texture(uTexVTempY, vST + vec2(w, 0.0)));
        highp float p_0p = fromP(texture(uTexVTempY, vST + vec2(0.0, h)));

        if ((uSimID & SIMID_INPUTS) == SIMID_INPUTS) {
            // Mouse calculation
            // Get proximity to mouse (line)
            highp vec2 lineDisp = vST - uMouseStart; // relative offset
            highp float lineProx = dot(lineDisp, uMouseDir); // distance/shadow along mouse dir
            lineDisp = uMouseStart + uMouseDir * lineProx; // closest point on line
            lineDisp = vST - lineDisp; // normal to pixel
            lineDisp.x *= uAspect;
            lineProx = lineProx > 0.0 && lineProx < uMouseMag ? length(lineDisp) : MOUSE_MAX_DIST;
            
            // Get min of that and circular ends proximity
            highp vec2 circleDispEnd = vST - (uMouseStart + uMouseDir * uMouseMag);
            circleDispEnd.x *= uAspect;
            highp float circleProxEnd = length(circleDispEnd);
            highp vec2 mousePushDir = lineProx < circleProxEnd
                ? lineDisp / lineProx
                : circleDispEnd /  circleProxEnd;            
            highp float prox = min(lineProx, circleProxEnd);
            #ifdef ROUNDED_MOUSE_START
            highp vec2 circleDispStart = vST - uMouseStart;
            circleDispStart.x *= uAspect;
            highp float circleProxStart = length(circleDispStart);
            mousePushDir = circleProxStart < lineProx && circleProxStart < circleProxEnd
                ? circleDispStart / circleProxStart
                : mousePushDir;
            prox =  min(prox, circleProxStart);
            #endif
            if (prox == 0.0) mousePushDir = vec2(0.0, 0.0); // divide by 0 protection!

            // Calculate influence based on proximity
            highp float mouseInfluence = max(0.0, MOUSE_MAX_DIST - prox) / MOUSE_MAX_DIST;
            mouseInfluence = pow(mouseInfluence, MOUSE_FALLOFF_EXP) * uDeltaTime * uMouseMag * MOUSE_STRENGTH;

            // Add in the mouse movement, some pushing away, some going with mouse movement
            newV += mouseInfluence * (mousePushDir * MOUSE_AWAY_AMOUNT + uMouseDir);

            // Save initial velocity for diffuse step
            outVelocityTempX = toV(newV.x);
            outVelocityTempY = toV(newV.y);
        }

        else if ((uSimID & SIMID_V_DIFFUSE) == SIMID_V_DIFFUSE) {
            highp vec4 initialVelX = texture(uTexVTempX, vST);
            highp vec4 initialVelY = texture(uTexVTempY, vST);

            highp float vel_diffusion = VELOCITY_DIFFUSION * uDeltaTime;
            newV = (vec2(fromV(initialVelX), fromV(initialVelY)) + vel_diffusion * (c_0n + c_n0 + c_p0 + c_0p)) / (1.0 + 4.0 * vel_diffusion);

            // Pass on start-of-step velocity to next diffuse iteration
            outVelocityTempX = initialVelX;
            outVelocityTempY = initialVelY;
        }

        else if ((uSimID & SIMID_V_PROJECT_G) == SIMID_V_PROJECT_G) {
            // Find velocity gradient around/at pixel
            highp vec4 grad = toP(50000.0 * (c_p0.x - c_n0.x + c_0p.y - c_0n.y));
            // Output as initial values of projection variables (gradient, project)
            // (reused velocity packing code)
            outVelocityTempX = grad;
            outVelocityTempY = grad; // (in the model code, project starts at 0.0. I think this is more efficient for fewer iterations)
        }

        else if ((uSimID & SIMID_V_PROJECT_R) == SIMID_V_PROJECT_R) {
            highp vec4 grad = texture(uTexVTempX, vST);

            // Iteratively relax each projected value to be 25% more than the average of its gradients
            // and neighboring projected values? I don't really understand this one if I'm honest
            highp float newP = (fromP(grad) + p_0n + p_n0 + p_p0 + p_0p) * 0.25;

            outVelocityTempX = grad;
            outVelocityTempY = toP(newP);
        }

        else if ((uSimID & SIMID_V_PROJECT_A) == SIMID_V_PROJECT_A) {
            // Finally, move each pixel's velocity away from the gradient of its projected values
            newV.x += 0.000005 * (p_p0 - p_n0);
            newV.y += 0.000005 * (p_0p - p_0n);
        }

        else if ((uSimID & SIMID_V_ADVECT) == SIMID_V_ADVECT) {
            // Get velocity around sample for advection
            // Interpolation is already done for us!
            highp vec2 samplePos = vST - newV * uDeltaTime / vec2(w, h);
            newV = vec2(fromV(texture(uTexVX, samplePos)), fromV(texture(uTexVY, samplePos)));
        }

        outVelocityX = toV(newV.x);
        outVelocityY = toV(newV.y);
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

            // Write initial density for diffusion steps to use
            outDensityTemp = toD(newD);
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
            newD = (fromD(texture(uTexDTemp, vST)) + dens_diffusion * (c_0n + c_n0 + c_p0 + c_0p)) / (1.0 + 4.0 * dens_diffusion);
        }

        else if ((uSimID & SIMID_D_ADVECT) == SIMID_D_ADVECT) {
            // Get density around sample for advection
            // Interpolation is already done for us!
            // (velocity sample is safe to use because sampled after done relaxing)
            newD = fromD(texture(uTexD, vST - newV * uDeltaTime / vec2(w, h)));
        }

        outDensity = toD(newD);
    }
}`;

const SHADERSTR_FLUID_DRAW_FRAG = `#version 300 es
layout(location = 0) out mediump vec4 outColor;

in mediump vec2 vST;

uniform sampler2D uTexVX;
uniform sampler2D uTexVY;
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
${CHANNEL_DECODING_HELPERS_PROJECTION}

void main() {
    // mediump vec2 vel = vec2(fromV(texture(uTexVX, vST)), fromV(texture(uTexVY, vST)));
    // outColor = vec4(0.5 + vel.x * VBoundi * 7.0, 0.5 + vel.y * VBoundi * 7.0, 0.5, 1.0);

    // mediump float c = fromP(texture(uTexD, vST));
    // c /= 20.0;
    // outColor = vec4(c, c, c, 1.0);

    // Sample simulation at pixel
    mediump vec2 vel = vec2(fromV(texture(uTexVX, vST)), fromV(texture(uTexVY, vST)));
    mediump float density = fromD(texture(uTexD, vST));

    // // Create a normal of the fluid's surface
    // mediump vec3 n = normalize(vec3(vel.x, vel.y, UPRIGHTNESS));

    // // Calculate lighting
    // mediump float l = max(0.0, dot(-LIGHT_DIR, n));
    // l = l * LIGHT_DIF + LIGHT_MIN;

    // outColor = COL * l;
    outColor = COL * sqrt(density);
    // outColor = COL * l * (density * 0.1 * 0.65 + 0.35);

    // mediump vec2 mov = from(texture(uTex, vST));
    // outColor = vec4(mov.x * 0.25 + 0.5, mov.y * 0.25 + 0.5, 1.0, 1.0);
}`;