// Control script for the WebGL background!

//////////////////////////////////////////////////
/*          ~~~ Global Definitions ~~~          */
//////////////////////////////////////////////////

// Constants/Parameters
const canvasScale = 0.5;
const canvasResizeTolerance = 0.25;
const canvasInactiveColor = "#77b2bd"
const helperScriptCount = 2;
const DEBUG_VERBOSITY = 1;
// Plain Globals
var canvas;
var gl;
var shaders = {
    program: null,
    vert: null,
    frag: null,
    attributeLocs: null,
    uniformLocs: null,
    vertexBuffer: null,
}
var enabled;
var curCanvW;
var curCanvH;
var helperScriptsLoaded = 0;

////////////////////////////////////////////////////
/*          ~~~ Function Definitions ~~~          */
////////////////////////////////////////////////////

// Helper functions for initialization/refreshing
function pollResizeCanvas() {
    let desiredW = Math.max(
        document.documentElement.clientWidth ?? 0,
        window.innerWidth ?? 0) * canvasScale;
    let desiredH = Math.max(
        document.documentElement.clientHeight ?? 0,
        window.innerHeight ?? 0) * canvasScale;

    if (// Always refresh if not been sized yet
        curCanvW === undefined || curCanvH === undefined ||
        // Otherwise, only refresh when above a certain threshold
        (desiredW - curCanvW) / curCanvW > canvasResizeTolerance ||
        (desiredH - curCanvH) / curCanvH > canvasResizeTolerance) {
        refreshCanvas(desiredW, desiredH);
    }
}
function refreshCanvas(newWidth, newHeight) {
    // Delete old texture buffers
    /* Implement me! */

    // Make new texture buffers
    /* Implement me! */
}
function renderScene() {
    // Clear all existing fragments
    gl.clearColor(0., 0., 0., 1.);
    gl.clearDepth(1.);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Create projection matrix
    let aspect = curCanvW / curCanvH;
    let zClipNear = 0.1;
    let zClipFar = 20.0;
    let projMatrix = glMatrix.mat4.create();
    glMatrix.mat4.ortho(projMatrix(), -1.0, 1.0, -1.0, 1.0, zClipNear, zClipFar);

    // Create model view matrix
    let modelViewMatrix = glMatrix.mat4.create();
    glMatrix.mat4.translate(modelViewMatrix, modelViewMatrix,
        [0., 0., -1.]
    );

    // Provide vertex buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, shaders.vertexBuffer);
    gl.vertexAttribPointer(
        shaders.attributeLocs.vertexPosition,
        2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(shaders.attributeLocs.vertexPosition);

    // Provide proj matrix
    gl.uniformMatrix4fv(shaders.uniformLocs.projectionMatrix, false, projMatrix);

    // Provide model view matrix
    gl.uniformMatrix4fv(shaders.uniformLocs.modelViewMatrix, false, modelViewMatrix);

    // Draw 'em!
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (DEBUG_VERBOSITY >= 1)
        console.log("Scene rendered!");
}

//////////////////////////////////////////////
/*          ~~~ Initialization ~~~          */
//////////////////////////////////////////////

function pollForInit() {
    if (++helperScriptsLoaded == helperScriptCount) {
        init();
        return true;
    }
    return false;
}
function init() {
    enabled = initCanvas() && initGL() && initShaderProgram();
    if (enabled) {
        pollResizeCanvas();
        renderScene();

        // Interaction/event setup
        // Wave shader interaction
        canvas.addEventListener("mousemove", (event) => {
            let x = event.x;
            let y = event.y;
            // 
        });
        canvas.addEventListener("mouseclick", (event) => {
            renderScene();
        });
        // Possible resizing event
        /* Implement me! */
    }
}
function initCanvas() {
    canvas = document.getElementById('shader-canvas');
    if (canvas === null)
        return false;
    if (DEBUG_VERBOSITY >= 1)
        console.log("Canvas identified");
    return true;
}
function initGL() {
    gl = canvas.getContext("webgl");
    if (gl === null) {
        console.warn("WebGL initialization failed. The background is supposed to have some portfolio-worthy shader action going on...");
        // // Just draw a plain color instead
        // let cxt = canvas.getContext("2d");
        // cxt.fillStyle = canvasInactiveColor;
        // cxt.fillRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
        return false;
    }
    // Draw our basic plain color while we wait
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (DEBUG_VERBOSITY >= 1)
        console.log("Canvas WebGL context initialized");
    return true;
}
function loadShader(name, type, source) {
    // Setup & compile shader
    let s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    // Error if failed
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(`Shader "${name}" failed to compile.\nLog: ${gl.getShaderInfoLog(s)}`);
        return null;
    }
    if (DEBUG_VERBOSITY >= 1)
        console.log(`Shader "${name}" loaded and compiled`);
    return s;
}
function initShaderProgram() {
    // Setup & link shader
    shaders.vert = loadShader("Fluid: Vertex", gl.VERTEX_SHADER, SHADERSTR_FLUID_VERT);
    if (shaders.vert === null) return false;
    shaders.frag = loadShader("Fluid: Fragment", gl.FRAGMENT_SHADER, SHADERSTR_FLUID_FRAG);
    if (shaders.frag === null) return false;
    shaders.program = gl.createProgram();
    gl.attachShader(shaders.program, shaders.vert);
    gl.attachShader(shaders.program, shaders.frag);
    gl.linkProgram(shaders.program);

    // Crash & burn if linking failed
    if (!gl.getProgramParameter(shaders.program, gl.LINK_STATUS)) {
        console.error("Shader program initialization failed.\nLog: " + gl.getProgramInfoLog(shaders.program));
        return false;
    }

    if (DEBUG_VERBOSITY >= 1)
        console.log("Shader program linked");

    // Save location of shader variable's we'll need to manage
    shaders.attributeLocs = {
        vertexPosition:     gl.getAttribLocation(shaders.program, "aVertexPosition"),
    };
    shaders.uniformLocs = {
        projectionMatrix:   gl.getUniformLocation(shaders.program, "uProjectionMatrix"),
        modelViewMatrix:    gl.getUniformLocation(shaders.program, "uModelViewMatrix"),
    };

    // Create vertex buffer for a very boring plane
    shaders.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, shaders.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(
        [1., 1., -1., 1., 1., -1., -1., -1.]),
        gl.STATIC_DRAW);

    if (DEBUG_VERBOSITY >= 1)
        console.log("Vertex buffer created");

    return true;
}

// One-time setup
var glMatrixScript = document.querySelector("#gl-matrix-js");
glMatrixScript.addEventListener("load", pollForInit);
var shaderSourceScript = document.querySelector("#shader-source-js");
shaderSourceScript.addEventListener("load", pollForInit);