'use strict';
document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('printFlightManifest');
  if (button) button.addEventListener('click', () => window.print());
});
