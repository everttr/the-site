// Basic Naviar-Stokes implementation somewhat based on the one from:
// http://graphics.cs.cmu.edu/nsp/course/15-464/Fall09/papers/StamFluidforGames.pdf
// Simplex noise implementation based on the one from:
// https://github.com/SRombauts/SimplexNoise/blob/master/src/SimplexNoise.cpp

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

//#define ROUNDED_MOUSE_START
#define ROUNDED_MOUSE_END
${CHANNEL_ENCODING_CONSTS}
${CHANNEL_DECODING_HELPERS}
${CHANNEL_ENCODING_HELPERS}

// Simplex perlin noise randomization table (got via Wikipedia)
const lowp uint perm[256] = uint[256](
    151u, 160u, 137u,  91u,  90u,  15u, 131u,  13u, 201u,  95u,  96u,  53u, 194u, 233u,   7u, 225u,
    140u,  36u, 103u,  30u,  69u, 142u,   8u,  99u,  37u, 240u,  21u,  10u,  23u, 190u,   6u, 148u,
    247u, 120u, 234u,  75u,   0u,  26u, 197u,  62u,  94u, 252u, 219u, 203u, 117u,  35u,  11u,  32u,
     57u, 177u,  33u,  88u, 237u, 149u,  56u,  87u, 174u,  20u, 125u, 136u, 171u, 168u,  68u, 175u,
     74u, 165u,  71u, 134u, 139u,  48u,  27u, 166u,  77u, 146u, 158u, 231u,  83u, 111u, 229u, 122u,
     60u, 211u, 133u, 230u, 220u, 105u,  92u,  41u,  55u,  46u, 245u,  40u, 244u, 102u, 143u,  54u,
     65u,  25u,  63u, 161u,   1u, 216u,  80u,  73u, 209u,  76u, 132u, 187u, 208u,  89u,  18u, 169u,
    200u, 196u, 135u, 130u, 116u, 188u, 159u,  86u, 164u, 100u, 109u, 198u, 173u, 186u,   3u,  64u,
     52u, 217u, 226u, 250u, 124u, 123u,   5u, 202u,  38u, 147u, 118u, 126u, 255u,  82u,  85u, 212u,
    207u, 206u,  59u, 227u,  47u,  16u,  58u,  17u, 182u, 189u,  28u,  42u, 223u, 183u, 170u, 213u,
    119u, 248u, 152u,   2u,  44u, 154u, 163u,  70u, 221u, 153u, 101u, 155u, 167u,  43u, 172u,   9u,
    129u,  22u,  39u, 253u,  19u,  98u, 108u, 110u,  79u, 113u, 224u, 232u, 178u, 185u, 112u, 104u,
    218u, 246u,  97u, 228u, 251u,  34u, 242u, 193u, 238u, 210u, 144u,  12u, 191u, 179u, 162u, 241u,
     81u,  51u, 145u, 235u, 249u,  14u, 239u, 107u,  49u, 192u, 214u,  31u, 181u, 199u, 106u, 157u,
    184u,  84u, 204u, 176u, 115u, 121u,  50u,  45u, 127u,   4u, 150u, 254u, 138u, 236u, 205u,  93u,
    222u, 114u,  67u,  29u,  24u,  72u, 243u, 141u, 128u, 195u,  78u,  66u, 215u,  61u, 156u, 180u
);

lowp uint hash(int i) {
    return perm[i & 255];
}
highp float grad(int hash, highp vec3 pos) {
    hash &= 15;
    highp float u = hash < 8 ? pos.x : pos.y;
    highp float v = hash < 4 ? pos.y : hash == 12 || hash == 14 ? pos.x : pos.z;
    return (((hash & 1) == 1) ? -u : u) + (((hash & 2) == 2) ? -v : v);
}

