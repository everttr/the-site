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
function gotoPage(id) {
    // Disable all pages except for the one with that ID
    var found = false;
    for (let i = 0; i < pageDestinations.length; ++i) {
        if (pageDestinations.item(i).getAttribute('page-id') == id) {
            pageDestinations.item(i).classList.remove('inactive');
            found = true;
            continue;
        }
        pageDestinations.item(i).classList.add('inactive');
    }
    if (!found) {
        console.log(`Cannot jump to page; page of ID \"${id}\" not found.`);
        return;
    }
    console.log(`Successfully jumped to page with ID \"${id}\".`);
}

//////////////////////////////////////////////
/*          ~~~ Initialization ~~~          */
//////////////////////////////////////////////

var pageLinks = null;
var pageDestinations = null;
function initNavigation() {
    // Find all destination pages
    pageDestinations = document.getElementsByClassName('floating-body');
    // Find all elements with links & make them redirect to their desired page
    pageLinks = document.getElementsByClassName('page-link');
    for (let i = 0; i < pageLinks.length; ++i) {
        pageLinks.item(i).addEventListener('click', (event) => {
            gotoPage(event.target.getAttribute('dest-id'));
        });
    }
}