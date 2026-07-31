let fanToken = localStorage.getItem('st');
let fanUser = null;

function buildApiUrl(path) {
  const base = String(window.__APP_CONFIG__?.apiBaseUrl || window.API_BASE_URL || '').replace(/\/$/, '');
  const clean = String(path || '').replace(/^\/+/, '');
  if (!base) return `/${clean}`;
  return `${base}/${clean}`;
}

async function api(path, options = {}) {
  const headers = {};
  if (fanToken) headers.Authorization = `Bearer ${fanToken}`;
  const isFormData = options.body instanceof FormData;
  if (!isFormData && options.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(buildApiUrl(path), {
    method: options.method || 'GET',
    headers,
    body: options.body ? (isFormData ? options.body : JSON.stringify(options.body)) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function setStatus(message, isError = false) {
  const el = document.getElementById('profile-status');
  if (!el) return;
  el.textContent = message;
  el.className = `fan-status${isError ? ' error' : ''}`;
}

function showToast(message, isError = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show${isError ? ' err' : ''}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 3200);
}

function toggleMobileNav() {
  const nav = document.querySelector('.nav-links');
  if (!nav) return;
  nav.classList.toggle('mobile-open');
}

function applyUserToPage(user) {
  fanUser = user;
  document.getElementById('fan-avatar-preview').textContent = user.avatar || '🎧';
  document.getElementById('fan-card-name').textContent = user.username || 'Your profile';
  document.getElementById('fan-card-role').textContent = user.role === 'artist' ? 'Artist' : 'Fan';
  document.getElementById('fan-card-email').textContent = user.email || '—';
  document.getElementById('fan-card-date').textContent = user.created_at ? new Date(user.created_at).toLocaleDateString() : '—';
  document.getElementById('profile-username').value = user.username || '';
  document.getElementById('profile-email').value = user.email || '';
  document.getElementById('profile-bio').value = user.bio || '';
}

function resetProfileForm() {
  if (!fanUser) return;
  applyUserToPage(fanUser);
  document.getElementById('profile-avatar').value = '';
  document.getElementById('profile-current-password').value = '';
  document.getElementById('profile-new-password').value = '';
  document.getElementById('profile-confirm-password').value = '';
  setStatus('');
}

async function loadProfile() {
  try {
    const data = await api('/auth/me');
    applyUserToPage(data.user);
  } catch (error) {
    showToast(error.message, true);
    window.location.href = '/';
  }
}

async function saveProfile() {
  const username = document.getElementById('profile-username').value.trim();
  const email = document.getElementById('profile-email').value.trim();
  const bio = document.getElementById('profile-bio').value.trim();
  const currentPassword = document.getElementById('profile-current-password').value;
  const newPassword = document.getElementById('profile-new-password').value;
  const confirmPassword = document.getElementById('profile-confirm-password').value;

  if (!username || !email) {
    setStatus('Username and email are required.', true);
    return;
  }

  if ((newPassword || confirmPassword || currentPassword) && newPassword.length < 6) {
    setStatus('New password must be at least 6 characters.', true);
    return;
  }

  if (newPassword && newPassword !== confirmPassword) {
    setStatus('New passwords do not match.', true);
    return;
  }

  try {
    const formData = new FormData();
    formData.append('username', username);
    formData.append('email', email);
    formData.append('bio', bio);
    if (currentPassword) formData.append('currentPassword', currentPassword);
    if (newPassword) formData.append('newPassword', newPassword);

    const avatarFile = document.getElementById('profile-avatar').files[0];
    if (avatarFile) formData.append('avatar', avatarFile);

    const data = await api('/auth/profile', {
      method: 'PUT',
      body: formData
    });

    if (data.user) {
      fanUser = data.user;
      applyUserToPage(data.user);
      localStorage.setItem('st', data.token || fanToken);
      fanToken = data.token || fanToken;
      setStatus('Profile updated successfully.');
      showToast('Profile updated successfully.');
    }
  } catch (error) {
    setStatus(error.message, true);
    showToast(error.message, true);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (!fanToken) {
    window.location.href = '/';
    return;
  }
  loadProfile();
});

window.addEventListener('resize', () => {
  const nav = document.querySelector('.nav-links');
  if (!nav) return;
  if (window.innerWidth > 768 && nav.classList.contains('mobile-open')) nav.classList.remove('mobile-open');
});
