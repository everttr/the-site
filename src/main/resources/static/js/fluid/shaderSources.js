/////////////////////////////////////////////
/*          ~~~ Vertex Shader ~~~          */
/////////////////////////////////////////////
const SHADERSTR_FLUID_SIM_VERT = `
attribute vec4 aVertexPosition;
attribute vec4 aTextureCoord;

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
attribute vec4 aTextureCoord;

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
uniform uint uTexWidth;
uniform uint uTexHeight;
uniform highp float uDeltaTime;

const highp float BRIGHTNESS_TRANSITION_TIME = 8.0;

void main() {
    // Sample
    // (n is -1, p is +1)
    // ((clipping isn't a problem b/c of wrapping))
    vec4 node_n0 = texture2D(uTex, vST + vec2(-1.0 / uTexWidth, 0.0));
    vec4 node_0n = texture2D(uTex, vST + vec2(0.0, -1.0 / uTexHeight));
    vec4 node_00 = texture2D(uTex, vST);
    vec4 node_p0 = texture2D(uTex, vST + vec2(1.0 / uTexWidth, 0.0));
    vec4 node_0p = texture2D(uTex, vST + vec2(0.0, 1.0 / uTexHeight));

    // (other sampled points not actually used at this point)
    // Just increase brightness over time to test
    // (the *0's are so I'm not yelled at for unused variables)
    vec4 col = node_00 + node_n0 * 0 + node_0n * 0 + node_p0 * 0 + node_0p * 0;
    float x = col.x;
    x = min(1.0, x + uDeltaTime * BRIGHTNESS_TRANSITION_TIME);
    col = vec4(x, x, x, 1.0);
    gl_FragColor = col;
}
`;

const SHADERSTR_FLUID_DRAW_FRAG = `
varying highp vec2 vST;

uniform sampler2D uTex;

const mediump vec4 LOW_COL = vec4();
const mediump vec4 HIGH_COL = vec4();

void main() {
    // DEBUG RENDERING is just interpolating between two colors while I make sure the sim itself works
    vec4 simData =  = BASE_COL;
    gl_FragColor = LOW_COL * (1 - simData.r) + HIGH_COL * simData.r;
}
`;