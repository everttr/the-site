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

const highp float LERP_STRENGTH = 2.0;
const highp float MOUSE_MAX_DIST = 0.005;
const highp float MOUSE_STRENGTH = 0.5;
const highp float MOUSE_FALLOFF_EXP = 0.8;

#define DISABLE_ROUNDED_CORNERS

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
    highp vec4 node_n0 = texture2D(uTex, vST + vec2(-1.0 / float(uTexWidth), 0.0));
    highp vec4 node_0n = texture2D(uTex, vST + vec2(0.0, -1.0 / float(uTexHeight)));
    highp vec4 node_00 = texture2D(uTex, vST);
    highp vec4 node_p0 = texture2D(uTex, vST + vec2(1.0 / float(uTexWidth), 0.0));
    highp vec4 node_0p = texture2D(uTex, vST + vec2(0.0, 1.0 / float(uTexHeight)));

    // (other sampled points not actually used at this point)
    // Just increase brightness over time to test
    // (the *0's are so I'm not yelled at for unused variables)
    // highp vec4 ave = node_00 * 0.2 + node_n0 * 0.2 + node_0n * 0.2 + node_p0 * 0.2 + node_0p * 0.2;
    highp vec4 col;
    if (vST.x > 0.1 && vST.x < 0.2 &&
        vST.y > 0.8 && vST.y < 0.9)
        col = vec4(1.0, 1.0, 1.0, 1.0);
    else
    {
        highp float target = max(node_n0.x, max(node_0n.x, max(node_00.x, max(node_p0.x, node_0p.x))));
        highp float cur = node_00.x;
        cur = mix(cur, target, LERP_STRENGTH * uDeltaTime);
        cur = min(1.0, cur + mouseInfluence);
        col = vec4(cur, cur, cur, 1.0);
    }
    gl_FragColor = col;
}
`;

const SHADERSTR_FLUID_DRAW_FRAG = `
varying highp vec2 vST;

uniform sampler2D uTex;

const mediump vec4 LOW_COL = vec4(0.18, 0.2, 0.275, 1.0);
const mediump vec4 HIGH_COL = vec4(0.3, 0.55, 1.0, 1.0);

void main() {
    // DEBUG RENDERING is just interpolating between two colors while I make sure the sim itself works
    mediump vec4 simData = texture2D(uTex, vST);
    gl_FragColor = LOW_COL * (1.0 - simData.r) + HIGH_COL * simData.r;
}
`;