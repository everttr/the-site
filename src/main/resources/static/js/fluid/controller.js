// Control script for the WebGL background!

//////////////////////////////////////////////////
/*          ~~~ Global Definitions ~~~          */
//////////////////////////////////////////////////

// Constants/Parameters
const minCanvW = 128;
const minCanvH = 128;
const canvasScale = 0.5;
const canvasResizeTolerance = 0.25;
const canvasInactiveColor = "#77b2bd"
const DEBUG_VERBOSITY = 1;
// Plain Globals
var canvas;
var gl;
var shaders = {
    sim: {
        program: null,
        vert: null,
        frag: null,
        attributeLocs: null,
        uniformLocs: null,
    },
    draw: {
        program: null,
        vert: null,
        frag: null,
        attributeLocs: null,
        uniformLocs: null,
    },
    vertexbuffers: {
        positions: null,
        st: null,
    },
    simTex1: null,
    simTex2: null,
    simFB: null,
}
var enabled;
var curCanvW = null;
var curCanvH = null;
var curSimW = null;
var curSimH = null;
var timeSim = -1; // ms it's been running
var timePrev = new Date().getMilliseconds();
var frameParity = 0;
var lastTimeDelta;
var focused = true;

////////////////////////////////////////////////////
/*          ~~~ Function Definitions ~~~          */
////////////////////////////////////////////////////