const highp float F3 = 1.0 / 3.0;
const highp float G3 = 1.0 / 6.0;
const highp float G3x2 = 2.0 * G3;
const highp float G3x3m1 = 3.0 * G3 - 1.0;
highp float simplex(highp vec3 pos) {    
    // Calculate enclosing cell
    highp float s = (pos.x + pos.y + pos.z) * F3;
    mediump ivec3 ijk = ivec3(int(pos.x + s), int(pos.y + s), int(pos.z + s)); // cell index
    highp float t = (ijk.x + ijk.y + ijk.z) * G3;
    highp float vec3 origin = vec3(ijk.x - t, ijk.y - t, ijk.z - t); // cell origin
    highp float vec3 disp = pos - origin; // displacement within cell

    // Get offsets of simplex shape
    mediump ivec3 ijk1;
    mediump ivec3 ijk2;
    if (disp.x >= disp.y) {
        if (disp.y >= disp.z) {
            ijk1 = ivec3(1, 0, 0);
            ijk2 = ivec3(1, 1, 0);
        } else if (disp.x >= disp.z) {
            ijk1 = ivec3(1, 0, 0);
            ijk2 = ivec3(1, 0, 1);
        } else {
            ijk1 = ivec3(0, 0, 1);
            ijk2 = ivec3(1, 0, 1);
        }
    } else { // disp.x < disp.y
        if (disp.y < disp.z) {
            ijk1 = ivec3(0, 0, 1);
            ijk2 = ivec3(0, 1, 1);
        } else if (disp.x < disp.z) {
            ijk1 = ivec3(0, 1, 0);
            ijk2 = ivec3(0, 1, 1);
        } else {
            ijk1 = ivec3(0, 1, 0);
            ijk2 = ivec3(1, 1, 0);
        }
    }

    // Apply those offsets
    highp vec3 disp1 = disp + vec3(G3 - ijk1.x, G3 - ijk1.y, G3 - ijk1.z);
    highp vec3 disp2 = disp + vec3(G3x2 - ijk2.x, G3x2 - ijk2.y, G3x2 - ijk2.z);
    highp vec3 disp3 = disp + vec3(G3x3m1, G3x3m1, G3x3m1);

    // Hash based on corners
    lowp uvec4 gi = uvec4(
        hash(ijk.x + hash(ijk.y + hash(ijk.z))),
        hash(ijk.x + ijk1.x + hash(ijk.y + ijk1.y + hash(ijk.z + ijk1.z))),
        hash(ijk.x + ijk2.x + hash(ijk.y + ijk2.y + hash(ijk.z + ijk2.z))),
        hash(ijk.x + 1 + hash(ijk.y + 1 + hash(ijk.z + 1))),
    );

    // Calculate corner contributions
    float n0, n1, n2, n3;
    t = 0.6 - disp.x*disp.x - disp.y*disp.y - disp.z*disp.z;
    if (t < 0.0) n0 = 0.0;
    else {
        t *= t;
        n0 = t * t * grad(gi.x, disp);
    }
    t = 0.6 - disp1.x*disp1.x - disp1.y*disp1.y - disp1.z*disp1.z;
    if (t < 0.0) n1 = 0.0;
    else {
        t *= t;
        n1 = t * t * grad(gi.y, disp1);
    }
    t = 0.6 - disp2.x*disp2.x - disp2.y*disp2.y - disp2.z*disp2.z;
    if (t < 0.0) n2 = 0.0;
    else {
        t *= t;
        n2 = t * t * grad(gi.z, disp2);
    }
    t = 0.6 - disp3.x*disp3.x - disp3.y*disp3.y - disp3.z*disp3.z;
    if (t < 0.0) n3 = 0.0;
    else {
        t *= t;
        n3 = t * t * grad(gi.w, disp3);
    }

    // Combine corners and normalize to [-1, 1] for final value
    return (n0 + n1 + n2 + n3) * 32.0;
}

const highp float NOISE_SCALE = 1.0;

void main() {
    if (uInitializeFields) {
        outVelocityX = toV(INIT_VELOCITY.x);
        outVelocityY = toV(INIT_VELOCITY.y);
        outDensity = toD(
            vST.x >= 0.0 && vST.x <= 0.4 &&
            vST.y >= 0.5 && vST.y <= 1.0
                ? INIT_DENSITY_HIGH : INIT_DENSITY_LOW);
        return;
    }

    // Common calculations
    highp vec2 newV = vec2(fromV(texture(uTexVX, vST)), fromV(texture(uTexVY, vST)));
    highp float w = uAspect / float(uTexWidth);
    highp float h = 1.0 / float(uTexHeight);
    // sample noise on surface of torus (so it loops in both directions)
    highp vec3 noisePos = vec3(vST.x * uAspect, vST.y, 0.0);
    noisePos = vec3(sin(noisePos.x), (2.0 + cos(noisePos.x)) * sin(noisePos.y), (2.0 + cos(noisePos.x)) * cos(noisePos.y));
    highp float noise = simplex(noise * NOISE_SCALE);

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

        // outDensity = toD(newD);
        outDensity = toD((simplex(vST.x, vST.y, 0.0) * 0.5 + 1.0) * 6.0);
        // ^^^^ SIMPLY FOR DEBUG RENDERING ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
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