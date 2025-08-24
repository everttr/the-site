/////////////////////////////////////////////
/*          ~~~ Vertex Shader ~~~          */
/////////////////////////////////////////////
const SHADERSTR_FLUID_VERT = `
attribute vec4 aVertexPosition;
uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;

void main() {
    gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
}
`;

///////////////////////////////////////////////
/*          ~~~ Fragment Shader ~~~          */
///////////////////////////////////////////////
const SHADERSTR_FLUID_FRAG = `
const mediump vec4 BASE_COL = vec4(144.0 / 255.0, 58.0 / 255.0, 214.0 / 255.0, 1.0);

void main() {
    gl_FragColor = BASE_COL;
}
`;