render();

$('developerTab').addEventListener('click', () => {
  $('developerPanel').classList.toggle('hidden');
});

$('closeDeveloperPanel').addEventListener('click', () => {
  $('developerPanel').classList.add('hidden');
});
