window.onload = function funLoad() {
  new WOW({resetAnimation: true}).init(); 
  ScrollReveal({ reset: true }).reveal('body>*>*');
};

function closeMenu(){
  document.querySelector('#menuToggle > input[type=checkbox]').checked = false
}