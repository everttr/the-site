// Basic Naviar-Stokes implementation somewhat based on the one from:
// http://graphics.cs.cmu.edu/nsp/course/15-464/Fall09/papers/StamFluidforGames.pdf

/////////////////////////////////////////////////////
/*          ~~~ Globals for Debugging ~~~          */
/////////////////////////////////////////////////////
// Helpers to encode higher precision signed floats into the frame buffer.
// A bit hacky, but it'll have to work.
let FORCE_ONE_CHANNEL_ENCODING = false;
let CHANNEL_ENCODING_CONSTS = `
const highp float VBound = 0.025;
const highp float VBoundi = (1.0 / VBound);
const highp float PBound = 20.0;
const highp float PBoundi = (1.0 / PBound);
const highp float DBound = 100.0;
const highp float DBoundi = 1.0 / DBound;
const highp float C4 = 16581375.0;
const highp float C4i = (1.0 / C4);
const highp float C3 = 65025.0;
const highp float C3i = (1.0 / C3);
const highp float C2 = 255.0;
const highp float C2i = (1.0 / C2);`
let CHANNEL_DECODING_HELPERS = `
#define fromV(i) ((from(i) - 0.5) * VBound)
#define fromP(i) ((from(i) - 0.5) * PBound)
#define fromD(i) (from(i) * DBound)
highp float from(highp vec4 v) {
    return (
        (v.r) +
        (v.g * C2i) +
        (v.b * C3i) +
        (v.a * C4i));
}`;
let CHANNEL_ENCODING_HELPERS = `
#define toV(i) (to((i * VBoundi) + 0.5))
#define toP(i) (to((i * PBoundi) + 0.5))
#define toD(i) (to(i * DBoundi))
highp vec4 to(highp float i) {
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

#define MOUSE_BUFFER_SIZE 2
uniform highp vec2 uMouseStart[MOUSE_BUFFER_SIZE];
uniform highp vec2 uMouseDir[MOUSE_BUFFER_SIZE];
uniform highp float uMouseMag[MOUSE_BUFFER_SIZE];

const highp vec2 INIT_VELOCITY = vec2(0.0, 0.0);
const highp float INIT_DENSITY_LOW = 0.0;
const highp float INIT_DENSITY_HIGH = 10.0;

const highp float SOURCE_SPEED = 7.50;
const highp float DENSITY_DIFFUSION = 2.5;
const highp float VELOCITY_DIFFUSION = 2.25;

const highp float MOUSE_MAX_DIST = 0.015;
const highp float MOUSE_AWAY_AMOUNT = 0.8;
const highp float MOUSE_STRENGTH = 0.7;
const highp float MOUSE_FALLOFF_EXP = 8.5; // must be high or the low-precision side effect of a hollow mouse influence is visible

const highp float sqrt2 = 1.41421356237;
const highp float sqrt2i = 1.0 / sqrt2;

//#define ROUNDED_MOUSE_START
#define ROUNDED_MOUSE_END
${CHANNEL_ENCODING_CONSTS}
${CHANNEL_DECODING_HELPERS}
${CHANNEL_ENCODING_HELPERS}

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
            highp float proxCur, prox = MOUSE_MAX_DIST, mag = 0.0;
            highp vec2 disp, mousePushDir = vec2(0.0, 0.0), mouseDir = vec2(0.0, 0.0);
            for (lowp int i = 0; i < MOUSE_BUFFER_SIZE; ++i) {
                // Get proximity to mouse (line)
                disp = vST - uMouseStart[i]; // relative offset
                disp.x /= uAspect;
                proxCur = dot(disp, uMouseDir[i]); // shadow on line
                proxCur = proxCur >= 0.0 && proxCur < uMouseMag[i]
                    ? abs(dot(disp, vec2(uMouseDir[i].y * uAspect, -uMouseDir[i].x))) // dist along normal of movement vector
                    : MOUSE_MAX_DIST;
                if (proxCur < prox) {
                    prox = proxCur;
                    mousePushDir = disp / proxCur;
                    mag = uMouseMag[i];
                    mouseDir = uMouseDir[i];
                }

                // Get min of that and circular ends proximity
                #ifdef ROUNDED_MOUSE_START
                disp = vST - uMouseStart[i];
                proxCur = length(vec2(disp.x * uAspect, disp.y));
                if (proxCur < prox) {
                    prox = proxCur;
                    mousePushDir = disp / proxCur;
                    mag = uMouseMag[i];
                    mouseDir = uMouseDir[i];
                }
                #endif
                #ifdef ROUNDED_MOUSE_END
                disp = vST - (uMouseStart[i] + uMouseDir[i] * uMouseMag[i]);
                proxCur = length(vec2(disp.x * uAspect, disp.y));
                if (proxCur < prox) {
                    prox = proxCur;
                    mousePushDir = disp / proxCur;
                    mag = uMouseMag[i];
                    mouseDir = uMouseDir[i];
                }
                #endif
            }
            if (prox == 0.0) mousePushDir = vec2(1.0, 0.0); // divide by 0 protection!

            // Calculate influence based on proximity
            highp float mouseInfluence = max(0.0, 1.0 - prox / MOUSE_MAX_DIST);
            mouseInfluence = pow(mouseInfluence, MOUSE_FALLOFF_EXP) * uDeltaTime * mag * MOUSE_STRENGTH;

            // Add in the mouse movement, some pushing away, some going with mouse movement
            newV += mouseInfluence * (mousePushDir * MOUSE_AWAY_AMOUNT + mouseDir);

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
uniform mediump int uTexWidth;
uniform mediump int uTexHeight;

uniform mediump float uDeltaTime;
uniform mediump float uAspect;

const mediump vec4 COL = vec4(0.275, 0.573, 0.988, 1.0);

const mediump float UPRIGHTNESS = 0.2; // how much the normals tend upwards

const mediump vec3  LIGHT_DIR = normalize(vec3(-0.2, 0.4, -1.0));
const mediump float LIGHT_MIN = 0.1;
const mediump float LIGHT_MAX = 1.0;
const mediump float LIGHT_DIF = LIGHT_MAX - LIGHT_MIN;

#define FUTURE_INTERPOLATION
${CHANNEL_ENCODING_CONSTS}
${CHANNEL_DECODING_HELPERS}

void main() {
    // Sample simulation at pixel
    // but first do a forward-looking advect step in case we're future-interpolating
    mediump vec2 vel;
    mediump float density;
    vel = vec2(fromV(texture(uTexVX, vST)), fromV(texture(uTexVY, vST)));
    #ifdef FUTURE_INTERPOLATION
    mediump vec2 vel2TextureCoords = vec2(float(uTexWidth) / uAspect, float(uTexHeight)) * uDeltaTime;
    vel *= vel2TextureCoords;
    vel = vec2(fromV(texture(uTexVX, vST + vel)), fromV(texture(uTexVY, vST + vel)));
    density = fromD(texture(uTexD, vST + vel * vel2TextureCoords));
    #else
    density = fromD(texture(uTexD, vST));
    #endif

    // outColor = vec4(0.5 + vel.x * VBoundi * 7.0, 0.5 + vel.y * VBoundi * 7.0, 0.5, 1.0);

    // mediump float c = fromP(texture(uTexD, vST));
    // c /= 20.0;
    // outColor = vec4(c, c, c, 1.0);

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