// Helper functions for initialization/refreshing
function nearestPowerOf2(n) {
    // taken from: https://stackoverflow.com/a/42799104
    return 1 << 32 - Math.clz32(n);
}
function pollResizeCanvas() {
    let desiredW = Math.max(
        nearestPowerOf2(Math.ceil(Math.max(
            document.documentElement.clientWidth ?? 0,
            window.innerWidth ?? 0) * canvasScale)
        ), minCanvW);
    let desiredH = Math.max(
        nearestPowerOf2(
            Math.ceil(Math.max(
            document.documentElement.clientHeight ?? 0,
            window.innerHeight ?? 0) * canvasScale)
        ), minCanvH);
    
    // Round to nearest power of 2
    Math.clz32()

    if (// Always refresh if not been sized yet
        curCanvW === undefined || curCanvH === undefined ||
        // Otherwise, only refresh when above a certain threshold
        (desiredW - curCanvW) / curCanvW > canvasResizeTolerance ||
        (desiredH - curCanvH) / curCanvH > canvasResizeTolerance)
    {
        if (DEBUG_VERBOSITY >= 1)
            console.log(`Trying to resize canvas from ${curCanvW}x${curCanvH} to ${desiredW}x${desiredH}`);

        refreshCanvas(desiredW, desiredH);
        return true;
    }
    return false;
}
function refreshCanvas(newWidth, newHeight) {
    // Resize the canvas
    gl.canvas.width = newWidth;
    gl.canvas.height = newHeight;

    // Resize the simulation texture
    createSimTextures(newWidth, newHeight);

    // Update tracker values
    curCanvW = newWidth;
    curCanvH = newHeight;
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
    // Sim textures alternate between input & output
    let texPrev  = frameParity === 0 ? shaders.simTex1 : shaders.simTex2;
    let texNext = frameParity === 0 ? shaders.simTex2 : shaders.simTex1;
    frameParity = frameParity === 0 ? 1 : 0;

    // Update the fluid simulation
    simStep(deltaT, texPrev, texNext);

    // Then render the changes
    renderScene(texNext);
}
function simStep(deltaT, texPrev, texNext) {
    // We update the sim using the simulation fragment shaders

    // Specify we render to framebuffer/next state texture
    gl.bindFramebuffer(gl.FRAMEBUFFER, shaders.simFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texNext, 0);
    gl.bindTexture(gl.TEXTURE_2D, texNext);
    gl.viewport(0, 0, curSimW, curSimH);

    // Clear framebuffer
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1.);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Specify program to render with
    gl.useProgram(shaders.sim.program);

    // Provide vertex buffer
    gl.enableVertexAttribArray(shaders.sim.attributeLocs.vertexPosition);
    gl.bindBuffer(gl.ARRAY_BUFFER, shaders.vertexbuffers.positions);
    gl.vertexAttribPointer(
        shaders.sim.attributeLocs.vertexPosition,
        2, gl.FLOAT, false, 0, 0);

    // Provide texture coord buffer
    gl.enableVertexAttribArray(shaders.sim.attributeLocs.textureCoord);
    gl.bindBuffer(gl.ARRAY_BUFFER, shaders.vertexbuffers.textureCoord);
    gl.vertexAttribPointer(
        shaders.sim.attributeLocs.textureCoord,
        2, gl.FLOAT, false, 0, 0);

    // Create projection matrix
    let zClipNear = 0.1;
    let zClipFar = 20.0;
    let projMatrix = mat4.create();
    mat4.ortho(projMatrix, -1.0, 1.0, -1.0, 1.0, zClipNear, zClipFar);
    // Provide proj matrix
    gl.uniformMatrix4fv(shaders.sim.uniformLocs.projectionMatrix, false, projMatrix);

    // Create model view matrix
    let modelViewMatrix = mat4.create();
    mat4.translate(modelViewMatrix, modelViewMatrix, [0., 0., -1.]);
    // Provide model view matrix
    gl.uniformMatrix4fv(shaders.sim.uniformLocs.modelViewMatrix, false, modelViewMatrix);

    // Provide the previous state texture as the input
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texPrev);
    gl.uniform1i(shaders.sim.uniformLocs.textureSampler, 0);

    // Provide other simulation inputs
    gl.uniform1i(shaders.sim.uniformLocs.texWidth, curSimW);
    gl.uniform1i(shaders.sim.uniformLocs.texHeight, curSimH);
    gl.uniform1f(shaders.sim.uniformLocs.deltaTime, deltaT);

    // Draw 'em!
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (DEBUG_VERBOSITY >= 2)
        console.log(`Simulation updated with timestep ${deltaT}!`);
}
function renderScene(texNext) {
    // Unbind framebuffer from simulation -- render to the canvas!
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // Clear all existing fragments
    gl.clearColor(0., 0., 0., 1.);
    gl.clearDepth(1.);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Specify program to render with
    gl.useProgram(shaders.draw.program);

    // Provide vertex buffer
    gl.enableVertexAttribArray(shaders.draw.attributeLocs.vertexPosition);
    gl.bindBuffer(gl.ARRAY_BUFFER, shaders.vertexbuffers.positions);
    gl.vertexAttribPointer(
        shaders.draw.attributeLocs.vertexPosition,
        2, gl.FLOAT, false, 0, 0);

    // Provide texture coord buffer
    gl.enableVertexAttribArray(shaders.draw.attributeLocs.textureCoord);
    gl.bindBuffer(gl.ARRAY_BUFFER, shaders.vertexbuffers.textureCoord);
    gl.vertexAttribPointer(
        shaders.draw.attributeLocs.textureCoord,
        2, gl.FLOAT, false, 0, 0);

    // Create projection matrix
    let zClipNear = 0.1;
    let zClipFar = 20.0;
    let projMatrix = mat4.create();
    mat4.ortho(projMatrix, -1.0, 1.0, -1.0, 1.0, zClipNear, zClipFar);
    // Provide proj matrix
    gl.uniformMatrix4fv(shaders.draw.uniformLocs.projectionMatrix, false, projMatrix);

    // Create model view matrix
    let modelViewMatrix = mat4.create();
    mat4.translate(modelViewMatrix, modelViewMatrix, [0., 0., -1.]);
    // Provide model view matrix
    gl.uniformMatrix4fv(shaders.draw.uniformLocs.modelViewMatrix, false, modelViewMatrix);

    // Provide the newly generated sim state texture as input
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texNext);
    gl.uniform1i(shaders.draw.uniformLocs.textureSampler, 0);

    // Draw 'em!
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (DEBUG_VERBOSITY >= 2)
        console.log("Scene rendered!");
}

//////////////////////////////////////////////
/*          ~~~ Initialization ~~~          */
//////////////////////////////////////////////

