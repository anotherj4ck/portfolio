const overlay = document.getElementById('lightbox-overlay');
const lightboxImg = document.getElementById('lightbox-img');

document.querySelectorAll('.project-thumb').forEach(thumb => {
  thumb.addEventListener('click', () => {
    lightboxImg.src = thumb.src;
    overlay.style.display = 'flex';
  });
});

overlay.addEventListener('click', () => {
  overlay.style.display = 'none';
});