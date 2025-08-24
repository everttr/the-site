// Control script for the WebGL background!

//////////////////////////////////////////////////
/*          ~~~ Global Definitions ~~~          */
//////////////////////////////////////////////////

// Constants/Parameters
const canvasScale = 0.5;
const canvasResizeTolerance = 0.25;
const canvasInactiveColor = "#77b2bd"
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
var timeSim = -1; // ms it's been running
var timePrev = new Date().getMilliseconds();
var lastTimeDelta;
var focused = true;

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
function tryUpdateRepeating(_ = null) {
    timeCur = new Date().getMilliseconds();
    timeDelta = timeCur - timePrev;
    timeSim += timeDelta;
    timePrev = timeCur;
    lastTimeDelta = timeDelta;
    // so we don't update twice in the same frame for whatever reason
    if (timeDelta == 0)
        return;

    updateSim(timeDelta / 1000.0);

    if (focused)
        requestAnimationFrame(tryUpdateRepeating);
}
function updateSim(deltaT) {
    // Update the fluid simulation
    /* Implement me! */

    // Then render the changes
    renderScene();
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
    let projMatrix = mat4.create();
    mat4.ortho(projMatrix, -1.0, 1.0, -1.0, 1.0, zClipNear, zClipFar);

    // Create model view matrix
    let modelViewMatrix = mat4.create();
    mat4.translate(modelViewMatrix, modelViewMatrix,
        [0., 0., -1.]
    );

    // Provide vertex buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, shaders.vertexBuffer);
    gl.vertexAttribPointer(
        shaders.attributeLocs.vertexPosition,
        2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(shaders.attributeLocs.vertexPosition);

    // Specify program to render with
    gl.useProgram(shaders.program);

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

function init() {
    enabled = initCanvas() && initGL() && initShaderProgram();
    if (enabled) {
        pollResizeCanvas();

        // Start render loop
        tryUpdateRepeating();

        // Focus/unfocus performance evetns
        window.addEventListener("focus", () => {
            timePrev = new Date().getMilliseconds() - lastTimeDelta; // start counting from now!
            focused = true;
            // Also have to start the rendering loop back up again
            tryUpdateRepeating();
        })
        window.addEventListener("blur", () => {
            // This will naturally dequeue the rendering loop
            focused = false;
        })

        // Interaction/event setup
        // Wave shader interaction
        document.documentElement.addEventListener("mousemove", (event) => {
            let x = event.clientX;
            let y = event.clientY;
            let canvRect = canvas.getBoundingClientRect();
            if (x < canvRect.left || x > canvRect.right ||
                y < canvRect.top || y > canvRect.bottom)
                return;
            // Make waves!
            /* Implement me! */
        });
        // Possible resizing event
        /* Implement me! */
        document.documentElement.addEventListener("click", (event) => {
            console.log("i printed it");
        });
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