function init() {
    enabled =
        initCanvas() &&
        initGL() &&
        initShaderPrograms() &&
        initVertexBuffers() &&
        pollResizeCanvas();
    if (enabled) {
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
        window.addEventListener("resize", (event) => {
            pollResizeCanvas();
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
    // Draw a basic plain color while we wait
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
function initShaderPrograms() {
    let b1 = createShaderProgram("Fluid Simulation", shaders.sim,
        SHADERSTR_FLUID_SIM_VERT, SHADERSTR_FLUID_SIM_FRAG,
        null, [["deltaTime", "uDeltaTime"], ["texWidth", "uTexWidth"], ["texHeight", "uTexHeight"]]);
    let b2 = createShaderProgram("Fluid Draw", shaders.draw,
        SHADERSTR_FLUID_DRAW_VERT, SHADERSTR_FLUID_DRAW_FRAG);
    return b1 && b2;
}
function createShaderProgram(name, storage, vertSource, fragSource,
    extraAttributes = null, extraUniforms = null)
{
    // Setup & link shader
    let vert = loadShader(`${name}: Vertex`, gl.VERTEX_SHADER, vertSource);
    if (vert === null) return false;
    let frag = loadShader(`${name}: Fragment`, gl.FRAGMENT_SHADER, fragSource);
    if (frag === null) return false;
    let program = gl.createProgram();
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);

    // Crash & burn if linking failed
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error(`${name} shader program initialization failed.\nLog: ${gl.getProgramInfoLog(program)}`);
        return false;
    }

    if (DEBUG_VERBOSITY >= 1)
        console.log(`${name} shader program successfully linked`);

    // Save location of shader variable's we'll need to manage
    let attributeLocs = {
        vertexPosition: gl.getAttribLocation(program, "aVertexPosition"),
        textureCoord:   gl.getAttribLocation(program, "aTextureCoord"),
    };
    if (extraAttributes !== null) {
        extraAttributes.forEach(a => {
            attributeLocs[a[0]] = gl.getAttribLocation(program, a[1]);
        });
    }
    let uniformLocs = {
        projectionMatrix: gl.getUniformLocation(program, "uProjectionMatrix"),
        modelViewMatrix:  gl.getUniformLocation(program, "uModelViewMatrix"),
        textureSampler:   gl.getUniformLocation(program, "uTex"),
    };
    if (extraUniforms !== null) {
        extraUniforms.forEach(u => {
            uniformLocs[u[0]] = gl.getUniformLocation(program, u[1]);
        });
    }

    // If everything succeeded, save it
    storage.program = program;
    storage.vert = vert;
    storage.frag = frag;
    storage.attributeLocs = attributeLocs;
    storage.uniformLocs = uniformLocs;
    return true;
}
function initVertexBuffers() {
    shaders.vertexbuffers.positions =
        createVertexBuffer("Positions", [1., 1., -1., 1., 1., -1., -1., -1.]);
    shaders.vertexbuffers.textureCoord =
        createVertexBuffer("Texture Coordinates", [0., 0., 1., 0., 1., 1., 0., 1.]);
    return shaders.vertexbuffers.positions != null && shaders.vertexbuffers.textureCoord != null;
}
function createVertexBuffer(name, data) {
    // Create vertex buffer for a very boring plane
    let vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data),
        gl.STATIC_DRAW);

    if (DEBUG_VERBOSITY >= 1)
        console.log(`Vertex buffer "${name}" successfully created`);

    return vb;
}
function createSimTextures(resX, resY) {
    // Delete existing textures
    if (shaders.simTex1 !== null)
        gl.deleteTexture(shaders.simTex1);
    if (shaders.simTex2 !== null)
        gl.deleteTexture(shaders.simTex2);

    // Create new render textures to act as alternating simulation buffers
    let a1 = gl.TEXTURE_2D; // target
    let a2 = 0; // mipmap level
    let a3 = gl.RGBA; // internalFormat
    let a4 = resX; // width
    let a5 = resY; // height
    let a6 = 0; // border
    let a7 = gl.RGBA; // srcFormat
    let a8 = gl.UNSIGNED_BYTE; // srcType
    let a9 = //gl.canvas; // pixel source (just copy what's already drawn on the canvas)
             null; // nvm, the overloads that accept HTML elements are those that don't rescale it...
                   // providing no pixel source here makes Firefox give an erroneous warning, but whatever
    // Tex1
    shaders.simTex1 = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, shaders.simTex1);
    gl.texImage2D(a1, a2, a3, a4, a5, a6, a7, a8, a9);
    // Wrap textures, because that'll look cool
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    // Turn on filtering, but no mipmaps!
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    // Tex2
    shaders.simTex2 = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, shaders.simTex2);
    gl.texImage2D(a1, a2, a3, a4, a5, a6, a7, a8, a9);
    // Wrap texture, because that'll look cool
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    // Turn on filtering, but no mipmaps!
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    // Create the framebuffer to help in rendering to the texture
    // (only create it if one not already created; doesn't need to be resized)
    if (shaders.simFB === null)
        shaders.simFB = gl.createFramebuffer();

    // Save values
    curSimW = resX;
    curSimH = resY;

    if (DEBUG_VERBOSITY >= 1)
        console.log(`Simulation texture/framebuffer of resolution ${resX}x${resY} created`);
}