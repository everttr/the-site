// Control script for the normal webpage by itself!

//////////////////////////////////////////////
/*             ~~~ Helpers ~~~              */
//////////////////////////////////////////////

function changeSimVeilVisibility(val) {
    // arguably should go in the fluid controller script,
    // but that thing's too long anways
    let simVeil = document.getElementById('shader-canvas-veil');
    if (!simVeil) return;
    if (val)
        simVeil.classList.remove('disappeared');
    else
        simVeil.classList.add('disappeared')
}

//////////////////////////////////////////////
/*          ~~~ Initialization ~~~          */
//////////////////////////////////////////////

function initNavigation() {
    // Nothing here for now
}