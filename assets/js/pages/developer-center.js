
import {
  getSession,
  clearSession
} from '../game-api.js';

const denied = document.getElementById('denied');
const content = document.getElementById('content');
const logoutButton = document.getElementById('devLogout');

function checkDeveloperPermission() {
  const profile = getSession();

  const allowed = Boolean(
    profile &&
    profile.authVersion === 2 &&
    profile.is_developer === true
  );

  denied.hidden = allowed;
  content.hidden = !allowed;
  logoutButton.hidden = !allowed;

  return allowed;
}

logoutButton.addEventListener('click', () => {
  clearSession();
  location.replace('../index.html');
});

checkDeveloperPermission();
